#!/usr/bin/env python3
"""
CTTLFA — LeagueRepublic -> season.json sync  (Route 2: scrape, auto-discovery)
=============================================================================
Discovers EVERY competition in a season straight from LeagueRepublic (no
hard-coded division list), scrapes each one, and writes a season.json the
website renders natively. Youth (U18/U16/U14/U12), veterans and women's
divisions are all picked up automatically. No login, no paid plan.

    pip install requests beautifulsoup4
    python3 lr_sync.py                       # -> season.json        (2026, current)
    python3 lr_sync.py --season 2025 \
            --out season-2025.json           # -> 2025 archive

Schedule with the GitHub Action in .github/workflows/ (every 20 min).

How it works: any competition page carries a <select> of that season's
competitions (name + fixtureGroup key). We read that once from a season "seed"
page, then scrape each competition's standings, results and fixtures, plus the
LeagueRepublic-hosted team crest ids.
"""

import argparse, json, re, sys, os, datetime, time
import requests
try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Install deps:  pip install requests beautifulsoup4")

SITE = "https://cttfass.leaguerepublic.com"
CREST_BASE = "https://images.leaguerepublic.com/data/images"   # /<id>/115.jpg
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-ZA,en;q=0.9"}

# One "seed" fixtureGroup per season — any division id from that season works.
SEASONS = {
    "2026": {"label": "CTTLFA 2026", "seed": "1_616774953"},   # A1 Premier 2026
    "2025": {"label": "CTTLFA 2025", "seed": "1_950683955"},   # A1 Premier 2025
    # add older seasons here with any one of that season's fixtureGroup ids.
}

MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PREFIX = re.compile(r"^[A-Za-z0-9]{1,5}-\s*\d+\s*-\s*")   # strips "PD-01- " team codes


SESSION = requests.Session()
SESSION.headers.update(UA)


def get(url):
    # Shared session so the cookie LeagueRepublic sets on the /fg/ page is carried
    # to the report endpoints (the matchHub 'View All Matches' view), which return
    # an empty HTTP 202 to a cookieless request.
    r = SESSION.get(url, timeout=30)
    r.raise_for_status()
    return r.text


def clean(s):
    return PREFIX.sub("", re.sub(r"\s+", " ", (s or "")).strip()).strip()


def fdate(s):
    m = re.search(r"(\d{2})/(\d{2})/\d{2}", s or "")
    return f"{int(m.group(1))} {MON[int(m.group(2))]}" if m else (s or "").strip()


def ftime(s):
    m = re.search(r"(\d{2}:\d{2})", s or "")
    return m.group(1) if m else ""


def group_of(code):
    if code in ("A2", "B2", "C2"):
        return "Reserves"
    c = code[:1]
    return ("Senior Divisions" if c in "ABCD" else "Veterans" if c in "EFG"
            else "Women" if c == "H" else "Under-18" if c == "I" else "Under-16" if c == "K"
            else "Under-14" if c == "M" else "Under-12" if c == "O" else "Other")


def crest_id(cell):
    img = cell.find("img")
    m = re.search(r"images/(\d+)/", img.get("src", "")) if img else None
    return m.group(1) if m else ""


def discover(seed):
    """Return [(code, name, fgkey)] for every LEAGUE competition in the season."""
    soup = BeautifulSoup(get(f"{SITE}/fg/{seed}.html"), "html.parser")
    sel = soup.find("select", attrs={"name": "fixtureGroupPageContent.filterFixtureGroupKey"})
    out = []
    for o in sel.find_all("option"):
        val = o.get("value", "")
        if not val.startswith("1_"):          # 1_ = league, 2_ = knockout (skip)
            continue
        txt = o.get_text(" ", strip=True)
        code, _, name = txt.partition("-")
        out.append((code.strip(), name.strip(), val))
    return out


