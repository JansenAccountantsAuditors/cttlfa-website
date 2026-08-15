# -*- coding: utf-8 -*-
"""
Pulls referee appointments directly from the CTTLFA dashboard's Supabase backend
(the same public data the dashboard shows every visitor) and writes
appointments.json in the shape weekly_bulletin.py — and the website — consume.
This replaces the headless-browser scrape with a light, durable API pull: no
browser, no login, just a read of the public endpoint the dashboard itself uses.

Environment (both values are public — the key is the anon/public key, not a secret):
  SUPABASE_URL       default https://thwfepmpcmxakajryutt.supabase.co
  SUPABASE_ANON_KEY  the project's public anon key
Optional:
  WEEKEND_DATES      "YYYY-MM-DD,YYYY-MM-DD,YYYY-MM-DD" to limit to one weekend;
                     omit to pull everything the endpoint returns.
"""
import json, os, sys, urllib.request

BASE = os.environ.get("SUPABASE_URL", "https://thwfepmpcmxakajryutt.supabase.co").rstrip("/") + "/rest/v1"
KEY  = os.environ.get("SUPABASE_ANON_KEY", "").strip()

def get(path):
    req = urllib.request.Request(BASE + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())

def category(division, league):
    d = (division or "").lower(); l = (league or "").lower()
    if "under" in d or "junior" in l:                                   return "junior"
    if d[:1] == "h" or "wom" in d or "girl" in d or "wom" in l or "lad" in l or "girl" in l: return "ladies"
    return "senior"

def main():
    if not KEY:
        print("SUPABASE_ANON_KEY not set", file=sys.stderr); sys.exit(1)
    refs = {r["id"]: (r.get("name") or "").strip() for r in get("/referees?select=id,name&limit=5000")}
    sets = {s["id"]: s for s in get("/fixture_sets?select=id,week_number,date_from,date_to,league,status&limit=3000")}

    q = ("/fixtures?select=division,match_date,kick_off_time,home_team,away_team,venue,"
         "referee_id,assistant_referee_1_id,assistant_referee_2_id,fixture_set_id&limit=8000")
    wk = [d.strip() for d in os.environ.get("WEEKEND_DATES", "").split(",") if d.strip()]
    if wk:
        q += "&match_date=in.(%s)" % ",".join(wk)
    fixtures = get(q)

    out = {"source": "supabase:" + BASE,
           "cols": ["division", "date", "time", "home", "away", "referee", "asst1", "asst2"],
           "senior": [], "junior": [], "ladies": []}
    def nm(rid): return refs.get(rid, "") or ""
    dates = set()
    for f in fixtures:
        fs = sets.get(f.get("fixture_set_id")) or {}
        cat = category(f.get("division"), fs.get("league"))
        d = f.get("match_date") or ""
        if d: dates.add(d)
        row = [f.get("division") or "", d, (f.get("kick_off_time") or "")[:5],
               f.get("home_team") or "", f.get("away_team") or "",
               nm(f.get("referee_id")), nm(f.get("assistant_referee_1_id")), nm(f.get("assistant_referee_2_id"))]
        out[cat].append(row)

    if dates:
        out["week_label"] = "%s to %s" % (min(dates), max(dates))
    total = sum(len(out[k]) for k in ("senior", "junior", "ladies"))
    if total == 0:
        print("No appointments returned (check WEEKEND_DATES / published status).", file=sys.stderr)
        sys.exit(1)
    with open("appointments.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("Wrote appointments.json: %d rows (senior %d / junior %d / ladies %d)"
          % (total, len(out["senior"]), len(out["junior"]), len(out["ladies"])), file=sys.stderr)

if __name__ == "__main__":
    main()
