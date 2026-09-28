"""CTTLFA club-debtors — live fetch from the Sage Accounting API.

Replaces the browser scraper entirely. One pull produces BOTH:
  - the aged-balances snapshot  (deb_load_snapshot)
  - the itemised customer ledger (deb_load_transactions), reconstructed from the FY
    posting documents and derived so every club's statement CLOSES on its live Sage
    balance -> the dashboard "out of sync" indicator stays at zero.

Credentials & config are read from ENVIRONMENT VARIABLES first (GitHub Actions
secrets), and fall back to the office-PC install (Windows Credential Manager via
keyring + loader.json) when the environment is not set. Nothing is hard-coded.
  SAGE_API_KEY                            Sage Accounting API key   (PC: keyring sagefetch_cttlfa/api_key)
  SAGE_USER / SAGE_PASS                   Sage login e-mail / pass  (PC: keyring sagefetch_cttlfa/login)
  SUPABASE_INGEST_TOKEN                   dashboard write token     (PC: loader.json ingest_token)
  SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY Supabase target           (PC: loader.json)
  SAGE_COMPANY_ID                         default 364261            (PC: loader.json sage_company_id)

Usage:  python cttlfa_api_fetch.py            (dry run - prints, writes nothing)
        python cttlfa_api_fetch.py --push     (writes snapshot + ledger to the dashboard)
"""
import os, re, sys, json, datetime, collections, urllib.request, urllib.error
import httpx

HOME = os.environ.get("SAGEFETCH_HOME") or os.path.join(os.path.expanduser("~"), ".sagefetch_cttlfa")

def _loader():
    """The office-PC install's loader.json, if present. On CI there is none."""
    try:
        return json.load(open(os.path.join(HOME, "loader.json"), encoding="utf-8"))
    except Exception:
        return {}

_CFG_FILE = _loader()

def _kr(service, entry):
    """Windows Credential Manager lookup — office-PC fallback only, never on CI."""
    try:
        import keyring
        return keyring.get_password(service, entry) or ""
    except Exception:
        return ""

def _cfg(env_name, file_key=None, default=""):
    v = os.environ.get(env_name)
    if v not in (None, ""):
        return v
    if file_key is not None and _CFG_FILE.get(file_key) not in (None, ""):
        return _CFG_FILE.get(file_key)
    return default

# --- credentials: environment first (GitHub Actions), then the office PC ---
KEY  = os.environ.get("SAGE_API_KEY") or _kr("sagefetch_cttlfa", "api_key")
USER = os.environ.get("SAGE_USER") or ""
PASS = os.environ.get("SAGE_PASS") or ""
if not (USER and PASS):
    _blob = _kr("sagefetch_cttlfa", "login")
    if "\n" in _blob:
        _u, _, _p = _blob.partition("\n")
        USER = USER or _u
        PASS = PASS or _p

CFG = {
    "supabase_url":    _cfg("SUPABASE_URL", "supabase_url"),
    "publishable_key": _cfg("SUPABASE_PUBLISHABLE_KEY", "publishable_key"),
    "ingest_token":    _cfg("SUPABASE_INGEST_TOKEN", "ingest_token"),
}
BASE = "https://accounting.sageone.co.za/api/2.0.0"
CID  = int(_cfg("SAGE_COMPANY_ID", "sage_company_id", "364261"))
AS   = datetime.date.today()
FY_START = "2025-11-01"          # November year-end
OPENING_DT = "2025-10-31"
CODE = re.compile(r"\b([A-Z]{2,4}\d{3})\b")

_cli = httpx.Client(auth=(USER, PASS), timeout=180.0)

def _log(level, msg):
    print("[%s] %s" % (level, msg), flush=True)

def allrows(path, flt=None):
    out = []; skip = 0
    while True:
        prm = {"apikey": KEY, "CompanyId": CID, "$top": 100, "$skip": skip}
        if flt: prm["$filter"] = flt
        r = _cli.get(BASE + path, params=prm)
        if r.status_code != 200:
            _log("warn", "%s HTTP %s %s" % (path, r.status_code, r.text[:120]))
            break
        d = r.json(); rows = d.get("Results", d) if isinstance(d, dict) else d
        out += rows
        if len(rows) < 100: break
        skip += len(rows)
    return out

def clean_name(nm):
    return re.sub(r"\s*:\s*[A-Z]{2,4}\d{3}.*$", "", nm).strip().rstrip(":").strip()

def _bkt(s):
    try: dd = datetime.date.fromisoformat((s or "")[:10])
    except Exception: return "cur"
    n = (AS - dd).days
    return "cur" if n <= 30 else "d30" if n <= 60 else "d60" if n <= 90 else "d90" if n <= 120 else "d120"

# ---- posting feeds for the ledger; try FY date-filter, fall back to full + client filter ----
_LEDGER_FEEDS = [("TaxInvoice", "Tax Invoice", "debit"),
                 ("CustomerReturn", "Credit Note", "credit"),
                 ("CustomerReceipt", "Customer Receipt", "credit"),
                 ("CustomerAdjustment", "Customer Adjustment", "signed")]

def _fy_docs(svc):
    rows = allrows("/%s/Get" % svc, "Date ge datetime'%sT00:00:00'" % FY_START)
    if not rows:                      # filter unsupported or genuinely none -> full pull, client-filter
        rows = allrows("/%s/Get" % svc)
    return [r for r in rows if (r.get("Date") or "")[:10] >= FY_START]