def sortkey(s):
    """Sortable key from a dd/mm/yy date cell so results order chronologically."""
    m = re.search(r"(\d{2})/(\d{2})/(\d{2})", s or "")
    return (int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else (0, 0, 0)


def compute_form(table, allres):
    """Attach a last-5 W/D/L string (oldest->newest) to each standings row."""
    seq = {}
    for hn, an, hs, as_, _dt in sorted(allres, key=lambda x: sortkey(x[4])):
        hs, as_ = int(hs), int(as_)
        seq.setdefault(hn, []).append("W" if hs > as_ else "L" if hs < as_ else "D")
        seq.setdefault(an, []).append("W" if as_ > hs else "L" if as_ < hs else "D")
    for row in table:
        f = seq.get(row[0])
        if f:
            row[8] = "".join(f[-5:])


def _parse_fixture_rows(fsoup, out, seen):
    """Append upcoming fixtures from one matchHub page; de-dupe on (home,away,date,
    time) so page-boundary overlaps don't double up, and drop stale past-dated rows
    (the view lists old postponed matches too). Returns how many NEW rows it added."""
    cutoff = datetime.date.today() - datetime.timedelta(days=1)
    added = 0
    for tb in fsoup.find_all("table"):
        for r in tb.find_all("tr"):
            td = r.find_all("td")
            if len(td) < 5:
                continue
            dtx = td[0].get_text(" ", strip=True)
            m = re.search(r"(\d{2})/(\d{2})/(\d{2})", dtx)
            if not m:                                           # header / non-match row
                continue
            if re.search(r"\d+\s*-\s*\d+", td[2].get_text(" ", strip=True)):
                continue                                        # already played (carries a score)
            try:
                d = datetime.date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))
            except ValueError:
                continue
            if d < cutoff:                                      # drop stale / past-dated rows
                continue
            hraw = td[1].get_text(" ", strip=True)
            araw = td[3].get_text(" ", strip=True)
            hn, an = clean(hraw), clean(araw)
            if not (hn and an):
                continue
            tm = ftime(dtx)
            key = (hn, an, fdate(dtx), tm)
            if key in seen:                                     # de-dupe page overlaps
                continue
            seen.add(key)
            ven = td[4].get_text(" ", strip=True)
            ven = ven.split("@", 1)[1].strip() if "@" in ven else ""
            # trailing full team codes (fullcode) let the caller attribute each match
            # to its exact division and are stripped before the fixture is published.
            out.append([hn, an, fdate(dtx), tm, ven, fullcode(hraw), fullcode(araw)])
            added += 1
    return added


def scrape_all_fixtures(soup):
    """Full upcoming-fixtures list from LeagueRepublic's 'View All Matches' view.
    The /fg/ page only shows the next fixture date or two; this view lists the whole
    remaining programme, but 20 per page — so we follow the 'Next' link to the end.
    Returns [[home, away, date, time, venue], ...] or [] if the view can't be read
    (the caller then keeps the /fg/ list as a fallback, so it can never regress)."""
    link = soup.find("a", href=re.compile(r"/matchHub/.+/1/true\.html"))
    href = re.sub(r"\s+", "", (link.get("href") if link else "") or "")
    if not href:
        return None                                             # can't locate the view -> keep /fg/ list
    url = href if href.startswith("http") else SITE + href
    out, seen, seen_urls = [], set(), set()
    got_page = False
    for _ in range(80):                                         # page safety cap
        if not url or url in seen_urls:
            break
        seen_urls.add(url)
        try:
            fsoup = BeautifulSoup(get(url), "html.parser")
        except Exception:
            break
        got_page = True
        if _parse_fixture_rows(fsoup, out, seen) == 0:          # page added nothing new -> end/wrap
            break
        nxt = next((a for a in fsoup.find_all("a")
                    if a.get_text(strip=True).lower() == "next"), None)
        nhref = re.sub(r"\s+", "", (nxt.get("href") if nxt else "") or "")
        if not nhref or "matchHub" not in nhref:
            break
        url = nhref if nhref.startswith("http") else SITE + nhref
        time.sleep(0.1)
    # Return None ONLY when the view couldn't be read at all (so the caller keeps the
    # /fg/ list as protection). An empty list is a valid answer — a division whose
    # league season is finished has no upcoming fixtures, and must NOT fall back to the
    # /fg/ page (which for a finished division lists stale/knockout rows).
    return out if got_page else None


