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


def get(url):
    r = requests.get(url, headers=UA, timeout=30)
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


def scrape_division(fgkey, crests):
    soup = BeautifulSoup(get(f"{SITE}/fg/{fgkey}.html"), "html.parser")
    table, results, fixtures, allres = [], [], [], []
    for t in soup.find_all("table"):
        first = t.find("tr")
        head = (first.get_text(" ", strip=True) if first else "").upper()
        if "VENUE" in head:                      # upcoming fixtures (has a header row)
            for r in t.find_all("tr")[1:]:
                td = r.find_all("td")
                if len(td) < 5:
                    continue
                hn, an = clean(td[2].get_text(" ", strip=True)), clean(td[4].get_text(" ", strip=True))
                dt = td[1].get_text(" ", strip=True)
                if hn and an:
                    fixtures.append([hn, an, fdate(dt), ftime(dt), td[5].get_text(" ", strip=True) if len(td) > 5 else ""])
        elif "SCORE" in head:                    # played results (has a header row)
            for r in t.find_all("tr")[1:]:
                td = r.find_all("td")
                if len(td) < 5:
                    continue
                m = re.search(r"(\d+)\s*-\s*(\d+)", td[3].get_text())
                hn, an = clean(td[2].get_text(" ", strip=True)), clean(td[4].get_text(" ", strip=True))
                if hn and an and m:
                    allres.append([hn, an, m.group(1), m.group(2), td[1].get_text(" ", strip=True)])
        else:                                     # standings: LR renders NO header row
            for r in t.find_all("tr"):
                td = r.find_all("td")
                if len(td) < 9:
                    continue
                if not td[0].get_text(strip=True).isdigit():   # first cell = league position
                    continue
                nm = clean(td[1].get_text(" ", strip=True))
                if not nm:
                    continue
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


def round_of(tr):
    """The tie's round, read from the row tooltip title (e.g. '... - Quarter-Final')."""
    for td in tr.find_all("td"):
        t = td.get("title") or ""
        t = re.sub(r"<[^>]+>", " ", t)
        m = re.search(r"-\s*([A-Za-z0-9 /\-]+?)\s*$", t.strip())
        if m and any(k in m.group(1) for k in ("Round", "Final", "Prelim", "Last")):
            return m.group(1).strip()
    return ""


def scrape_cup(fgkey, crests):
    soup = BeautifulSoup(get(f"{SITE}/fg/{fgkey}.html"), "html.parser")
    rounds = {}
    for t in soup.find_all("table"):
        first = t.find("tr")
        head = (first.get_text(" ", strip=True) if first else "").upper()
        is_res, is_fix = "SCORE" in head, "VENUE" in head
        if not (is_res or is_fix):
            continue
        for tr in t.find_all("tr")[1:]:
            td = tr.find_all("td")
            if len(td) < 5:
                continue
            rnd = round_of(tr) or "Fixtures"
            hn, an = clean(td[2].get_text(" ", strip=True)), clean(td[4].get_text(" ", strip=True))
            if not (hn and an):
                continue
            for c in (crest_id(td[2]), crest_id(td[4])):
                nmc = clean(td[2].get_text(" ", strip=True)) if c == crest_id(td[2]) else clean(td[4].get_text(" ", strip=True))
                if c:
                    crests[nmc] = c
            if is_res:
                m = re.search(r"(\d+)\s*-\s*(\d+)", td[3].get_text())
                if not m:
                    continue
                rounds.setdefault(rnd, []).append(
                    [hn, an, m.group(1), m.group(2), fdate(td[1].get_text()), ""])
            else:
                rounds.setdefault(rnd, []).append(
                    [hn, an, "", "", fdate(td[1].get_text()),
                     td[5].get_text(" ", strip=True) if len(td) > 5 else ""])
    ordered = [{"name": rn, "ties": rounds[rn]}
               for rn in sorted(rounds, key=round_rank)]
    return ordered


def build_cups(seed, crests):
    cups = []
    for raw, fgkey in discover_cups(seed):
        try:
            rounds = scrape_cup(fgkey, crests)
            cups.append({"key": fgkey, "name": cup_clean_name(raw),
                         "group": cup_group(raw), "rounds": rounds})
            print(f"  ○ {cup_clean_name(raw):34} {sum(len(r['ties']) for r in rounds)} ties, {len(rounds)} rounds")
        except Exception as e:
            print(f"  ✗ cup {raw[:34]} {e}")
        time.sleep(0.12)
    return cups


def build(season):
    cfg = SEASONS[season]
    print(f"[lr_sync] {cfg['label']}  (seed {cfg['seed']})")
    divs = discover(cfg["seed"])
    print(f"[lr_sync] discovered {len(divs)} competitions")
    crests, leagues = {}, {}
    for code, name, fgkey in divs:
        try:
            d = scrape_division(fgkey, crests)
            d["name"], d["group"] = name, group_of(code)
            leagues[code] = d
            print(f"  ✓ {code:4} {name:26} {len(d['table'])} teams")
        except Exception as e:
            print(f"  ✗ {code:4} {name:26} {e}")
        time.sleep(0.15)   # be gentle
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