def post_rpc(fn, body):
    url = CFG["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + fn
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "apikey": CFG["publishable_key"], "Authorization": "Bearer " + CFG["publishable_key"],
        "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def build():
    """Pull everything once; return (snapshot_payload, ledger_meta, ledger_clubs, coa_rows, stats)."""
    # Recompute the ageing "as at" date on every run. AS is a module-level default
    # evaluated at import; a long-running agent would otherwise freeze it at the date
    # the process started, ageing every invoice and stamping the snapshot as at that
    # stale date. Setting it here makes each fetch age as at the actual run date.
    global AS
    AS = datetime.date.today()
    cust = allrows("/Customer/Get")
    inv_open = allrows("/TaxInvoice/Get", "AmountDue ne 0")
    rcp_un   = allrows("/CustomerReceipt/Get", "TotalUnallocated ne 0")
    _log("info", "customers %d | open invoices %d | unallocated receipts %d" % (len(cust), len(inv_open), len(rcp_un)))

    id2code = {}
    for c in cust:
        m = CODE.search(c.get("Name", "") or ""); id2code[c.get("ID")] = m.group(1) if m else None
    def cc(r):
        x = r.get("Customer") or {}; i = r.get("CustomerId") or x.get("ID"); cd = id2code.get(i)
        if not cd:
            m = CODE.search(x.get("Name", "") or ""); cd = m.group(1) if m else None
        return cd

    # ---- ageing buckets from open invoices netted with unallocated receipts ----
    B = collections.defaultdict(lambda: dict(cur=0., d30=0., d60=0., d90=0., d120=0.))
    for r in inv_open:
        cd = cc(r)
        if cd: B[cd][_bkt(r.get("Date"))] += float(r.get("AmountDue") or 0)
    for r in rcp_un:
        cd = cc(r)
        if cd: B[cd][_bkt(r.get("Date"))] -= float(r.get("TotalUnallocated") or 0)

    code_bal = {}    # live authoritative balance per code, for the ledger tie
    clubs = []; est = 0
    for c in cust:
        nm = c.get("Name", "") or ""; m = CODE.search(nm); code = m.group(1) if m else None
        bal = round(float(c.get("Balance") or 0), 2); active = (c.get("Active") is not False)
        # drop dormant accounts with nothing owing: no-code zero-balance customers,
        # and inactive zero-balance customers (e.g. a retired duplicate marked
        # inactive in Sage). An inactive account that still owes is kept and chased.
        if abs(bal) < 0.005 and (code is None or not active):
            continue
        if code: code_bal[code] = round(code_bal.get(code, 0.0) + bal, 2)  # sum if >1 customer shares a code
        ib = B.get(code) if code else None
        if ib is None: ib = dict(cur=0., d30=0., d60=0., d90=0., d120=0.)
        comp = round(sum(ib.values()), 2)
        if code and abs(comp - bal) <= 1.0:
            bk = {k: round(ib[k], 2) for k in ib}
        else:
            bk = dict(cur=bal, d30=0., d60=0., d90=0., d120=0.)
            if abs(bal) > 0.005 and code: est += 1
        over = round(bk["d30"] + bk["d60"] + bk["d90"] + bk["d120"], 2)
        st = ("Credit" if bal < -0.01 else "Paid up" if abs(bal) <= 0.01 else "Below threshold" if bal <= 500
              else "Suspension review" if (bk["d120"] > 0 or bk["d90"] > 0) else "Formal notice" if bk["d60"] > 0
              else "Reminder" if bk["d30"] > 0 else "Current")
        ky = code.lower() if code else re.sub(r"[^a-z0-9]", "", clean_name(nm).lower())[:28]
        clubs.append(dict(club_key=ky, code=code, name=clean_name(nm), suburb=None, active=active,
            bal=bal, cur=bk["cur"], b30=bk["d30"], b60=bk["d60"], b90=bk["d90"], b120=bk["d120"], over=over,
            status=st, last_receipt_days=None, tx_last_balance=None, recon_diff=0))

    # Collapse any customers that share one club code (e.g. two Sage customers both
    # coded CTTxxx) into a single club row, so the snapshot primary key
    # (snapshot_id, club_key) stays unique and the push cannot fail on a duplicate.
    # Balance comes from the summed code_bal; buckets are rebuilt from the
    # authoritative aged figures B[code] rather than summed, to avoid double counting.
    _seen = collections.OrderedDict(); _dups = 0
    for _c in clubs:
        _k = _c["club_key"]
        if _k in _seen:
            _dups += 1; _a = _seen[_k]
            if not _a["code"] and _c["code"]: _a["code"] = _c["code"]
            if _c["code"] and len(_c["name"]) > len(_a["name"]): _a["name"] = _c["name"]
            _a["active"] = _a["active"] or _c["active"]
        else:
            _seen[_k] = _c
    if _dups:
        clubs = list(_seen.values())
        for _c in clubs:
            _code = _c.get("code")
            if not _code: continue
            _bal = code_bal.get(_code, _c["bal"])
            _ib = B.get(_code) or dict(cur=0., d30=0., d60=0., d90=0., d120=0.)
            if abs(round(sum(_ib.values()), 2) - _bal) <= 1.0:
                _bk = {kk: round(_ib[kk], 2) for kk in _ib}
            else:
                _bk = dict(cur=_bal, d30=0., d60=0., d90=0., d120=0.)
            _c["bal"] = _bal; _c["cur"] = _bk["cur"]; _c["b30"] = _bk["d30"]; _c["b60"] = _bk["d60"]
            _c["b90"] = _bk["d90"]; _c["b120"] = _bk["d120"]
            _c["over"] = round(_bk["d30"] + _bk["d60"] + _bk["d90"] + _bk["d120"], 2)
            _c["status"] = ("Credit" if _bal < -0.01 else "Paid up" if abs(_bal) <= 0.01 else "Below threshold" if _bal <= 500
                else "Suspension review" if (_bk["d120"] > 0 or _bk["d90"] > 0) else "Formal notice" if _bk["d60"] > 0
                else "Reminder" if _bk["d30"] > 0 else "Current")
        _log("info", "merged %d duplicate club-code row(s) into the balances snapshot" % _dups)

    # ---- contact details (email / cc / phone) so the statement + notice layer stays current ----
    # Replaces the retired browser scraper's Customer Listing parse. Upsert-only and email-gated:
    # a club is pushed only when Sage holds an email, so a blank can never overwrite a good contact,
    # and wrong field names simply yield zero contacts (visible in the dry run) rather than damage.
    def _emails(s):
        ps = [p.strip() for p in re.split(r"[;,/]| and ", s or "") if p.strip() and "@" in p]
        return (ps[0] if ps else None), ("; ".join(ps[1:]) or None)
    contacts = []
    for c in cust:
        nm = c.get("Name", "") or ""; m = CODE.search(nm); cd = m.group(1) if m else None
        if not cd: continue
        if (c.get("Active") is False) and abs(round(float(c.get("Balance") or 0), 2)) < 0.005: continue
        pri, ccm = _emails(c.get("Email") or c.get("EmailAddress") or "")
        if not pri: continue
        ph = (c.get("Mobile") or c.get("MobileNumber") or c.get("CellNumber") or
              c.get("Telephone") or c.get("TelephoneNumber") or c.get("Phone") or "").strip() or None
        contacts.append(dict(club_key=cd.lower(), name=clean_name(nm), email=pri, cc_email=ccm, phone=ph))
    # keep one contact per club_key (first with an email wins) so the upsert cannot
    # fail on two customers sharing a code
    if len(set(c["club_key"] for c in contacts)) != len(contacts):
        _cseen = set(); _cd2 = []
        for c in contacts:
            if c["club_key"] in _cseen: continue
            _cseen.add(c["club_key"]); _cd2.append(c)
        contacts = _cd2

    pos = [c for c in clubs if c["bal"] > 0.01]; neg = [c for c in clubs if c["bal"] < -0.01]
    def S(k, rows=pos): return round(sum(r[k] for r in rows), 2)
    asat = AS.isoformat()
    snap = dict(as_at=asat, source="Sage Accounting API (live) CompanyId %d" % CID, ledger_from=FY_START, ledger_to=asat,
        net_total=round(sum(c["bal"] for c in clubs), 2), pos_total=S("bal"),
        credit_total=round(sum(c["bal"] for c in neg), 2),
        n_clubs=len(clubs), n_owing=len(pos), n_credit=len(neg),
        n_paidup=sum(1 for c in clubs if c["active"] and abs(c["bal"]) <= 0.01 and c["code"]),
        buckets=dict(cur=S("cur"), b30=S("b30"), b60=S("b60"), b90=S("b90"), b120=S("b120"), over=S("over")),
        reconciled=(est == 0),
        recon_note=("Balances and ledger live from the Sage Accounting API." if est == 0 else
                    "Live from the Sage Accounting API; %d club(s) hold unallocated credit shown as current." % est),
        clubs=sorted(clubs, key=lambda c: -c["bal"]))

    # ---- itemised ledger: FY posting docs, derived opening so close == live balance ----
    names = {c["code"]: c["name"] for c in clubs if c["code"]}
    docs = collections.defaultdict(list)
    coa = collections.defaultdict(lambda: {"amount": 0., "net": 0., "n": 0, "detail": []})
    for svc, ttype, mode in _LEDGER_FEEDS:
        for r in _fy_docs(svc):
            cd = cc(r)
            if not cd: continue
            date = (r.get("Date") or "")[:10]
            tot = float(r.get("Total") or 0)
            if mode == "debit": deb, cred = tot, 0.0
            elif mode == "credit": deb, cred = 0.0, tot
            else: deb, cred = (tot, 0.0) if tot > 0 else (0.0, -tot)
            ref = r.get("DocumentNumber") or r.get("Reference") or ""
            desc = (r.get("Description") or r.get("Reference") or "").strip()
            docs[cd].append((date, ref, ttype, desc, round(deb, 2), round(cred, 2)))
            if svc == "CustomerReceipt":
                ua = float(r.get("TotalUnallocated") or 0)
                if ua > 0.005:
                    s = coa[cd]; s["amount"] = round(s["amount"] + ua, 2); s["net"] = round(s["net"] + ua, 2); s["n"] += 1
                    s["detail"].append({"date": date, "ref": ref, "amount": round(ua, 2)})

    led_clubs = []; tie_off = 0
    for code, bal in code_bal.items():
        rows = sorted(docs.get(code, []), key=lambda x: (x[0], x[2], x[1]))
        movement = round(sum(deb - cred for (_, _, _, _, deb, cred) in rows), 2)
        opening = round(bal - movement, 2)      # derived => close always ties to the live balance
        out = [dict(tx_date=OPENING_DT, reference="", tx_type="Opening Balance",
                    description="Balance brought forward", debit=None, credit=None,
                    balance=opening, is_opening=True)]
        run = opening
        for (date, ref, ttype, desc, deb, cred) in rows:
            run = round(run + deb - cred, 2)
            out.append(dict(tx_date=date, reference=ref, tx_type=ttype, description=desc,
                            debit=(deb or None), credit=(cred or None), balance=run, is_opening=False))
        if abs(run - bal) > 0.01: tie_off += 1
        led_clubs.append(dict(club_key=code.lower(), code=code, name=names.get(code, code), rows=out))
    # last receipt date per club (for the "Last rcpt" column), from the posting docs
    last_rcpt = {}
    for cd, rws in docs.items():
        ds = [d for (d, _, tt, _, _, cr) in rws if tt == "Customer Receipt" and cr > 0 and d]
        if ds: last_rcpt[cd] = max(ds)
    for c in clubs:
        cd = c.get("code")
        if cd and cd in last_rcpt:
            try: c["last_receipt_days"] = (AS - datetime.date.fromisoformat(last_rcpt[cd])).days
            except Exception: pass
    lmeta = dict(ledger_from=FY_START, ledger_to=asat,
                 source="Sage Accounting API (live) - itemised customer ledger")
    coa_rows = [dict(club_key=cd.lower(), code=cd, name=names.get(cd, cd),
                     amount=s["amount"], net=s["net"], n=s["n"],
                     detail=sorted(s["detail"], key=lambda d: d["date"])[:20])
                for cd, s in coa.items() if s["amount"] > 0.01]
    # Sage's own open-item list: every invoice Sage still shows an amount due on
    # (AmountDue != 0). An invoice absent from here is fully paid per Sage's own
    # allocation. This is the authoritative source for whether a fine is settled.
    open_rows = []
    for r in inv_open:
        cd = cc(r)
        if not cd: continue
        ref = str(r.get("DocumentNumber") or r.get("Reference") or "").strip()
        if not ref: continue
        open_rows.append(dict(club_key=cd.lower(), code=cd, reference=ref,
            amount_due=round(float(r.get("AmountDue") or 0), 2),
            total=round(float(r.get("Total") or 0), 2),
            inv_date=(r.get("Date") or "")[:10]))
    stats = dict(n_clubs=len(clubs), n_owing=len(pos), owed=S("bal"), net=snap["net_total"],
                 est=est, n_ledger=len(led_clubs), n_rows=sum(len(c["rows"]) for c in led_clubs),
                 tie_off=tie_off, n_coa=len(coa_rows), n_contacts=len(contacts), n_open=len(open_rows),
                 buckets=(S("cur"), S("b30"), S("b60"), S("b90"), S("b120")))
    return snap, lmeta, led_clubs, coa_rows, contacts, open_rows, stats


# ==================== YTD DC income (GL accounts 1040/xxx) ====================
# DC income is more than the on-field case fines: it also includes administrative
# and compliance fines (meeting attendance, fixtures, etc.) and refundable process
# fees (protests and appeals). Each posts to a 1040/xxx income account in Sage.
# We reconstruct each account's financial-year movement from the postings the API
# exposes: invoice lines and credit-note lines (fines, per document), and direct
# AccountReceipt / AccountPayment / CustomerAdjustment on the account (fees, refunds,
# the SAFA cost order). Invoice/credit-note lines are cached in Supabase so each
# fetch only reads the documents that are new or changed.
DC_FAMILY = {
    "1040/000": ("other", "DC Fines (unallocated)"),
    "1040/001": ("fees",  "Appeal fees"),
    "1040/002": ("fees",  "Protest / complaint fees"),
    "1040/003": ("admin", "Failure to attend meeting"),
    "1040/004": ("admin", "Failure to fulfil fixture"),
    "1040/005": ("admin", "Failure to submit referee's report"),
    "1040/006": ("admin", "Failure to attend DC"),
    "1040/007": ("admin", "Failure to return trophy"),
    "1040/008": ("admin", "Failure to pay DC fine"),
    "1040/009": ("admin", "Failure to submit results"),
    "1040/010": ("admin", "Failure to submit protest"),
    "1040/011": ("admin", "Failure to pay protest fee"),
    "1040/012": ("match", "Unregistered / ineligible player"),
    "1040/013": ("match", "Abusive behaviour"),
    "1040/014": ("admin", "Withdrawal of team"),
    "1040/015": ("match", "Match abandonment"),
    "1040/016": ("match", "Misconduct towards official"),
    "1040/017": ("match", "Match infringement"),
    "1040/018": ("other", "Travelling / other costs"),
}
FAMILY_LABEL = {"match": "Match & conduct fines", "admin": "Administrative & compliance fines",
                "fees": "Protest & appeal fees (refundable)", "other": "Other DC income"}
FAMILY_ORDER = {"match": 1, "admin": 2, "fees": 3, "other": 4}

def call_rpc(fn, body):
    st, txt = post_rpc(fn, body)
    try:
        return st, (json.loads(txt) if txt not in (None, "") else None)
    except Exception:
        return st, txt

def _dc_code_from_desc(desc):
    m = re.search(r"1040\s*/?\s*(\d{3})\b", desc or "")
    return ("1040/" + m.group(1)) if m else None

def _dc_lines_from_doc(obj, doc_type):
    out = []
    did = str(obj.get("ID")); dnum = obj.get("DocumentNumber") or ""
    ddate = (obj.get("Date") or "")[:10] or None
    cust = obj.get("CustomerName") or ""; m = CODE.search(cust)
    club_code = m.group(1) if m else None; club_name = clean_name(cust)
    modified = obj.get("Modified")
    sign = 1.0 if doc_type == "invoice" else -1.0   # credit notes reduce income
    for ln in (obj.get("Lines") or []):
        code = _dc_code_from_desc(ln.get("Description") or "")
        if not code:
            continue
        amt = ln.get("Total")
        if amt in (None, ""):
            amt = float(ln.get("UnitPriceExclusive") or 0) * float(ln.get("Quantity") or 1)
        out.append(dict(line_id=str(ln.get("ID")), doc_id=did, doc_number=dnum, doc_type=doc_type,
                        doc_date=ddate, club_code=club_code, club_name=club_name,
                        account_code=code, account_name=DC_FAMILY.get(code, ("other", code))[1],
                        amount=round(sign * float(amt or 0), 2),
                        dc_ref=((ln.get("Comments") or "").strip() or None), modified=modified))
    return out

def _get_doc(svc, iid):
    for attempt in range(3):
        try:
            r = _cli.get(BASE + "/%s/Get/%s" % (svc, iid), params={"apikey": KEY, "CompanyId": CID})
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503):
                import time as _t; _t.sleep(1.5 * (attempt + 1)); continue
            return None
        except Exception:
            import time as _t; _t.sleep(1.0 * (attempt + 1))
    return None

