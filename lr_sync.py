#!/usr/bin/env python3
"""
CTTLFA - LeagueRepublic -> season.json builder (API edition)
============================================================
Builds season.json DIRECTLY from the LeagueRepublic JSON Data API (Gold feature,
leagueID 895893986). No scraping, no HTML parsing, no Playwright, stdlib only.

    python3 lr_sync.py                    # -> season.json        (2026, current)
    python3 lr_sync.py --season 2025 --out season-2025.json

Output shape is byte-compatible with the old scraper's season.json so the weekly
bulletin and season precheck keep working unchanged:
  {season,label,updated,crestBase,leagues:{CODE:{name,group,table,results,fixtures}},cups,crests}

The public website reads the API live in the browser and no longer needs this file;
season.json now exists only to feed weekly_bulletin.py and season_precheck.py.
"""
import argparse, json, re, sys, datetime, urllib.request, time

API = "https://api.leaguerepublic.com/json"
LEAGUE_ID = "895893986"
CREST_BASE = "https://images.leaguerepublic.com/data/images"   # /<id>/115.jpg
MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
CODE_RE = re.compile(r"^[A-Za-z0-9]+-\d+[A-Za-z]?-\s*")
MAX_RESULTS_PER_DIV = 20   # keeps season.json lean; the bulletin only needs recent results

