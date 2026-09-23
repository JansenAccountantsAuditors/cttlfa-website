"""CTTLFA dash.cttlfa.com - nightly mirror into the main CTTLFA Supabase.

Pulls every table off the disciplinary / cards / fixtures dashboard
(dash.cttlfa.com, a Supabase-backed SPA) and lands it, unchanged, in the
main CTTLFA Supabase as dash_* data. One admin login reads the source; the
main database is written through the same ingest-token RPC as the debtors
fetch, so no service key ever sits on the machine.

Configuration and credentials are read from environment variables first
(the GitHub Actions path), then fall back to Windows Credential Manager and
a loader.json (the retired office-PC path). No secret value lives in this
file or in the repository.

  Env vars (GitHub Actions secrets / repository variables):
    DASH_URL                  source Supabase URL (dash.cttlfa.com project)
    DASH_ANON_KEY             source public anon key (embedded in the site)
    DASH_EMAIL               dash admin login email
    DASH_PASSWORD            dash admin login password
    SUPABASE_URL              main CTTLFA Supabase URL (write target)
    SUPABASE_PUBLISHABLE_KEY  main public anon key
    SUPABASE_INGEST_TOKEN     ingest token for dash_load / dash_finish

  Office-PC fallback (only used when the env vars are absent):
    keyring dashfetch_cttlfa/login = "email\\npassword"
    loader.json (dash_url, dash_anon_key, supabase_url, publishable_key,
                 ingest_token)

Usage:
    python dash_fetch.py --set-login   one-off: store the dash admin login
                                        (prompts; nothing is echoed)
    python dash_fetch.py               dry run: log in, count every table,
                                        write nothing
    python dash_fetch.py --probe       same as dry run (read-only counts)
    python dash_fetch.py --push        pull everything and write dash_* to
                                        the main database (the nightly run)
"""
import os, sys, json, getpass, datetime, urllib.request, urllib.error
import httpx

SERVICE = "dashfetch_cttlfa"
HOME = os.environ.get("DASHFETCH_HOME") or os.path.join(os.path.expanduser("~"), ".dashfetch_cttlfa")
CFG_PATH = os.path.join(HOME, "loader.json")

# Source tables and their primary-key column. Everything keys on "id"
# except clubs and divisions, which key on "name".
TABLES = [
    ("administrative_rulings", "id"),
    ("administrative_rulings_archive", "id"),
    ("charges", "id"),
    ("yellow_cards", "id"),
    ("yellow_cards_archive", "id"),
    ("suspension_rules", "id"),
    ("players", "id"),
    ("clubs", "name"),
    ("club_contacts", "id"),
    ("divisions", "name"),
    ("fixtures", "id"),
    ("fixtures_archive", "id"),
    ("fixture_sets", "id"),
    ("referees", "id"),
    ("referee_accreditations", "id"),
    ("announcements", "id"),
    ("announcement_tags", "id"),
    ("announcement_tag_assignments", "id"),
    ("announcement_attachments", "id"),
    ("announcement_reads", "id"),
    ("admin_emails", "id"),
    ("admin_email_events", "id"),
    ("admin_email_signatures", "id"),
    ("mailing_lists", "id"),
    ("mailing_list_recipients", "id"),
    ("profiles", "id"),
    ("support_tickets", "id"),
    ("ticket_replies", "id"),
    ("ticket_attachments", "id"),
    ("audit_logs", "id"),
]

PAGE = 1000


def _log(level, msg):
    print("[%s] %s" % (level, msg), flush=True)


def _kr(entry):
    """Lazy Windows Credential Manager read; silent if keyring is absent
    (e.g. on the GitHub Actions runner, which never needs it)."""
    try:
        import keyring
        return keyring.get_password(SERVICE, entry) or ""
    except Exception:
        return ""


_CFG_FILE = None


def _cfg_file():
    """Load loader.json once, if it exists. Absent on the runner."""
    global _CFG_FILE
    if _CFG_FILE is None:
        try:
            _CFG_FILE = json.load(open(CFG_PATH, encoding="utf-8")) if os.path.exists(CFG_PATH) else {}
        except Exception:
            _CFG_FILE = {}
    return _CFG_FILE


def _cfg(env_name, file_key, default=""):
    v = os.environ.get(env_name)
    if v not in (None, ""):
        return v
    fv = _cfg_file().get(file_key)
    if fv not in (None, ""):
        return fv
    return default


def set_login():
    """Store the dash admin email + password in Windows Credential Manager.
    Interactive: the operator types them; nothing is printed back."""
    os.makedirs(HOME, exist_ok=True)
    print("Enter the dash.cttlfa.com ADMIN login (stored in Windows Credentials only).")
    email = input("  email    : ").strip()
    pw = getpass.getpass("  password : ")
    if not email or not pw:
        _log("stop", "email and password are both required - nothing stored.")
        return 1
    try:
        import keyring
        keyring.set_password(SERVICE, "login", email + "\n" + pw)
    except Exception as e:
        _log("stop", "could not store the login (keyring unavailable): %s" % e)
        return 1
    _log("ok", "login stored for %s. You can now run --probe or --push." % email)
    return 0


