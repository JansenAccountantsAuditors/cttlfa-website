#!/usr/bin/env python3
# Read-only diagnostic: pin the exact R500 on Norway Parks (NOR002) via the Sage REST API.
# Reuses cttlfa_api_fetch's auth (env secrets on CI). Writes nothing to Supabase or Sage.
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cttlfa_api_fetch as F

TARGET = os.environ.get("DIAG_CODE", "NOR002")

def code_of(name):
    m = F.CODE.search(name or ""); return m.group(1) if m else None

cust = F.allrows("/Customer/Get")
me = [c for c in cust if code_of(c.get("Name", "")) == TARGET]
print("== CUSTOMER(S) for %s ==" % TARGET, flush=True)
for c in me:
    print("  ID=%s Name=%r Balance=%s Active=%s" % (c.get("ID"), c.get("Name"), c.get("Balance"), c.get("Active")), flush=True)
ids = set(c.get("ID") for c in me)

def mine(r):
    x = r.get("Customer") or {}
    i = r.get("CustomerId") or x.get("ID")
    return (i in ids) or (code_of(x.get("Name", "")) == TARGET)

FEEDS = ["TaxInvoice", "CustomerReturn", "CustomerReceipt", "CustomerAdjustment", "CustomerWriteOff"]
for svc in FEEDS:
    try:
        rows = F.allrows("/%s/Get" % svc)
    except Exception as e:
        print("== %s: ERROR %s ==" % (svc, e), flush=True); continue
    hit = [r for r in rows if mine(r)]
    print("\n== %s: %d row(s) for %s ==" % (svc, len(hit), TARGET), flush=True)
    for r in hit:
        print("   date=%s doc=%s ref=%s Total=%s AmountDue=%s Unalloc=%s Outstanding=%s Status=%s desc=%r" % (
            (r.get("Date") or "")[:10], r.get("DocumentNumber") or r.get("Number"),
            r.get("Reference"), r.get("Total"), r.get("AmountDue"),
            r.get("TotalUnallocated"), r.get("TotalOutstanding"),
            r.get("Status") or r.get("DocumentStatus"), (r.get("Description") or "")[:48]), flush=True)
    # full field dump of the FIRST hit of each credit-side feed, to discover field names
    if hit and svc in ("CustomerReturn", "CustomerReceipt", "CustomerAdjustment", "CustomerWriteOff"):
        print("   -- keys/first row: %s" % json.dumps(hit[0], default=str)[:900], flush=True)

inv = [r for r in F.allrows("/TaxInvoice/Get", "AmountDue ne 0") if mine(r)]
open_due = round(sum(float(r.get("AmountDue") or 0) for r in inv), 2)
bal = round(sum(float(c.get("Balance") or 0) for c in me), 2)
print("\n== RECON ==", flush=True)
print("  open invoice AmountDue total = %s" % open_due, flush=True)
print("  Customer.Balance (API net)   = %s" % bal, flush=True)
print("  gap (open - balance)         = %s" % round(open_due - bal, 2), flush=True)
print("DONE", flush=True)