SEASON_IDS = {"2026": 47708359, "2025": 763744782}
LABELS     = {"2026": "CTTLFA 2026", "2025": "CTTLFA 2025"}
SEASON_NO  = {"2026": 2026, "2025": 2025}
DIVMAP     = {"A1": {"name": "Premier Division", "group": "Senior Divisions"}, "A2": {"name": "Premier Reserve", "group": "Reserves"}, "B1": {"name": "First Division", "group": "Senior Divisions"}, "B2": {"name": "First Reserve", "group": "Reserves"}, "C1": {"name": "Second Division", "group": "Senior Divisions"}, "C2": {"name": "Second Reserve", "group": "Reserves"}, "D1": {"name": "3rd Division", "group": "Senior Divisions"}, "D2": {"name": "4th Division", "group": "Senior Divisions"}, "D3": {"name": "5th Division", "group": "Senior Divisions"}, "D4": {"name": "6th Division", "group": "Senior Divisions"}, "E1": {"name": "Vets 035", "group": "Veterans"}, "E2": {"name": "Vets 035 B", "group": "Veterans"}, "F1": {"name": "Vets 040 A", "group": "Veterans"}, "F2": {"name": "Vets 040 B", "group": "Veterans"}, "G1": {"name": "Vets 045 A", "group": "Veterans"}, "G4": {"name": "Vets 050 A", "group": "Veterans"}, "G5": {"name": "Vets 050 B", "group": "Veterans"}, "G6": {"name": "Vets O50 C", "group": "Veterans"}, "H1": {"name": "Womens Premier League", "group": "Women"}, "H2": {"name": "Womens First Division", "group": "Women"}, "I1": {"name": "Under 18 Premier One", "group": "Under-18"}, "I2": {"name": "Under 18 Premier Two", "group": "Under-18"}, "I3": {"name": "Under 18 Premier Three", "group": "Under-18"}, "I3B": {"name": "Under 18 Premier Three B", "group": "Under-18"}, "I4": {"name": "Under 18 Division Four", "group": "Under-18"}, "I5": {"name": "Under 18 Division Five", "group": "Under-18"}, "K1": {"name": "Under 16 Premier One", "group": "Under-16"}, "K2": {"name": "Under 16 Premier Two", "group": "Under-16"}, "K3": {"name": "Under 16 Premier Three", "group": "Under-16"}, "K3B": {"name": "Under 16 Premier Three B", "group": "Under-16"}, "K4": {"name": "Under 16 Division Four", "group": "Under-16"}, "K5": {"name": "Under 16 Division Five", "group": "Under-16"}, "K6": {"name": "Under 16 Division Six", "group": "Under-16"}, "K7": {"name": "Under 16 Girls Premier One", "group": "Under-16"}, "K8": {"name": "Under 16 Division Seven", "group": "Under-16"}, "M1": {"name": "Under 14 Premier One", "group": "Under-14"}, "M2": {"name": "Under 14 Premier Two", "group": "Under-14"}, "M3": {"name": "Under 14 Premier Three", "group": "Under-14"}, "M3B": {"name": "Under 14 Premier Three B", "group": "Under-14"}, "M4": {"name": "Under 14 Division Four", "group": "Under-14"}, "M5": {"name": "Under 14 Division Five", "group": "Under-14"}, "M6": {"name": "Under 14 Division Six", "group": "Under-14"}, "M7": {"name": "Under 14 Division Seven", "group": "Under-14"}, "M8": {"name": "Under 14 Girls Premier One", "group": "Under-14"}, "M9": {"name": "Under 14 Division Eight", "group": "Under-14"}, "O1": {"name": "Under 12 Premier One", "group": "Under-12"}, "O2": {"name": "Under 12 Premier Two", "group": "Under-12"}, "O3": {"name": "Under 12 Premier Three", "group": "Under-12"}, "O3B": {"name": "Under 12 Premier Three B", "group": "Under-12"}, "O4": {"name": "Under 12 Division Four", "group": "Under-12"}, "O5": {"name": "Under 12 Division Five", "group": "Under-12"}, "O6": {"name": "Under 12 Division Six", "group": "Under-12"}, "O7": {"name": "Under 12 Girls Premier One (9v9)", "group": "Under-12"}, "O8": {"name": "Under 12 Division Seven", "group": "Under-12"}, "I3G": {"name": "Under 18 Premier 3 A&B", "group": "Under-18"}, "O3G": {"name": "Under 12 Premier 3 A&B", "group": "Under-12"}, "M3G": {"name": "Under 14 Premier 3 A&B", "group": "Under-14"}, "K3G": {"name": "Under 16 Premier 3 A&B", "group": "Under-16"}}
CRESTS     = {"Durbanville": "603169281", "Table View": "926521367", "Hanover Park": "966477820", "Rygersdal": "342234291", "C.R. Vasco Da Gama": "759498919", "Fish Hoek": "724061652", "Holy Cross": "894903931", "Saxon Rovers": "387054430", "UCT": "152827271", "Bothasig": "416141189", "Sunningdale City": "938776554", "Bellville City FC": "522626759", "JMI": "738238671", "Kensington": "721154884", "Stephanian Ottery": "767162649", "Tramway": "718389157", "Northpine United": "674014319", "Ruyterwacht": "462020176", "Brooklyn Superstars": "281655054", "Queens Park": "247119670", "Avendale Athletico": "571817130", "Young Bafana": "801154554", "Chelsea Bridgetown": "58556195", "West End United": "790271081", "Camps Bay": "924011377", "Mutual FC": "462207720", "YSD Macassar": "149983422", "FC Kapstadt": "227801021", "Shosholoza FC": "64445222", "Bellville City": "905078339", "Lansdowne": "321044869", "Everton United": "215524454", "Turfhall": "442872570", "Sunningdale City B": "954589510", "Jamestown United": "901761593", "West End United A": "817291201", "Hanover Park B": "144922522", "West End United B": "225405348", "West End United C": "484529293", "Hanover Park C": "799019491", "Tramway B": "429631959", "Stephanian Ottery B": "284704636", "Magic Ladies": "24348048", "Magic Ladies B": "855305244", "UCT B": "672355881", "CR Vasco Da Gama": "365992196", "Shosholoza": "748120971", "Grass Boots": "909725523", "CR Vasco Da Gama B": "335799158", "Northpine United B": "230255460", "Norway Parks B": "884240218", "Saxon Rovers B": "413585152", "Bothasig B": "873184117", "Rygersdal B.": "884144531", "Fish Hoek B.": "388184835", "Ruyterwacht B": "286626581", "Bellville City B": "144214403", "Bothasig C": "127932065", "Rygersdal B": "535503655", "Bellville City B.": "242635109", "Shosholoza B": "312508450", "Kensington B": "393120770", "Sunningdale City C": "298169474", "Nova Generation": "582068396", "Northpine United C": "593964196", "Rygersdal C": "513638581", "Fish Hoek C.": "810021150", "Bothasig D": "262950410", "Saxon Rovers B.": "283676164", "FC Kapstadt B": "594876184", "Sunningdale City C.": "524104961", "Northpine United D": "942316362", "Bellville City C": "635884056", "Grass Boots B": "628006242", "Stephanian Ottery C": "581885516", "Fish Hoek C": "613648472", "Meadowridge B": "349681226", "Fish Hoek.": "431612356", "Mutual B": "861951024", "Norway Parks C": "36837663"}
CUPMETA    = [{"key": "2_870266437", "name": "Premier League Cup", "group": "Senior"}, {"key": "2_635842836", "name": "Premier Reserves Cup", "group": "Senior"}, {"key": "2_440158046", "name": "First Division Cup", "group": "Senior"}, {"key": "2_663677289", "name": "First Reserves Cup", "group": "Senior"}, {"key": "2_545176691", "name": "Second Division Cup", "group": "Senior"}, {"key": "2_564311915", "name": "Second Reserve Cup", "group": "Senior"}, {"key": "2_175543749", "name": "3rd Division Cup", "group": "Senior"}, {"key": "2_826947009", "name": "4th Division Cup", "group": "Senior"}, {"key": "2_592804479", "name": "5th Division Cup", "group": "Senior"}, {"key": "2_549170807", "name": "6th Division Cup", "group": "Senior"}, {"key": "2_339589907", "name": "Womans Premier League Cup", "group": "Women"}, {"key": "2_148522950", "name": "Womans First Division Cup", "group": "Women"}, {"key": "2_389709242", "name": "O/35 A Division Cup", "group": "Senior"}, {"key": "2_445396709", "name": "O/35 B Division Cup", "group": "Senior"}, {"key": "2_367814409", "name": "O/40 A Division Cup", "group": "Veterans"}, {"key": "2_398052558", "name": "O/40 B Division Cup", "group": "Veterans"}, {"key": "2_483328144", "name": "O/45 A Division Cup", "group": "Senior"}, {"key": "2_29602231", "name": "O/50 A Division Cup", "group": "Veterans"}, {"key": "2_341021773", "name": "O/50 B Division Cup", "group": "Veterans"}, {"key": "2_163344839", "name": "O/50 C Division Cup", "group": "Veterans"}, {"key": "2_344235459", "name": "U/18 Premier One Cup", "group": "Under-18"}, {"key": "2_807292977", "name": "U/18 Premier Two Cup", "group": "Under-18"}, {"key": "2_899443994", "name": "U/18 Premier Three Cup", "group": "Under-18"}, {"key": "2_36090187", "name": "U/18 Premier Three B Cup", "group": "Under-18"}, {"key": "2_138945952", "name": "U/18 Division Four Cup", "group": "Under-18"}, {"key": "2_467424669", "name": "U/18 Division Five Cup", "group": "Under-18"}, {"key": "2_637880725", "name": "U/16 Premier One Cup", "group": "Under-16"}, {"key": "2_558835710", "name": "U/16 Premier Two Cup", "group": "Under-16"}, {"key": "2_606011803", "name": "U/16 Premier Three Cup", "group": "Under-16"}, {"key": "2_845275354", "name": "U/16 Premier Three B Cup", "group": "Under-16"}, {"key": "2_698339450", "name": "U/16 Division Four Cup", "group": "Under-16"}, {"key": "2_816835386", "name": "U/16 Division Five Cup", "group": "Under-16"}, {"key": "2_886186997", "name": "U/16 Division Six Cup", "group": "Under-16"}, {"key": "2_72978235", "name": "U/16 Girls Premier Cup", "group": "Under-16"}, {"key": "2_523149227", "name": "U/16 Division Seven Cup", "group": "Under-16"}, {"key": "2_887884945", "name": "U/14 Premier One Cup", "group": "Under-14"}, {"key": "2_359663090", "name": "U/14 Premier Two Cup", "group": "Under-14"}, {"key": "2_625505235", "name": "U/14 Premier Three Cup", "group": "Under-14"}, {"key": "2_169776866", "name": "U/14 Premier Three B Cup", "group": "Under-14"}, {"key": "2_98508192", "name": "U/14 Division Four Cup", "group": "Under-14"}, {"key": "2_658734577", "name": "U/14 Division Five Cup", "group": "Under-14"}, {"key": "2_215646910", "name": "U/14 Division Six Cup", "group": "Under-14"}, {"key": "2_644243770", "name": "U/14 Division Seven Cup", "group": "Under-14"}, {"key": "2_801704572", "name": "U/14 Girls Premier Cup", "group": "Under-14"}, {"key": "2_51825301", "name": "U/14 Division Eight Cup", "group": "Under-14"}, {"key": "2_922320980", "name": "U/12 Premier One Cup", "group": "Under-12"}, {"key": "2_247013237", "name": "U/12 Premier Two Cup", "group": "Under-12"}, {"key": "2_432841572", "name": "U/12 Premier Three Cup", "group": "Under-12"}, {"key": "2_163942268", "name": "U/12 Premier Three B Cup", "group": "Under-12"}, {"key": "2_13531507", "name": "U/12 Division Four Cup", "group": "Under-12"}, {"key": "2_551102346", "name": "U/12 Division Five Cup", "group": "Under-12"}, {"key": "2_95555487", "name": "U/12 Division Six Cup", "group": "Under-12"}, {"key": "2_42519981", "name": "U/12 Girls Premier Cup", "group": "Under-12"}, {"key": "2_768685067", "name": "U/12 Division Seven Cup", "group": "Under-12"}]