def build_dc_income(push=False):
    """Reconstruct YTD DC income per 1040/xxx account and roll up by source family."""
    import concurrent.futures
    global AS; AS = datetime.date.today()
    accs = allrows("/Account/Get")
    dc_id2code = {}
    for a in accs:
        mm = re.match(r"\s*(1040/\d{3})", a.get("Name") or "")
        if mm:
            dc_id2code[a.get("ID")] = mm.group(1)
    # FY posting documents that can carry a fine line
    inv = _fy_docs("TaxInvoice"); cn = _fy_docs("CustomerReturn")
    docs = [("invoice", d) for d in inv] + [("credit_note", d) for d in cn]
    keep_doc_ids = [str(d.get("ID")) for _, d in docs]
    known = {}
    if push:
        _s, kn = call_rpc("dc_income_known", {"p_token": CFG["ingest_token"]})
        for r in (kn or []):
            known[str(r.get("doc_id"))] = (r.get("modified") or "")[:19]
    todo = [(t, d) for (t, d) in docs if not push or (d.get("Modified") or "")[:19] != known.get(str(d.get("ID")))]
    _log("info", "DC income: FY docs %d (inv %d, cn %d) | lines to (re)fetch %d | cached docs %d"
         % (len(docs), len(inv), len(cn), len(todo), len(known)))
    svc_of = {"invoice": "TaxInvoice", "credit_note": "CustomerReturn"}
    fresh = []; refetch_ids = []
    def work(item):
        t, d = item; return (t, str(d.get("ID")), _get_doc(svc_of[t], d.get("ID")))
    if todo:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            for (t, did, obj) in ex.map(work, todo):
                refetch_ids.append(did)
                if obj:
                    fresh += _dc_lines_from_doc(obj, t)
    if push:
        first = True
        for i in range(0, max(len(fresh), 1), 500):
            chunk = fresh[i:i + 500]
            call_rpc("dc_income_upsert_lines", {"p_token": CFG["ingest_token"], "p_rows": chunk,
                                                "p_replace_doc_ids": refetch_ids if first else []})
            first = False
        call_rpc("dc_income_prune", {"p_token": CFG["ingest_token"], "p_doc_ids": keep_doc_ids})
    # fees / refunds / adjustments posted directly to a DC account.
    # AccountReceipt/AccountPayment carry AccountId; adjustments carry an Account
    # object (customer) or an AccountName string (supplier) instead.
    def _acc_code_of(r):
        code = dc_id2code.get(r.get("AccountId"))
        if code:
            return code
        aobj = r.get("Account") or {}
        code = dc_id2code.get(aobj.get("ID"))
        if code:
            return code
        nm = r.get("AccountName") or aobj.get("Name") or ""
        mm = re.match(r"\s*(1040/\d{3})", nm)
        return mm.group(1) if mm else None
    def acc_sum(rows, sign):
        agg = collections.defaultdict(float); cnt = collections.defaultdict(int)
        for r in rows:
            code = _acc_code_of(r)
            if not code or (r.get("Date") or "")[:10] < FY_START:
                continue
            agg[code] += sign * float(r.get("Total") or r.get("Amount") or 0); cnt[code] += 1
        return agg, cnt
    rcp_a, rcp_n = acc_sum(allrows("/AccountReceipt/Get"), 1.0)
    pay_a, pay_n = acc_sum(allrows("/AccountPayment/Get"), -1.0)
    cadj_a, cadj_n = acc_sum(allrows("/CustomerAdjustment/Get"), 1.0)
    sadj_a, sadj_n = acc_sum(allrows("/SupplierAdjustment/Get"), -1.0)   # supplier side posts inversely to income
    adj_a = collections.defaultdict(float); adj_n = collections.defaultdict(int)
    for src_a, src_n in ((cadj_a, cadj_n), (sadj_a, sadj_n)):
        for k, v in src_a.items(): adj_a[k] += v
        for k, v in src_n.items(): adj_n[k] += v
    # invoiced fines from the cached lines (read back the full cache on push)
    lines_all = fresh
    if push:
        _s, la = call_rpc("dc_income_lines_get", {"p_token": CFG["ingest_token"]})
        if isinstance(la, list):
            lines_all = la
    inv_by_code = collections.defaultdict(float); inv_n = collections.defaultdict(int)
    for l in lines_all:
        if (l.get("doc_date") or "")[:10] and (l.get("doc_date") or "")[:10] < FY_START:
            continue
        inv_by_code[l["account_code"]] += float(l.get("amount") or 0); inv_n[l["account_code"]] += 1
    codes = set(inv_by_code) | set(rcp_a) | set(pay_a) | set(adj_a)
    per = []
    for code in codes:
        fam, label = DC_FAMILY.get(code, ("other", code))
        invoiced = round(inv_by_code.get(code, 0.0), 2); receipts = round(rcp_a.get(code, 0.0), 2)
        payments = round(pay_a.get(code, 0.0), 2); adjust = round(adj_a.get(code, 0.0), 2)
        per.append(dict(code=code, label=label, family=fam,
                        invoiced=invoiced, receipts=receipts, payments=payments, adjustments=adjust,
                        net=round(invoiced + receipts + payments + adjust, 2),
                        n_invoiced=inv_n.get(code, 0), n_receipts=rcp_n.get(code, 0)))
    per.sort(key=lambda p: (FAMILY_ORDER.get(p["family"], 9), -p["net"], p["code"]))
    fam_tot = collections.OrderedDict()
    for f in sorted(FAMILY_ORDER, key=lambda k: FAMILY_ORDER[k]):
        fp = [p for p in per if p["family"] == f]
        if not fp:
            continue
        fam_tot[f] = dict(family=f, label=FAMILY_LABEL.get(f, f),
                          net=round(sum(p["net"] for p in fp), 2),
                          invoiced=round(sum(p["invoiced"] for p in fp), 2),
                          receipts=round(sum(p["receipts"] for p in fp), 2),
                          payments=round(sum(p["payments"] for p in fp), 2),
                          adjustments=round(sum(p["adjustments"] for p in fp), 2),
                          accounts=fp)
    payload = dict(fy_start=FY_START, as_at=str(AS),
                   total=round(sum(p["net"] for p in per), 2),
                   total_invoiced=round(sum(p["invoiced"] for p in per), 2),
                   total_receipts=round(sum(p["receipts"] for p in per), 2),
                   total_payments=round(sum(p["payments"] for p in per), 2),
                   total_adjustments=round(sum(p["adjustments"] for p in per), 2),
                   families=list(fam_tot.values()),
                   source="Sage Accounting API (live) — GL income accounts 1040/xxx: invoice & credit-note lines, direct receipts, refunds and the SAFA cost order")
    return payload