def scrape_division(fgkey, crests, code=None):
    soup = BeautifulSoup(get(f"{SITE}/fg/{fgkey}.html"), "html.parser")
    table, results, fixtures, allres = [], [], [], []
    live_codes = set()                           # full team codes seen on THIS division's page
    for t in soup.find_all("table"):
        first = t.find("tr")
        head = (first.get_text(" ", strip=True) if first else "").upper()
        if "VENUE" in head:                      # upcoming fixtures (has a header row)
            for r in t.find_all("tr")[1:]:
                td = r.find_all("td")
                if len(td) < 5:
                    continue
                hraw, araw = td[2].get_text(" ", strip=True), td[4].get_text(" ", strip=True)
                hn, an = clean(hraw), clean(araw)
                dt = td[1].get_text(" ", strip=True)
                if hn and an:
                    hc, ac = fullcode(hraw), fullcode(araw)
                    live_codes.update({hc, ac})
                    fixtures.append([hn, an, fdate(dt), ftime(dt),
                                     td[5].get_text(" ", strip=True) if len(td) > 5 else "", hc, ac])
        elif "SCORE" in head:                    # played results (has a header row)
            for r in t.find_all("tr")[1:]:
                td = r.find_all("td")
                if len(td) < 5:
                    continue
                m = re.search(r"(\d+)\s*-\s*(\d+)", td[3].get_text())
                hraw, araw = td[2].get_text(" ", strip=True), td[4].get_text(" ", strip=True)
                hn, an = clean(hraw), clean(araw)
                if hn and an and m:
                    live_codes.update({fullcode(hraw), fullcode(araw)})
                    allres.append([hn, an, m.group(1), m.group(2), td[1].get_text(" ", strip=True)])
        else:                                     # standings: LR renders NO header row
            for r in t.find_all("tr"):
                td = r.find_all("td")
                if len(td) < 9:
                    continue
                if not td[0].get_text(strip=True).isdigit():   # first cell = league position
                    continue
                raw = td[1].get_text(" ", strip=True)
                nm = clean(raw)
                if not nm:
                    continue
                live_codes.add(fullcode(raw))
                n = lambda i: int(re.sub(r"\D", "", td[i].get_text() or "0") or 0)
                table.append([nm, n(2), n(3), n(4), n(5), n(6), n(7), n(len(td) - 1), ""])
                c = crest_id(td[1])
                if c:
                    crests[nm] = c
    # per-team last-5 form from the full results history
    compute_form(table, allres)
    # display: the 8 most recent results (newest first), carrying the match date
    # so the site can date-stamp and globally order the live news feed
    for hn, an, hs, as_, _dt in sorted(allres, key=lambda x: sortkey(x[4]), reverse=True)[:8]:
        results.append([hn, an, hs, as_, fdate(_dt)])
    # Replace the windowed /fg/ fixtures with the FULL remaining programme from the
    # 'View All Matches' view, then attribute each match to THIS division by full team
    # code. Every full code (e.g. 'O3-02') belongs to exactly one division, so a
    # shared/contaminated hub is filtered down to only this division's own matches:
    # O3-02 (Premier Three B) never leaks into O3 (Premier Three) or O3G (Premier 3
    # A&B). Membership = this division's season-stable roster (from the committed LR
    # export) plus any codes seen live on its own /fg page. An empty result is
    # authoritative (a finished division has no upcoming fixtures) — we do NOT fall
    # back to the /fg list, which for a finished division carries stale/other rows.
    def _nrm(s):
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())
    mine = {fc for fc, dc in roster_map().items() if code and dc == code}
    mine |= {c for c in live_codes if c}
    name_roster = {_nrm(t[0]) for t in table}
    def _belongs(f):
        hc, ac = (f[5] if len(f) > 5 else ""), (f[6] if len(f) > 6 else "")
        if mine:                                  # attribute by full team code (reliable)
            return bool(hc) and bool(ac) and hc in mine and ac in mine
        # no codes available at all (no export, empty page) -> both-teams-in-standings
        return (not name_roster) or (_nrm(f[0]) in name_roster and _nrm(f[1]) in name_roster)
    full = scrape_all_fixtures(soup)
    if full is not None:
        keep = [f for f in full if _belongs(f)]
        if full and not keep and not mine:    # only fall back when we truly can't attribute
            fixtures = [f for f in fixtures if _belongs(f)]
        else:
            fixtures = keep
    else:
        fixtures = [f for f in fixtures if _belongs(f)]
    # Drop "Bye" placeholders and strip the trailing full-code helpers so each
    # published fixture is [home, away, date, time, venue].
    fixtures = [f[:5] for f in fixtures
                if _nrm(f[0]) != "bye" and _nrm(f[1]) != "bye"]
    return {"table": table, "results": results, "fixtures": fixtures}