def jget(path, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(API + path + ".json", headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                print("[lr_sync] fetch failed %s: %s" % (path, e), file=sys.stderr)
                return None
            time.sleep(0.4 * (i + 1))
    return None


def clean(n):
    return CODE_RE.sub("", (n or "").strip()).strip()


def fmt(s):
    # "20260917 20:00" -> ("17 Sep", "20:00")
    if not s or len(s) < 8:
        return "", ""
    day = int(s[6:8]); mon = MON[int(s[4:6])] if 0 < int(s[4:6]) < 13 else ""
    t = s[9:14] if len(s) >= 14 else ""
    return "%d %s" % (day, mon), t


def isnum(x):
    try:
        float(x); return True
    except Exception:
        return False


def ni(x):
    try:
        f = float(x); return int(f) if f == int(f) else f
    except Exception:
        return x


def split_desc(desc):
    m = re.match(r"^([A-Za-z]+\d+[A-Za-z]?)\s*-\s*(.+)$", desc or "")
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return (desc or "").strip(), (desc or "").strip()


def prefix_group(k):
    p = (k or "")[:1]
    if p in "ABCD":
        return "Reserves" if k.endswith("2") else "Senior Divisions"
    if p in "EFG":
        return "Veterans"
    return {"H": "Women", "I": "Under-18", "K": "Under-16", "M": "Under-14", "O": "Under-12"}.get(p, "Other")


def build_bracket(fx):
    by_round = {}
    for f in fx:
        by_round.setdefault(f.get("roundDesc") or "Round", []).append(f)
    def rmin(r):
        return min((x.get("fixtureDateInMilliseconds") or 9e15) for x in by_round[r])
    rounds = sorted(by_round, key=rmin)
    cols = []
    for r in rounds:
        col = []
        for f in sorted(by_round[r], key=lambda x: x.get("fixtureDateInMilliseconds") or 0):
            d, t = fmt(f.get("fixtureDate"))
            hs, as_ = f.get("homeScore"), f.get("roadScore")
            sh = str(int(float(hs))) if (f.get("result") and isnum(hs)) else ""
            sa = str(int(float(as_))) if (f.get("result") and isnum(as_)) else ""
            col.append({"a": {"n": clean(f.get("homeTeamName")), "s": sh},
                        "b": {"n": clean(f.get("roadTeamName")), "s": sa},
                        "d": d, "t": t, "v": f.get("venueAndSubVenueDesc") or ""})
        cols.append(col)
    return {"rounds": rounds, "cols": cols}


def build(season):
    sid = SEASON_IDS.get(season)
    if not sid:
        sys.exit("[lr_sync] unknown season %s" % season)
    fixtures = jget("/getFixturesForSeason/%s" % sid)
    groups = jget("/getFixtureGroupsForSeason/%s" % sid)
    if not fixtures or not groups:
        sys.exit("[lr_sync] API returned no data (season %s) - aborting so nothing is overwritten" % season)
    divs = [g for g in groups if g.get("fixtureTypeID") == 1]
    leagues, key_by_fgid = {}, {}
    for g in divs:
        k, nm = split_desc(g.get("fixtureGroupDesc"))
        meta = DIVMAP.get(k) if season == "2026" else None
        name = meta["name"] if meta else nm
        grp = meta["group"] if meta else prefix_group(k)
        leagues[k] = {"name": name, "group": grp, "table": [], "results": [], "fixtures": []}
        key_by_fgid[g["fixtureGroupIdentifier"]] = k
    # split fixtures -> results / upcoming
    for f in fixtures:
        if f.get("fixtureTypeID") != 1:
            continue
        k = key_by_fgid.get(f.get("fixtureGroupIdentifier"))
        if not k:
            continue
        L = leagues[k]; d, t = fmt(f.get("fixtureDate"))
        home, away = clean(f.get("homeTeamName")), clean(f.get("roadTeamName"))
        hs, as_ = f.get("homeScore"), f.get("roadScore"); ms = f.get("fixtureDateInMilliseconds") or 0
        if f.get("result") and isnum(hs) and isnum(as_):
            L["results"].append([home, away, str(int(float(hs))), str(int(float(as_))), d, ms])
        elif not f.get("result"):
            L["fixtures"].append([home, away, d, t, f.get("venueAndSubVenueDesc") or "", ms])
    for k, L in leagues.items():
        L["results"].sort(key=lambda r: r[5], reverse=True)
        L["fixtures"].sort(key=lambda r: r[5])
        L["results"] = [r[:5] for r in L["results"][:MAX_RESULTS_PER_DIV]]
        L["fixtures"] = [r[:5] for r in L["fixtures"]]
    # tables
    for g in divs:
        st = jget("/getStandingsForFixtureGroup/1/%s" % g["fixtureGroupIdentifier"])
        if st and st[0].get("standingsLines"):
            leagues[key_by_fgid[g["fixtureGroupIdentifier"]]]["table"] = [
                [clean(l["teamName"]), ni(l["overallPlayed"]), ni(l["overallWon"]), ni(l["overallTied"]),
                 ni(l["overallLoss"]), ni(l["overallScoreFor"]), ni(l["overallScoreAgainst"]),
                 ni(l["points"]), l.get("recentForm", "")]
                for l in st[0]["standingsLines"]]
    # cups from the same season-fixtures payload
    cup_fx = {}
    for f in fixtures:
        if f.get("fixtureTypeID") == 2:
            cup_fx.setdefault(f.get("fixtureGroupIdentifier"), []).append(f)
    cups = []
    if season == "2026":
        for cm in CUPMETA:
            fgid = int(cm["key"].split("_")[1])
            br = build_bracket(cup_fx.get(fgid, []))
            if br["cols"]:
                cups.append({"key": cm["key"], "name": cm["name"], "group": cm["group"], "bracket": br})
    else:
        for g in groups:
            if g.get("fixtureTypeID") == 2:
                fgid = g["fixtureGroupIdentifier"]; br = build_bracket(cup_fx.get(fgid, []))
                if br["cols"]:
                    cups.append({"key": "2_%s" % fgid, "name": clean(g.get("fixtureGroupDesc")),
                                 "group": "Senior", "bracket": br})
    return {"season": SEASON_NO.get(season, int(season)), "label": LABELS.get(season, "CTTLFA %s" % season),
            "updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z",
            "crestBase": CREST_BASE, "leagues": leagues, "cups": cups, "crests": CRESTS}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026", choices=list(SEASON_IDS))
    ap.add_argument("--out", default="season.json")
    ap.add_argument("--crestdir", default=None, help="ignored (crests served from the LeagueRepublic CDN)")
    a = ap.parse_args()
    data = build(a.season)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    nfx = sum(len(l["fixtures"]) for l in data["leagues"].values())
    nres = sum(len(l["results"]) for l in data["leagues"].values())
    print("[lr_sync] wrote %s  (%d divisions, %d cups, %d fixtures, %d results)"
          % (a.out, len(data["leagues"]), len(data["cups"]), nfx, nres))


if __name__ == "__main__":
    main()
