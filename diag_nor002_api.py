#!/usr/bin/env python3
# Read-only diagnostic: pin the exact R500 on Norway Parks (NOR002) via the Sage REST API.
# Reuses cttlfa_api_fetch's auth (env secrets on CI). Reads Sage only; writes the FINDINGS
# to Supabase via the token-gated diag_nor002_write RPC so they can be read back. Never
# writes to Sage, never touches the debtor snapshot.
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cttlfa_api_fetch as F

TARGET = os.environ.get("DIAG_CODE", "NOR002")

def code_of(name):
    m = F.CODE.search(name or ""); return m.group(1) if m else None

def send(svc, rows):
    try:
        F.post_rpc("diag_nor002_write", {"p_token": F.CFG["ingest_token"], "p_svc": svc, "p_rows": rows})
    except Exception as e:
        print("diag send error", svc, e, flush=True)

cust = F.allrows("/Customer/Get")
me = [c for c in cust if code_of(c.get("Name", "")) == TARGET]
ids = set(c.get("ID") for c in me)
send("customer", [{"id": c.get("ID"), "name": c.get("Name"), "balance": c.get("Balance"), "active": c.get("Active")} for c in me])

def mine(r):
    x = r.get("Customer") or {}
    i = r.get("CustomerId") or x.get("ID")
    return (i in ids) or (code_of(x.get("Name", "")) == TARGET)

def trim(r):
    return {"date": (r.get("Date") or "")[:10], "doc": r.get("DocumentNumber") or r.get("Number"),
            "ref": r.get("Reference"), "total": r.get("Total"), "amount_due": r.get("AmountDue"),
            "unalloc": r.get("TotalUnallocated"), "outstanding": r.get("TotalOutstanding"),
            "status": r.get("Status") or r.get("DocumentStatus"), "desc": (r.get("Description") or "")[:60]}

for svc in ["TaxInvoice", "CustomerReturn", "CustomerReceipt", "CustomerAdjustment", "CustomerWriteOff"]:
    try:
        rows = F.allrows("/%s/Get" % svc)
    except Exception as e:
        send(svc, [{"error": str(e)}]); continue
    hit = [r for r in rows if mine(r)]
    out = [trim(r) for r in hit]
    if hit and svc in ("CustomerReturn", "CustomerReceipt", "CustomerAdjustment", "CustomerWriteOff"):
        out.append({"_raw_first_keys": sorted(list(hit[0].keys()))})
    send(svc, out)

inv = [r for r in F.allrows("/TaxInvoice/Get", "AmountDue ne 0") if mine(r)]
open_due = round(sum(float(r.get("AmountDue") or 0) for r in inv), 2)
bal = round(sum(float(c.get("Balance") or 0) for c in me), 2)
send("recon", [{"open_invoice_amountdue": open_due, "api_balance": bal, "gap": round(open_due - bal, 2)}])
print("DIAG DONE for", TARGET, flush=True)
