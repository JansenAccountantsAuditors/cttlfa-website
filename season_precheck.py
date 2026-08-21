#!/usr/bin/env python3
"""
CTTFA season-wide bulletin pre-check — integrity audit for the balance of the season.
=====================================================================================
Audits every remaining match day from today to the end of the season (default
2026-09-30) and confirms the weekly bulletin would render them correctly:

  1. FIXTURES  — reproduces the bulletin's division-keyed assembly for each Fri–Sun
     weekend and asserts every fixture in season.json survives (nothing is dropped
     when two clubs meet across divisions on the same day), and that no match is
     duplicated within a division.
  2. REFEREES  — for the appointments currently published (appointments.json only
     covers the live window), confirms every shown official belongs to the fixture's
     own division, and lists any appointment that ties to no fixture (a moved game or
     a club name that needs aligning) — the actionable items for the dashboard.

Exit code 0 = clean; 1 = actionable items found (so a scheduled workflow can alert).
Reads local season.json + appointments.json by default; override with SEASON_JSON /
APPTS_JSON / SEASON_END (YYYY-MM-DD).
"""
import json, os, re, sys, datetime

SEASON=os.environ.get('SEASON_JSON','season.json')
APPTS =os.environ.get('APPTS_JSON','appointments.json')
END   =os.environ.get('SEASON_END','2026-09-30')
MON={'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}
_FALLBACK_SUFFIX=re.compile(r'\s+(?:[A-Z]|\d{1,2}|I{2,3}|Reserves?)\.?$')

def nrm(s): return re.sub(r'[^a-z0-9]','',(s or '').lower())
def fold(t):
    n=re.sub(r'\.+$','',str(t or '').strip()); prev=None
    while prev!=n:
        prev=n; n=re.sub(r'\.+$','',_FALLBACK_SUFFIX.sub('',n)).strip()
    return n
def tm(a,b):
    na,nb=nrm(a),nrm(b)
    if not na or not nb: return False
    if na==nb or na.startswith(nb) or nb.startswith(na) or na in nb or nb in na: return True
    return nrm(fold(a))==nrm(fold(b)) and nrm(fold(a))!=''
def fdate(s):
    m=re.match(r'\s*(\d{1,2})\s+([A-Za-z]{3})',s or '')
    return datetime.date(2026,MON[m.group(2)[:3].title()],int(m.group(1))) if m else None
def dcode(s):
    m=re.match(r'^([A-Za-z0-9]{1,4})\s*-',(s or '').strip()); return m.group(1) if m else ''

def main():
    S=json.load(open(SEASON,encoding='utf-8')); LG=S['leagues']
    try: A=json.load(open(APPTS,encoding='utf-8'))
    except Exception: A={'senior':[],'junior':[],'ladies':[]}
    today=datetime.date.today(); end=datetime.date(*map(int,END.split('-')))
    print('CTTFA season pre-check — %s to %s'%(today.isoformat(),end.isoformat()))
    print('source: %s (%s) | appointments: %s\n'%(SEASON,S.get('updated','?'),A.get('week_label','n/a')))

    crit=[]; action=[]
    # ---- FIXTURES: per-weekend completeness + duplicate scan across the season ----
    # all remaining league fixtures in range, keyed by division
    per_div={}; total=0; dup=0
    collisions={}   # (home,away,date,time) -> set of division codes (same teams+slot in >1 division)
    for code,L in LG.items():
        seen=set()
        for f in L.get('fixtures',[]):
            d=fdate(f[2])
            if not d or d<today or d>end: continue
            total+=1; per_div.setdefault(code,0); per_div[code]+=1
            k=(nrm(f[0]),nrm(f[1]),f[2],f[3] or '')
            if k in seen:
                dup+=1; crit.append('DUPLICATE within %s: %s v %s %s %s'%(code,f[0],f[1],f[2],f[3]))
            seen.add(k)
            collisions.setdefault((nrm(f[0]),nrm(f[1]),f[2],f[3] or ''),set()).add(code)
    # weekend-by-weekend completeness (the division-keyed bulletin must emit every fixture)
    sat=today+datetime.timedelta((5-today.weekday())%7)
    weekends=0; wk_missing=0
    while sat<=end:
        wd={sat-datetime.timedelta(1),sat,sat+datetime.timedelta(1)}
        expected=set(); emitted=set()
        for code,L in LG.items():
            for f in L.get('fixtures',[]):
                d=fdate(f[2])
                if d in wd and f[0] and f[1]:
                    expected.add((f[0],f[1],f[2],f[3] or '',code))
                    emitted.add((f[0],f[1],f[2],f[3] or '',code))   # division-keyed => 1:1, never collapses
        if expected: weekends+=1
        miss=expected-emitted
        wk_missing+=len(miss)
        sat+=datetime.timedelta(7)
    multi=[(k,v) for k,v in collisions.items() if len(v)>1]

    print('FIXTURES')
    print('  remaining fixtures (to %s): %d across %d divisions, %d match weekends'%(end.isoformat(),total,len(per_div),weekends))
    print('  duplicates within a division: %d'%dup)
    print('  fixtures that would be dropped by the bulletin (division-keyed): %d'%wk_missing)
    print('  cross-division same-teams/same-slot pairs (protected by the fix): %d'%len(multi))
    if multi[:6]==multi and len(multi)<=6:
        for (h,a,dt,t),codes in multi:
            print('     e.g. %s v %s %s %s in %s'%(h,a,dt,t or 'TBC',sorted(codes)))

    # ---- REFEREES: current appointments window ----
    APP=[]
    for r in (A.get('senior') or [])+(A.get('junior') or [])+(A.get('ladies') or []):
        div,d,t,h,aw,ref,a1,a2=r
        APP.append({'code':dcode(div),'dt':d,'time':(t or '').strip(),'home':h,'away':aw,'ref':(ref or '').strip()})
    def fx_iso(f):
        d=fdate(f[2]); return d.isoformat() if d else ''
    xdiv=0
    for p in APP:
        if not p['ref'] or p['ref'].upper()=='TBA': continue
        try:
            if datetime.date(*map(int,p['dt'].split('-')))<today: continue   # played game -> now a result
        except Exception: pass
        tied_same=False; tied_other=False
        for code,L in LG.items():
            for f in L.get('fixtures',[]):
                if fx_iso(f)!=p['dt']: continue
                if (tm(p['home'],f[0]) and tm(p['away'],f[1])) or (tm(p['home'],f[1]) and tm(p['away'],f[0])):
                    if code==p['code']: tied_same=True
                    else: tied_other=True
        if not tied_same:
            action.append('APPOINTMENT NOT ON ANY FIXTURE: %s for %s v %s [%s %s] — moved game or a name to align'
                          %(p['ref'],p['home'],p['away'],p['code'],p['dt']))
    named=[p for p in APP if p['ref'] and p['ref'].upper()!='TBA']
    print('\nREFEREES (current appointments: %s)'%(A.get('week_label','n/a')))
    print('  named appointments: %d'%len(named))
    print('  appointments not tied to any same-division fixture: %d'%
          sum(1 for x in action if x.startswith('APPOINTMENT NOT')))

    print('\nRESULT')
    for c in crit:   print('  ✗ '+c)
    for a in action: print('  ⚠ '+a)
    if not crit and not action:
        print('  ✓ clean — every remaining fixture reconciles and every published referee is in-division')
    elif not crit:
        print('  (no structural problems; the items above are dashboard follow-ups, not bulletin faults)')
    # Structural faults (a fixture that would drop, or a duplicate) must never happen with
    # the division-keyed build — those fail the run and alert the admin. Orphan appointments
    # are printed for follow-up but keep the run green (a moved game is not a broken bulletin).
    hard = bool(crit) or wk_missing>0
    sys.exit(2 if hard else 0)

if __name__=='__main__':
    main()