def main(argv):
    need = [("SAGE_API_KEY", KEY), ("SAGE_USER", USER), ("SAGE_PASS", PASS)]
    if "--push" in argv or "--dc-push" in argv:
        need += [("SUPABASE_URL", CFG["supabase_url"]),
                 ("SUPABASE_PUBLISHABLE_KEY", CFG["publishable_key"]),
                 ("SUPABASE_INGEST_TOKEN", CFG["ingest_token"])]
    miss = [n for n, v in need if not v]
    if miss:
        _log("stop", "missing credentials/config: %s — set them as environment variables "
                     "(GitHub Actions secrets), or on the office PC via loader.json + Credential Manager."
                     % ", ".join(miss))
        return 2
    if "--dc" in argv or "--dc-push" in argv:   # YTD DC income by source family
        push = "--dc-push" in argv
        pl = build_dc_income(push=push)
        print("YTD DC income (FY from %s, as at %s): R%.2f" % (pl["fy_start"], pl["as_at"], pl["total"]))
        print("  invoiced R%.2f | receipts R%.2f | payments R%.2f | adjustments R%.2f"
              % (pl["total_invoiced"], pl["total_receipts"], pl["total_payments"], pl["total_adjustments"]))
        for fam in pl["families"]:
            print("  [%s] %s  net R%.2f" % (fam["family"], fam["label"], fam["net"]))
            for a in fam["accounts"]:
                print("      %-9s %-38s net R%9.2f (inv %.0f rcp %.0f pay %.0f adj %.0f)"
                      % (a["code"], a["label"][:38], a["net"], a["invoiced"], a["receipts"], a["payments"], a["adjustments"]))
        if push:
            s, t = call_rpc("dc_income_load", {"p_token": CFG["ingest_token"], "p_payload": pl})
            print("PUSH dc_income ->", s, str(t)[:120])
        else:
            print("(dry run - add --dc-push to write the DC income summary)")
        return 0
    if "--probe" in argv:   # read-only: show the Customer object field names (email/phone/address) — nothing is written
        for c in allrows("/Customer/Get")[:3]:
            print("KEYS:", sorted(c.keys()))
            for k in sorted(c.keys()):
                if any(t in k.lower() for t in ("email", "mail", "phone", "mobile", "tel", "cell", "address", "postal", "suburb", "city", "physical", "delivery")):
                    print("   %s = %r" % (k, c.get(k)))
            print("---")
        return 0
    if "--probe-adj" in argv:   # read-only: CustomerAdjustment shape + detail (how it attributes to an account)
        for path in ["/CustomerAdjustment/Get", "/SupplierAdjustment/Get"]:
            r = _cli.get(BASE + path, params={"apikey": KEY, "CompanyId": CID, "$top": 3})
            print("== %s HTTP %s" % (path, r.status_code))
            if r.status_code == 200:
                d = r.json(); rows = d.get("Results", d) if isinstance(d, dict) else d
                if rows:
                    print("   keys:", sorted(rows[0].keys()))
                    for rr in rows[:3]:
                        print("   row:", json.dumps(rr)[:500])
                    iid = rows[0].get("ID")
                    rd = _cli.get(BASE + path.replace("/Get", "/Get/%s" % iid), params={"apikey": KEY, "CompanyId": CID})
                    print("   detail Get/%s HTTP %s:" % (iid, rd.status_code), rd.text[:700])
        # a known FY customer adjustment on the protest account (reference CADJ0000137)
        r = _cli.get(BASE + "/CustomerAdjustment/Get", params={"apikey": KEY, "CompanyId": CID, "$filter": "Reference eq 'CADJ0000137'", "$top": 3})
        print("== CADJ0000137 lookup HTTP %s:" % r.status_code, r.text[:600])
        return 0
    if "--probe-gl" in argv:   # read-only: discover the DC income GL accounts and posting shapes
        def _show(label, path, top=2, flt=None, expand=None):
            prm = {"apikey": KEY, "CompanyId": CID, "$top": top}
            if flt: prm["$filter"] = flt
            if expand: prm["$expand"] = expand
            try:
                r = _cli.get(BASE + path, params=prm)
                print("== %s  %s  -> HTTP %s" % (label, path, r.status_code))
                if r.status_code == 200:
                    d = r.json(); rows = d.get("Results", d) if isinstance(d, dict) else d
                    if isinstance(d, dict) and "TotalResults" in d: print("   TotalResults:", d.get("TotalResults"))
                    if isinstance(rows, list) and rows:
                        print("   keys:", sorted(rows[0].keys()))
                        print("   sample:", json.dumps(rows[0])[:1400])
                    elif isinstance(rows, list):
                        print("   (empty list)")
                else:
                    print("   body:", r.text[:240])
            except Exception as e:
                print("== %s  %s  -> ERR %s" % (label, path, str(e)[:200]))
        # 1) chart of accounts / categories — find the DC income accounts and their IDs
        for acc_path in ("/Account/Get", "/Category/Get"):
            try:
                accs = allrows(acc_path)
            except Exception as e:
                print("ACCTS %s ERR %s" % (acc_path, str(e)[:160])); continue
            print("ACCTS %s total %d" % (acc_path, len(accs)))
            if accs: print("   ACC keys:", sorted(accs[0].keys())); print("   ACC sample:", json.dumps(accs[0])[:600])
            for a in accs:
                nm = (a.get("Name") or a.get("Description") or "") 
                low = nm.lower()
                if ("1040" in json.dumps(a)) or ("dc fine" in low) or ("protest" in low) or ("appeal" in low) or ("fine" in low):
                    print("   DC ACC:", json.dumps(a)[:400])
        # 2) posting shapes — invoices, account receipts/payments, credit notes (with lines)
        _show("TaxInvoice", "/TaxInvoice/Get", top=1)
        _show("TaxInvoice+Lines", "/TaxInvoice/Get", top=1, expand="Lines")
        _show("AccountReceipt", "/AccountReceipt/Get", top=2)
        _show("AccountReceipt+Lines", "/AccountReceipt/Get", top=1, expand="Lines")
        _show("AccountPayment", "/AccountPayment/Get", top=2)
        _show("AccountPayment+Lines", "/AccountPayment/Get", top=1, expand="Lines")
        _show("CustomerReturn+Lines", "/CustomerReturn/Get", top=1, expand="Lines")
        return 0
    if "--probe-gl2" in argv:   # read-only: find how invoice/credit-note lines attribute to a GL account
        def get(path, **prm):
            prm = dict({"apikey": KEY, "CompanyId": CID}, **prm)
            try:
                r = _cli.get(BASE + path, params=prm)
                return r
            except Exception as e:
                print("ERR", path, prm, str(e)[:160]); return None
        # A) a known DC fine invoice by document number -> its ID, then detail variants (lines?)
        r = get("/TaxInvoice/Get", **{"$filter": "DocumentNumber eq 'INA20259'", "$top": 1})
        inv = {}
        if r is not None and r.status_code == 200:
            d = r.json(); rows = d.get("Results", d) if isinstance(d, dict) else d
            inv = rows[0] if rows else {}
        iid = inv.get("ID"); print("INA20259 lookup -> ID", iid)
        for path in ["/TaxInvoice/Get/%s" % iid, "/TaxInvoice/Detail", "/TaxInvoiceLine/Get", "/TaxInvoiceDetail/Get"]:
            if not iid: break
            if path == "/TaxInvoice/Detail":
                rr = get(path, ID=iid)
            elif path == "/TaxInvoiceLine/Get":
                rr = get(path, **{"$filter": "DocumentId eq %s" % iid, "$top": 20})
            elif path == "/TaxInvoiceDetail/Get":
                rr = get(path, **{"$filter": "TaxInvoiceId eq %s" % iid, "$top": 20})
            else:
                rr = get(path)
            if rr is not None:
                print("== %s -> HTTP %s" % (path, rr.status_code)); print("   ", rr.text[:1200])
        # B) account-transaction / journal endpoints for the protest fee account 16536141
        for path in ["/Account/GetTransactions", "/Account/Transactions", "/AccountTransaction/Get",
                     "/Journal/Get", "/JournalEntry/Get", "/Account/GetAccountTransactions"]:
            hit = False
            for prm in [{"AccountId": 16536141, "$top": 3}, {"ID": 16536141, "$top": 3},
                        {"AccountId": 16536141, "fromDate": FY_START, "toDate": str(AS)}, {"$top": 3}]:
                rr = get(path, **prm)
                if rr is None: continue
                print("== %s %s -> HTTP %s" % (path, {k: v for k, v in prm.items() if k != "$top"}, rr.status_code))
                if rr.status_code == 200:
                    print("   ", rr.text[:900]); hit = True; break
                else:
                    print("   ", rr.text[:150])
            if hit: break
        return 0
    if "--probe-gl3" in argv:   # read-only: verify JournalEntry FY movement per DC account reconciles to the report
        DC = [(16536142, "1040/003 attend meeting", 9200), (16536143, "1040/004 fulfil fixture", 1950),
              (16536149, "1040/010 submit protest", 250), (16536155, "1040/016 misconduct", 10700),
              (16536156, "1040/017 match infringement", 34400), (16536140, "1040/001 appeal fee", 3800),
              (16536141, "1040/002 protest fee", 25700), (16536319, "1040/000 DC Fines parent", 0)]
        for aid, label, expect in DC:
            flt = "AccountId eq %d and Date ge datetime'%sT00:00:00'" % (aid, FY_START)
            rows = allrows("/JournalEntry/Get", flt)
            cr = sum(float(r.get("Credit") or 0) for r in rows)
            db = sum(float(r.get("Debit") or 0) for r in rows)
            print("ACC %-32s n=%-4d credit=%9.2f debit=%9.2f net=%9.2f  (report %s)"
                  % (label, len(rows), cr, db, cr - db, expect))
        return 0
    if "--probe-gl4" in argv:   # read-only: pull the whole journal, aggregate DC income FY movement client-side
        accs = allrows("/Account/Get")
        dcmap = {}   # account id -> name  (the 1040/xxx DC Fines family)
        for a in accs:
            nm = a.get("Name") or ""
            if nm.strip().startswith("1040/"):
                dcmap[a.get("ID")] = nm
        print("DC accounts:", len(dcmap))
        je = allrows("/JournalEntry/Get")
        print("journal rows total:", len(je))
        agg = {}
        for r in je:
            aid = r.get("AccountId")
            if aid not in dcmap: continue
            dt = (r.get("Date") or "")[:10]
            if dt < FY_START: continue
            a = agg.setdefault(aid, {"cr": 0.0, "db": 0.0, "n": 0})
            a["cr"] += float(r.get("Credit") or 0); a["db"] += float(r.get("Debit") or 0); a["n"] += 1
        grand = 0.0
        for aid, nm in sorted(dcmap.items(), key=lambda kv: kv[1]):
            a = agg.get(aid)
            if not a: continue
            net = a["cr"] - a["db"]; grand += net
            print("  %-52s n=%-4d net=%10.2f" % (nm[:52], a["n"], net))
        print("GRAND TOTAL YTD DC income (all 1040/ accounts): %.2f" % grand)
        return 0
    if "--probe-gl5" in argv:   # read-only: FY invoice volume + validate line->account parse + fee receipts/payments
        import time as _t
        fy_inv = allrows("/TaxInvoice/Get", "Date ge datetime'%sT00:00:00'" % FY_START)
        print("FY invoices (headers):", len(fy_inv))
        t0 = _t.time(); dc_by_code = {}; dc_lines = 0; sampled = 0
        for inv in fy_inv[:80]:
            iid = inv.get("ID")
            r = _cli.get(BASE + "/TaxInvoice/Get/%s" % iid, params={"apikey": KEY, "CompanyId": CID})
            sampled += 1
            if r.status_code != 200: continue
            for ln in (r.json().get("Lines") or []):
                desc = ln.get("Description") or ""
                m = re.search(r"1040\s*/?\s*0*(\d{2,3})", desc) or re.search(r":\s*1040(\d{3})", desc)
                if "dc fine" in desc.lower() or m:
                    code = ("1040/%03d" % int(m.group(1))) if m else "1040/?"
                    amt = float(ln.get("UnitPriceExclusive") or 0) * float(ln.get("Quantity") or 1)
                    dc_by_code[code] = dc_by_code.get(code, 0.0) + amt; dc_lines += 1
        dt = _t.time() - t0
        print("sampled %d invoices in %.1fs (%.3fs each); DC lines found %d" % (sampled, dt, dt / max(sampled, 1), dc_lines))
        for c in sorted(dc_by_code): print("   ", c, "=", round(dc_by_code[c], 2))
        print("sample line:", json.dumps((_cli.get(BASE + "/TaxInvoice/Get/%s" % fy_inv[0]["ID"], params={"apikey": KEY, "CompanyId": CID}).json().get("Lines") or [{}])[0])[:500])
        # fee receipts & payments by account (FY)
        DCIDS = {16536140: "1040/001 appeal", 16536141: "1040/002 protest"}
        rcp = allrows("/AccountReceipt/Get")
        pay = allrows("/AccountPayment/Get")
        def sumacc(rows, ids):
            agg = {}
            for r in rows:
                aid = r.get("AccountId")
                if aid in ids and (r.get("Date") or "")[:10] >= FY_START:
                    a = agg.setdefault(aid, {"t": 0.0, "n": 0}); a["t"] += float(r.get("Total") or 0); a["n"] += 1
            return agg
        print("AccountReceipt FY by DC acct:", {DCIDS.get(k, k): v for k, v in sumacc(rcp, DCIDS).items()}, "of", len(rcp))
        print("AccountPayment FY by DC acct:", {DCIDS.get(k, k): v for k, v in sumacc(pay, DCIDS).items()}, "of", len(pay))
        return 0
    snap, lmeta, led_clubs, coa_rows, contacts, open_rows, st = build()
    print("clubs %d | owing %d | owed R%.2f | net R%.2f | estimated-ageing %d"
          % (st["n_clubs"], st["n_owing"], st["owed"], st["net"], st["est"]))
    print("buckets cur R%.0f | 30 R%.0f | 60 R%.0f | 90 R%.0f | 120 R%.0f" % st["buckets"])
    print("ledger %d clubs | %d rows | closes NOT tying live balance: %d | cash-on-account clubs %d"
          % (st["n_ledger"], st["n_rows"], st["tie_off"], st["n_coa"]))
    print("contacts %d clubs with an email (sample: %s)"
          % (st["n_contacts"], ", ".join("%s=%s" % (c["club_key"], c["email"]) for c in contacts[:3]) or "none — check Sage Customer field names"))
    if "--push" not in argv:
        print("(dry run - add  --push  to write snapshot + ledger to the dashboard)")
        return 0
    s1, t1 = post_rpc("deb_load_snapshot", {"p_token": CFG["ingest_token"], "p_payload": snap})
    print("PUSH snapshot     ->", s1, t1[:120])
    s2, t2 = post_rpc("deb_load_transactions", {"p_token": CFG["ingest_token"], "p_meta": lmeta, "p_clubs": led_clubs})
    print("PUSH ledger       ->", s2, t2[:120])
    try:
        s3, t3 = post_rpc("deb_cash_on_account_load", {"p_token": CFG["ingest_token"], "p_rows": coa_rows})
        print("PUSH cash-on-acct ->", s3, t3[:120])
    except Exception as e:
        print("cash-on-account skipped:", str(e)[:120])
    try:
        if contacts:
            s4, t4 = post_rpc("deb_contacts_load", {"p_token": CFG["ingest_token"], "p_rows": contacts})
            print("PUSH contacts     ->", s4, t4[:120])
        else:
            print("PUSH contacts     -> skipped (no emails found — check the Sage Customer field names)")
    except Exception as e:
        print("contacts skipped:", str(e)[:120])
    try:
        s5, t5 = post_rpc("deb_load_open_invoices", {"p_token": CFG["ingest_token"], "p_rows": open_rows})
        print("PUSH open-items   ->", s5, t5[:120])
    except Exception as e:
        print("open-items skipped:", str(e)[:120])
    return 0 if (s1 < 300 and s2 < 300) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