def load_cfg():
    """Assemble config from environment first, then loader.json."""
    return {
        "dash_url": _cfg("DASH_URL", "dash_url"),
        "dash_anon_key": _cfg("DASH_ANON_KEY", "dash_anon_key"),
        "supabase_url": _cfg("SUPABASE_URL", "supabase_url"),
        "publishable_key": _cfg("SUPABASE_PUBLISHABLE_KEY", "publishable_key"),
        "ingest_token": _cfg("SUPABASE_INGEST_TOKEN", "ingest_token"),
    }


def get_login():
    """Env vars first (GitHub Actions), then the keyring blob."""
    email = (os.environ.get("DASH_EMAIL") or "").strip()
    pw = os.environ.get("DASH_PASSWORD") or ""
    if not (email and pw):
        e2, _, p2 = _kr("login").partition("\n")
        email = email or e2.strip()
        pw = pw or p2
    return email, pw


def dash_signin(cfg, email, pw):
    """Exchange the admin email/password for an access token on the source."""
    url = cfg["dash_url"].rstrip("/") + "/auth/v1/token?grant_type=password"
    r = httpx.post(url, timeout=60.0,
                   headers={"apikey": cfg["dash_anon_key"], "Content-Type": "application/json"},
                   json={"email": email, "password": pw})
    if r.status_code != 200:
        _log("stop", "dash sign-in failed: HTTP %s %s" % (r.status_code, r.text[:160]))
        sys.exit(1)
    tok = r.json().get("access_token")
    if not tok:
        _log("stop", "dash sign-in returned no access_token.")
        sys.exit(1)
    return tok


def dash_read(cli, cfg, token, table, pk):
    """Read a whole source table via PostgREST, paged and pk-ordered."""
    base = cfg["dash_url"].rstrip("/") + "/rest/v1/" + table
    hdr = {"apikey": cfg["dash_anon_key"], "Authorization": "Bearer " + token}
    rows = []
    offset = 0
    while True:
        params = {"select": "*", "order": pk + ".asc", "limit": PAGE, "offset": offset}
        r = cli.get(base, params=params, headers=hdr)
        if r.status_code == 401:
            return None, "unauthorised"
        if r.status_code != 200:
            return None, "HTTP %s %s" % (r.status_code, r.text[:120])
        batch = r.json()
        if not isinstance(batch, list):
            return None, "unexpected body %r" % (str(batch)[:80])
        rows += batch
        if len(batch) < PAGE:
            break
        offset += len(batch)
    return rows, None


def post_rpc(cfg, fn, body):
    url = cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + fn
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "apikey": cfg["publishable_key"], "Authorization": "Bearer " + cfg["publishable_key"],
        "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def run(push):
    cfg = load_cfg()
    email, pw = get_login()

    miss = [k for k in ("dash_url", "dash_anon_key", "supabase_url", "publishable_key", "ingest_token") if not cfg.get(k)]
    if not email:
        miss.append("DASH_EMAIL")
    if not pw:
        miss.append("DASH_PASSWORD")
    if miss:
        _log("stop", "missing configuration/credentials: %s" % ", ".join(miss))
        _log("stop", "set them as environment variables (GitHub Actions secrets) or, on the office PC, "
                     "in %s and Windows Credentials (python dash_fetch.py --set-login)." % CFG_PATH)
        return 2

    token = dash_signin(cfg, email, pw)
    _log("info", "signed in to %s as %s" % (cfg["dash_url"], email))

    cli = httpx.Client(timeout=180.0)
    total_rows = 0
    ok_tables = 0
    failed = []
    for table, pk in TABLES:
        rows, err = dash_read(cli, cfg, token, table, pk)
        if err:
            _log("warn", "%-32s read failed: %s" % (table, err))
            failed.append(table)
            continue
        total_rows += len(rows)
        ok_tables += 1
        if not push:
            _log("info", "%-32s %5d rows" % (table, len(rows)))
            continue
        status, body = post_rpc(cfg, "dash_load", {
            "p_token": cfg["ingest_token"], "p_table": table, "p_pk_key": pk, "p_rows": rows})
        if status >= 300:
            _log("warn", "%-32s load HTTP %s %s" % (table, status, body[:120]))
            failed.append(table)
        else:
            _log("info", "%-32s %5d rows -> %s" % (table, len(rows), body[:80]))

    _log("info", "read %d/%d tables, %d rows total" % (ok_tables, len(TABLES), total_rows))
    if not push:
        _log("info", "dry run - add  --push  to write dash_* to the main database.")
        return 0 if not failed else 1

    note = "dash.cttlfa.com nightly mirror as at %s" % datetime.datetime.now().isoformat(timespec="seconds")
    s, b = post_rpc(cfg, "dash_finish", {"p_token": cfg["ingest_token"], "p_note": note})
    _log("info", "finish -> %s %s" % (s, b[:120]))
    if failed:
        _log("warn", "tables with problems: %s" % ", ".join(failed))
    return 0 if (s < 300 and not failed) else 1


def main(argv):
    if "--set-login" in argv:
        return set_login()
    return run(push=("--push" in argv))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