# ---------------- KNOCKOUT CUPS ----------------

def discover_cups(seed):
    """Return [(name, fgkey)] for every KNOCKOUT competition (2_) in the season."""
    soup = BeautifulSoup(get(f"{SITE}/fg/{seed}.html"), "html.parser")
    sel = soup.find("select", attrs={"name": "fixtureGroupPageContent.filterFixtureGroupKey"})
    out = []
    for o in sel.find_all("option"):
        val = o.get("value", "")
        if val.startswith("2_"):
            out.append((o.get_text(" ", strip=True), val))
    return out


def cup_clean_name(raw):
    n = re.sub(r"\bCTTLFA\b", "", raw)
    n = re.sub(r"\b20\d\d\b", "", n)
    n = re.sub(r"Knock\s*Out|Knockout", "Cup", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def cup_group(raw):
    if re.search(r"U/?18", raw): return "Under-18"
    if re.search(r"U/?16", raw): return "Under-16"
    if re.search(r"U/?14", raw): return "Under-14"
    if re.search(r"U/?12", raw): return "Under-12"
    if re.search(r"Wom[ae]n", raw, re.I): return "Women"
    if re.search(r"O/?\d0", raw): return "Veterans"
    return "Senior"


def round_rank(r):
    s = (r or "").lower()
    if "prelim" in s: return 0
    m = re.search(r"round\s+(\d+)", s)
    if m: return int(m.group(1))
    if "last 64" in s: return 79
    if "last 32" in s: return 80
    if "last 16" in s: return 81
    if "quarter" in s: return 90
    if "semi" in s: return 91
    if "third" in s or "3rd" in s: return 93
    if "final" in s: return 92
    return 60


CODE = re.compile(r"^([A-Za-z0-9]{1,6}-\s*\d+)-\s*(.*)$")


def build_codemap(soup):
    """team code (e.g. 'PD-05') -> full club name, read from the fixture-group page
    where names are not truncated. Lets us resolve the chart's shortened names."""
    m = {}
    for td in soup.find_all("td"):
        t = re.sub(r"\s+", " ", td.get_text(" ", strip=True)).strip()
        cm = CODE.match(t)
        if cm:
            code = re.sub(r"\s+", "", cm.group(1))
            name = re.sub(r"\s*\d+(\s*-\s*\d+)?\s*$", "", cm.group(2)).strip()
            if name and not name.isdigit():
                m.setdefault(code, name)
    return m


def parse_cup_team(text, codemap):
    """A chart team cell -> {'n','s'} | {'bye':1} | {'tbd':1}."""
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if not t:
        return {"tbd": 1}
    cm = CODE.match(t)
    if cm:
        code = re.sub(r"\s+", "", cm.group(1))
        rest = cm.group(2).strip()
        sm = re.search(r"(\d+)\s*$", rest)
        score = sm.group(1) if sm else ""
        name = codemap.get(code) or re.sub(r"\s*\d+\s*$", "", rest)
        if name.lower() == "bye":
            return {"bye": 1}
        return {"n": name, "s": score}
    if t.lower() == "bye" or t.lower().startswith("bye "):
        return {"bye": 1}
    if " or " in t.lower() or "winner" in t.lower():
        return {"tbd": 1}
    sm = re.search(r"(\d+)\s*$", t)
    if sm:
        return {"n": re.sub(r"\s*\d+\s*$", "", t), "s": sm.group(1)}
    return {"n": t}


def scrape_cup(fgkey, crests):
    """Return the cup's bracket as {rounds:[names], cols:[[box,...],...]} using
    LeagueRepublic's own tournament chart (the authoritative tree — byes, the
    final, and undecided future ties are all laid out for us)."""
    soup = BeautifulSoup(get(f"{SITE}/fg/{fgkey}.html"), "html.parser")
    codemap = build_codemap(soup)
    # collect crest ids for cup teams (resolved by name on the site)
    for td in soup.find_all("td"):
        c = crest_id(td)
        if c:
            nm = clean(td.get_text(" ", strip=True))
            if nm:
                crests[nm] = c
    link = soup.find("a", href=re.compile(r"/displayCompetition/"))
    if not link:
        return {"rounds": [], "cols": []}
    chart = BeautifulSoup(get(SITE + link.get("href")), "html.parser")
    rounds = []
    for h in chart.find_all("h4", class_="competition-round-title"):
        p = h.find_parent("div", style=re.compile("left"))
        mm = re.search(r"left:\s*(\d+)px", p.get("style", "")) if p else None
        rounds.append((int(mm.group(1)) if mm else 0, h.get_text(strip=True)))
    rounds.sort()
    lefts = [r[0] for r in rounds]
    names = [r[1] for r in rounds]
    cols = [[] for _ in rounds]
    for outer in chart.find_all("div", class_="competition-box-outer"):
        pos = outer.find_parent("div", style=re.compile(r"position:\s*absolute"))
        st = pos.get("style", "") if pos else ""
        lm = re.search(r"left:\s*(\d+)px", st)
        tm = re.search(r"top:\s*(\d+)px", st)
        if not (lm and tm):
            continue
        L, T = int(lm.group(1)), int(tm.group(1))
        ri = min(range(len(lefts)), key=lambda i: abs(lefts[i] - L)) if lefts else 0
        cells = outer.find_all("div", class_="competition-match-team")
        teams = [parse_cup_team(c.get_text(" ", strip=True), codemap) for c in cells]
        while len(teams) < 2:
            teams.append({"tbd": 1})
        dds = outer.find_all("div", class_="competition-match-date")
        dtx = re.sub(r"\s+", " ", dds[0].get_text(" ", strip=True)) if dds else ""
        box = {"a": teams[0], "b": teams[1],
               "d": fdate(dtx), "t": ftime(dtx)}
        # Venue lives in the SECOND date div, which LeagueRepublic renders as
        # "<home team name> <venue>". Strip the leading home-team name so we keep
        # just the ground. A neutral/allocated venue (prefix is NOT the home team,
        # e.g. a semi-final played at Kensington) is left exactly as LR gives it.
        if len(dds) > 1:
            vtx = re.sub(r"\s+", " ", dds[1].get_text(" ", strip=True)).strip()
            if vtx and not re.match(r"^\d{2}/\d{2}/\d{2}", vtx):
                # Strip a leading host-team name (either side of the tie) so only the
                # ground remains; a neutral venue keeps its full text.
                for tm in (teams[0], teams[1]):
                    nm = (tm.get("n") or "").strip()
                    if nm and vtx.lower().startswith(nm.lower() + " "):
                        vtx = vtx[len(nm):].strip()
                        break
                # Backstop: collapse an exact leading duplication such as
                # "Table View Table View A" -> "Table View A".
                w = vtx.split()
                for k in range(len(w) // 2, 0, -1):
                    if w[:k] == w[k:2 * k]:
                        vtx = " ".join(w[k:])
                        break
                if vtx and vtx.lower() != "bye":
                    box["v"] = vtx
        pm = re.search(r"Pens?\s*(\d+\s*-\s*\d+)", dtx, re.I)
        if pm:
            box["p"] = re.sub(r"\s+", "", pm.group(1))
        cols[ri].append((T, box))
    for c in cols:
        c.sort(key=lambda x: x[0])
    return {"rounds": names, "cols": [[b for _, b in c] for c in cols]}


def build_cups(seed, crests):
    cups = []
    for raw, fgkey in discover_cups(seed):
        try:
            bracket = scrape_cup(fgkey, crests)
            cups.append({"key": fgkey, "name": cup_clean_name(raw),
                         "group": cup_group(raw), "bracket": bracket})
            n = sum(len(c) for c in bracket["cols"])
            print(f"  ○ {cup_clean_name(raw):34} {n} ties, {len(bracket['rounds'])} rounds")
        except Exception as e:
            print(f"  ✗ cup {raw[:34]} {e}")
        time.sleep(0.12)
    return cups


# ---------------------------------------------------------------------------
# DIVISION-ACCURATE FIXTURES (live, self-correcting — no manual export needed)
# ---------------------------------------------------------------------------
# LeagueRepublic's "View All Matches" hub is, for some divisions (the U12–U18
# "Premier Three B" age groups), a SHARED match-centre that ignores the fixtureGroup
# and returns other divisions' games — the cause of the duplicated / cross-division
# fixtures clubs complained about. The reliable division key is the FULL team code LR
# prints on every match ("O3-02- Bellville City"): each full code (prefix+number)
# belongs to exactly ONE division, so O3-02 (Premier Three B) is cleanly separated
# from O3-01 (Premier Three) and from O3G-01 (Premier 3 A&B) — which the team-code
# prefix or the club name alone cannot do.
#
# Fixtures therefore stay LIVE from the hub every run, but each match is attributed to
# its division by full team code. The code->division roster is stable for the whole
# season (teams do not change division mid-season), so it is read once from the
# committed LeagueRepublic export (ROSTER_CSV) and augmented with codes learnt live
# from each division's own /fg page. Result: fixtures stay current (reschedules, new
# and played matches all reflected automatically every 10 min) with no cross-division
# bleed and no duplication. The export never needs re-generating during the season.
ROSTER_CSV = "fixtures_export.csv"

_DIVCODE  = re.compile(r"^([A-Za-z0-9]{1,4})\s*-")            # "O3B - Under 12 ..." -> O3B
_FULLCODE = re.compile(r"^([A-Za-z0-9]{1,4}-\s*\d+)\s*-")     # "O3-02- Bellville"   -> O3-02


def fullcode(s):
    """The full LeagueRepublic team code (prefix+number, e.g. 'O3-02') that uniquely
    identifies which division a team plays in. '' if the cell carries no code."""
    m = _FULLCODE.match((s or "").strip())
    return re.sub(r"\s+", "", m.group(1)).upper() if m else ""


_ROSTER = None
def roster_map():
    """{full team code -> division code} from the committed LR export. Stable for the
    whole season, so it is loaded once. Empty {} if the export is unreadable (the
    scraper then relies solely on codes learnt live from each division's /fg page)."""
    global _ROSTER
    if _ROSTER is not None:
        return _ROSTER
    _ROSTER = {}
    here = os.path.dirname(os.path.abspath(__file__))
    path = next((p for p in (os.path.join(here, ROSTER_CSV), ROSTER_CSV) if os.path.exists(p)), None)
    if not path:
        print("[lr_sync] no roster export found; attributing fixtures from live codes only")
        return _ROSTER
    try:
        import csv
        for r in csv.DictReader(open(path, encoding="utf-8-sig")):
            m = _DIVCODE.match((r.get("Division") or "").strip())
            dc = m.group(1) if m else ""
            if not dc:
                continue
            for cell in (r.get("Home Team"), r.get("Away Team")):
                fc = fullcode(cell)
                if fc and fc.lower() != "bye":
                    _ROSTER.setdefault(fc, dc)
        print(f"[lr_sync] roster map: {len(_ROSTER)} team codes across "
              f"{len(set(_ROSTER.values()))} divisions")
    except Exception as e:
        print(f"[lr_sync] roster export unreadable ({e}); attributing from live codes only")
    return _ROSTER


def build(season):
    cfg = SEASONS[season]
    print(f"[lr_sync] {cfg['label']}  (seed {cfg['seed']})")
    divs = discover(cfg["seed"])
    print(f"[lr_sync] discovered {len(divs)} competitions")
    roster_map()                       # load the season-stable code->division roster once
    crests, leagues = {}, {}
    for code, name, fgkey in divs:
        try:
            d = scrape_division(fgkey, crests, code)
            d["name"], d["group"] = name, group_of(code)
            leagues[code] = d
            print(f"  ✓ {code:4} {name:26} {len(d['table'])} teams, {len(d['fixtures'])} fx")
        except Exception as e:
            print(f"  ✗ {code:4} {name:26} {e}")
        time.sleep(0.15)   # be gentle
    total_fx = sum(len(l["fixtures"]) for l in leagues.values())
    print(f"[lr_sync] live fixtures attributed by full team code: {total_fx} across "
          f"{sum(1 for l in leagues.values() if l['fixtures'])} divisions")
    print("[lr_sync] scraping knockout cups")
    cups = build_cups(cfg["seed"], crests)
    print(f"[lr_sync] {len(cups)} cups")
    return {"season": season, "label": cfg["label"],
            "updated": datetime.datetime.utcnow().isoformat() + "Z",
            "crestBase": CREST_BASE, "leagues": leagues, "cups": cups, "crests": crests}


def mirror_crests(crests, crestdir):
    """Download each club badge into <crestdir>/<id>/115.jpg so the public site
    serves crests from our own domain (no external image host). Returns the map
    pruned to badges that actually exist. Clubs without a badge fall back to
    their initials on the site, exactly as before."""
    os.makedirs(crestdir, exist_ok=True)
    kept = {}
    got = 0
    for nm, cid in crests.items():
        dst = os.path.join(crestdir, str(cid))
        fp = os.path.join(dst, "115.jpg")
        if os.path.exists(fp) and os.path.getsize(fp) > 0:
            kept[nm] = cid
            continue
        try:
            r = requests.get(f"{CREST_BASE}/{cid}/115.jpg", headers=UA, timeout=25)
            if r.status_code == 200 and r.content:
                os.makedirs(dst, exist_ok=True)
                open(fp, "wb").write(r.content)
                kept[nm] = cid
                got += 1
        except Exception:
            pass
        time.sleep(0.1)
    print(f"[lr_sync] mirrored crests: {got} new, {len(kept)} total local")
    return kept


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026", choices=list(SEASONS))
    ap.add_argument("--out", default="season.json")
    ap.add_argument("--crestdir", default="photos/crests",
                    help="local folder to mirror club badges into (served by our site)")
    a = ap.parse_args()
    data = build(a.season)
    # serve badges from our own site rather than the external image host
    data["crests"] = mirror_crests(data["crests"], a.crestdir)
    data["crestBase"] = "photos/crests"
    # Only the "updated" timestamp changes every run. If the actual data is
    # unchanged, keep the previous timestamp so the file is byte-identical and
    # git/CI see no change (no needless commit, no needless site rebuild).
    if os.path.exists(a.out):
        try:
            old = json.load(open(a.out, encoding="utf-8"))
            a_cmp = {k: v for k, v in data.items() if k != "updated"}
            b_cmp = {k: v for k, v in old.items() if k != "updated"}
            if a_cmp == b_cmp:
                data["updated"] = old.get("updated", data["updated"])
                print("[lr_sync] no data change since last run")
        except Exception:
            pass
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[lr_sync] wrote {a.out}  ({len(data['leagues'])} competitions, {len(data['cups'])} cups, {len(data['crests'])} crests)")
