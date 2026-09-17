/* CTTLFA admin — Fixture Analytics module. Closure over window.AC.
   Pulls every fixture for a season straight from the LeagueRepublic JSON API
   (leagueID 895893986) and builds full analytics: team entrants, teams per club,
   day/kick-off breakdowns, a season calendar heat-map, schedule completion and
   clash checks, year-on-year trends, and fixture issues. Every headline number
   drills down to the underlying fixtures with branded PDF and CSV export.
   Segment filter: All / Senior / Junior (+ per-division). Seasons 2022-2026. */
(function (NS) {
  "use strict";
  var API = "https://api.leaguerepublic.com/json";
  var SEASONS = [
    { y: 2026, id: 47708359 }, { y: 2025, id: 763744782 }, { y: 2024, id: 690463870 },
    { y: 2023, id: 255625703 }, { y: 2022, id: 621106727 }
  ];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var CODE = /^[A-Za-z0-9]+-\s*\d+\s*-\s*/;
  var cache = {};                 // seasonId -> {fixtures, groups}
  var cur = SEASONS[0].id;        // current season id (2026)
  var subView = "overview";
  var segment = "all";            // all | senior | junior
  var divFilter = "";             // fixtureGroupIdentifier as string, or ""

  function jget(path) {
    return fetch(API + path + ".json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return null; });
  }
  function clean(n) { return (n || "").replace(CODE, "").replace(/\s+/g, " ").trim(); }
  function isBye(n) { return /(^|\s)bye\.?$/i.test(clean(n)); }
  function isJunior(desc) { return /\bunder\b|\bu-?1[2-8]\b/i.test(desc || ""); }
  function clubOf(n) { return clean(n).replace(/\s+[A-Z]$/, "").replace(/\s+\d+$/, "").trim(); }
  function pad(x) { return ("0" + x).slice(-2); }
  function isNum(v) { return v != null && /^-?\d+$/.test(String(v)); }
  function dParts(s) { // "20260912 15:00" -> {y,m,d,hh,mm,dow,iso}
    if (!s || s.length < 8) return null;
    var y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    var hh = s.length >= 14 ? +s.slice(9, 11) : null, mm = s.length >= 14 ? +s.slice(12, 14) : null;
    var dt = new Date(y, m - 1, d);
    return { y: y, m: m, d: d, hh: hh, mm: mm, dow: dt.getDay(), iso: y + "-" + pad(m) + "-" + pad(d), t: dt.getTime() };
  }
  function fmtDate(iso) { var d = new Date(iso + "T00:00:00"); return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); }
  function seasonYear(id) { var s = SEASONS.filter(function (x) { return x.id === id; })[0]; return s ? s.y : id; }
  function segLabel() { return segment === "senior" ? "Senior" : segment === "junior" ? "Junior" : "All football"; }

  function loadSeason(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    return Promise.all([jget("/getFixturesForSeason/" + id), jget("/getFixtureGroupsForSeason/" + id)])
      .then(function (r) {
        if (!r[0]) return null;
        cache[id] = { fixtures: r[0], groups: r[1] || [] };
        return cache[id];
      });
  }

  /* fixtures for the active season, after segment + division filter */
  function filtered() {
    var data = cache[cur]; if (!data) return [];
    return data.fixtures.filter(function (f) {
      if (segment === "junior" && !isJunior(f.fixtureGroupDesc)) return false;
      if (segment === "senior" && isJunior(f.fixtureGroupDesc)) return false;
      if (divFilter && String(f.fixtureGroupIdentifier) !== divFilter) return false;
      return true;
    });
  }

  function analyze(fx, groups) {
    var league = fx.filter(function (x) { return x.fixtureTypeID === 1; });
    var cups = fx.filter(function (x) { return x.fixtureTypeID === 2; });
    var gids = {}; fx.forEach(function (f) { gids[f.fixtureGroupIdentifier] = f.fixtureTypeID; });
    var divs = 0, comps = 0;
    Object.keys(gids).forEach(function (k) { if (gids[k] === 2) comps++; else divs++; });

    var o = {
      total: fx.length, league: league.length, cups: cups.length, divs: divs, comps: comps,
      played: 0, unplayed: 0, byes: 0, walkHome: 0, walkAway: 0, abandoned: 0, postponed: 0, normal: 0,
      day: {}, night: 0, dayGames: 0, byHour: {}, byMonth: {}, byDate: {}, venues: {},
      teams: {}, clubs: {}, firstT: Infinity, lastT: -Infinity,
      goals: 0, scored: 0, biggestWin: null, cleanSheets: 0
    };
    DOW.forEach(function (d) { o.day[d] = 0; });

    fx.forEach(function (f) {
      var bye = isBye(f.homeTeamName) || isBye(f.roadTeamName);
      if (bye) o.byes++;
      var s = (f.fixtureStatusDesc || "").toLowerCase();
      if (s.indexOf("home walkover") >= 0) o.walkHome++;
      else if (s.indexOf("away walkover") >= 0) o.walkAway++;
      else if (s.indexOf("abandon") >= 0) o.abandoned++;
      else if (s.indexOf("postpon") >= 0) o.postponed++;
      else o.normal++;
      if (f.result) o.played++; else if (!bye) o.unplayed++;
      [["homeTeam", "homeTeamName"], ["roadTeam", "roadTeamName"]].forEach(function (p) {
        var nm = f[p[1]]; if (!nm || isBye(nm)) return;
        var id = f[p[0]]; if (id != null) o.teams[id] = clean(nm);
      });
      // goals (numeric scores only)
      if (isNum(f.homeScore) && isNum(f.roadScore)) {
        var hs = +f.homeScore, rs = +f.roadScore;
        o.scored++; o.goals += hs + rs;
        if (hs === 0 || rs === 0) o.cleanSheets++;
        var m = Math.abs(hs - rs);
        if (!o.biggestWin || m > o.biggestWin.m) o.biggestWin = { m: m, f: f, hs: hs, rs: rs };
      }
      var dp = dParts(f.fixtureDate); if (!dp) return;
      if (!bye) {
        o.day[DOW[dp.dow]]++;
        o.byMonth[dp.y + "-" + pad(dp.m)] = (o.byMonth[dp.y + "-" + pad(dp.m)] || 0) + 1;
        o.byDate[dp.iso] = (o.byDate[dp.iso] || 0) + 1;
        if (dp.hh != null) {
          o.byHour[dp.hh] = (o.byHour[dp.hh] || 0) + 1;
          if (dp.hh >= 17) o.night++; else o.dayGames++;
        }
        var v = f.venueAndSubVenueDesc || ""; if (v) o.venues[v] = (o.venues[v] || 0) + 1;
        if (dp.t < o.firstT) o.firstT = dp.t;
        if (dp.t > o.lastT) o.lastT = dp.t;
      }
    });
    Object.keys(o.teams).forEach(function (id) { var c = clubOf(o.teams[id]); (o.clubs[c] = o.clubs[c] || 0); o.clubs[c]++; });
    o.nTeams = Object.keys(o.teams).length;
    o.nClubs = Object.keys(o.clubs).length;
    o.walkovers = o.walkHome + o.walkAway;
    return o;
  }

  /* ---------- drill subsets ---------- */
  function drillSet(key) {
    var fx = filtered();
    function nonBye(f) { return !isBye(f.homeTeamName) && !isBye(f.roadTeamName); }
    if (key === "total") return { title: "All fixtures", fx: fx };
    if (key === "played") return { title: "Played fixtures", fx: fx.filter(function (f) { return f.result; }) };
    if (key === "unplayed") return { title: "Fixtures still to play", fx: fx.filter(function (f) { return !f.result && nonBye(f); }) };
    if (key === "league") return { title: "League fixtures", fx: fx.filter(function (f) { return f.fixtureTypeID === 1; }) };
    if (key === "cups") return { title: "Cup fixtures", fx: fx.filter(function (f) { return f.fixtureTypeID === 2; }) };
    if (key === "byes") return { title: "Byes", fx: fx.filter(function (f) { return isBye(f.homeTeamName) || isBye(f.roadTeamName); }) };
    if (key === "walkovers") return { title: "Walkovers", fx: fx.filter(function (f) { return /walkover/i.test(f.fixtureStatusDesc || ""); }) };
    if (key === "walkHome") return { title: "Home walkovers", fx: fx.filter(function (f) { return /home walkover/i.test(f.fixtureStatusDesc || ""); }) };
    if (key === "walkAway") return { title: "Away walkovers", fx: fx.filter(function (f) { return /away walkover/i.test(f.fixtureStatusDesc || ""); }) };
    if (key === "postponed") return { title: "Postponed fixtures", fx: fx.filter(function (f) { return /postpon/i.test(f.fixtureStatusDesc || ""); }) };
    if (key === "abandoned") return { title: "Abandoned fixtures", fx: fx.filter(function (f) { return /abandon/i.test(f.fixtureStatusDesc || ""); }) };
    if (key === "night") return { title: "Night games (17:00 and later)", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && d.hh != null && d.hh >= 17 && nonBye(f); }) };
    if (key === "day") return { title: "Daytime games (before 17:00)", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && d.hh != null && d.hh < 17 && nonBye(f); }) };
    if (key.indexOf("dow:") === 0) { var wd = +key.slice(4); return { title: DOW[wd] + " fixtures", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && d.dow === wd && nonBye(f); }) }; }
    if (key.indexOf("date:") === 0) { var iso = key.slice(5); return { title: "Fixtures on " + fmtDate(iso), fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && d.iso === iso && nonBye(f); }) }; }
    if (key.indexOf("club:") === 0) { var cn = key.slice(5); return { title: cn + " — all fixtures", fx: fx.filter(function (f) { return (clubOf(f.homeTeamName) === cn || clubOf(f.roadTeamName) === cn) && nonBye(f); }) }; }
    if (key.indexOf("div:") === 0) { var gid = key.slice(4); return { title: (fx.filter(function (f) { return String(f.fixtureGroupIdentifier) === gid; })[0] || {}).fixtureGroupDesc || "Division", fx: fx.filter(function (f) { return String(f.fixtureGroupIdentifier) === gid; }) }; }
    if (key.indexOf("overdue:") === 0) { var g = key.slice(8); var now = Date.now(); return { title: "Overdue fixtures", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && d.t < now && !f.result && nonBye(f) && !/postpon/i.test(f.fixtureStatusDesc || "") && (g === "*" || String(f.fixtureGroupIdentifier) === g); }) }; }
    if (key === "teamClash") return { title: "Teams scheduled twice at the same time", fx: teamClashes().fx };
    return { title: "Fixtures", fx: fx };
  }

  /* rows for a fixture list: [Date, Time, Competition, Home, Away, Venue, Status] */
  function fxRows(list) {
    return list.slice().sort(function (a, b) { return (a.fixtureDate || "").localeCompare(b.fixtureDate || ""); }).map(function (f) {
      var d = dParts(f.fixtureDate);
      var t = d && d.hh != null ? pad(d.hh) + ":" + pad(d.mm) : "TBC";
      var score = (isNum(f.homeScore) && isNum(f.roadScore)) ? (f.homeScore + "-" + f.roadScore) : (f.fixtureStatusDesc || (f.result ? "Result" : "Scheduled"));
      return [d ? fmtDate(d.iso) : "TBC", t, f.fixtureGroupDesc || "", clean(f.homeTeamName), clean(f.roadTeamName), f.venueAndSubVenueDesc || "", score];
    });
  }
  var FX_COLS = ["Date", "Time", "Competition", "Home", "Away", "Venue", "Score / status"];

  /* ---------- clash / congestion analysis ----------
     A genuine, indisputable clash is one team scheduled in two fixtures at the
     same date AND kick-off time (it cannot be in two places at once). Two games
     at one venue at one time are NOT flagged — grounds run several pitches at
     once, so that produces false alarms. Venue load is shown as planning
     information, not as an error. */
  function teamClashes() {
    var fx = filtered().filter(function (f) { return !isBye(f.homeTeamName) && !isBye(f.roadTeamName); });
    var by = {}; fx.forEach(function (f) {
      if ((f.fixtureDate || "").length < 14) return;               // need a time
      [f.homeTeam, f.roadTeam].forEach(function (tid) { if (tid == null) return; var k = tid + "|" + f.fixtureDate; (by[k] = by[k] || []).push(f); });
    });
    var seen = {}, out = 0, list = [];
    Object.keys(by).forEach(function (k) { if (by[k].length > 1) { out++; by[k].forEach(function (f) { if (!seen[f.fixtureID]) { seen[f.fixtureID] = 1; list.push(f); } }); } });
    return { slots: out, fx: list };
  }
  function venueLoad() {
    var fx = filtered().filter(function (f) { return !isBye(f.homeTeamName) && !isBye(f.roadTeamName); });
    var by = {}; fx.forEach(function (f) { var v = f.venueAndSubVenueDesc || ""; var d = dParts(f.fixtureDate); if (!v || !d) return; var k = v + "|" + d.iso; (by[k] = by[k] || 0); by[k]++; });
    var arr = Object.keys(by).map(function (k) { var p = k.split("|"); return { venue: p[0], iso: p[1], n: by[k] }; }).sort(function (a, b) { return b.n - a.n; });
    return arr;
  }

  /* ---------- render helpers ---------- */
  function tile(n, lbl, sub, drill) {
    var dr = drill ? ' data-drill="' + drill + '" tabindex="0" role="button"' : '';
    return '<div class="fa-tile' + (drill ? ' fa-click' : '') + '"' + dr + '><b>' + n + '</b><span>' + lbl + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }
  function bar(label, val, max, cls, drill) {
    var pct = max ? Math.round(val / max * 100) : 0;
    var dr = drill ? ' data-drill="' + drill + '"' : '';
    return '<div class="fa-bar' + (drill ? ' fa-click' : '') + '"' + dr + '><span class="fa-bl">' + label + '</span><span class="fa-bt"><span class="fa-bf ' + (cls || '') + '" style="width:' + pct + '%"></span></span><span class="fa-bv">' + val + '</span></div>';
  }

  function renderOverview(o) {
    var h = '<div class="fa-tiles">';
    h += tile(o.total.toLocaleString(), "Total fixtures", o.league.toLocaleString() + " league · " + o.cups + " cup", "total");
    h += tile(o.played.toLocaleString(), "Played", ((o.total ? Math.round(o.played / o.total * 100) : 0)) + "% of the programme", "played");
    h += tile(o.unplayed.toLocaleString(), "Still to play", "excludes byes", "unplayed");
    h += tile(o.divs, "Divisions", o.comps + " knockout cups", "");
    h += tile(o.nTeams.toLocaleString(), "Team entrants", "distinct teams entered", "");
    h += tile(o.nClubs, "Clubs", (o.nClubs ? (o.nTeams / o.nClubs).toFixed(1) : 0) + " teams per club", "");
    h += '</div>';

    var dmax = Math.max.apply(null, DOW.map(function (d) { return o.day[d]; }).concat([1]));
    h += '<div class="fa-grid2">';
    h += '<div class="card"><h3>Fixtures by day of the week</h3>';
    ["Saturday", "Sunday", "Friday", "Thursday", "Wednesday", "Tuesday", "Monday"].forEach(function (d) {
      h += bar(d, o.day[d], dmax, d === "Saturday" ? "gold" : (d === "Sunday" ? "blue" : ""), "dow:" + DOW.indexOf(d));
    });
    h += '<p class="hint" style="margin-top:8px">Saturday is the main match day. Click any day to list and export those fixtures.</p></div>';
    var hmax = Math.max.apply(null, Object.keys(o.byHour).map(function (k) { return o.byHour[k]; }).concat([1]));
    h += '<div class="card"><h3>Kick-off times</h3>';
    h += '<div class="fa-tiles fa-tiles-sm">' + tile(o.night.toLocaleString(), "Night games", "17:00 and later", "night") + tile(o.dayGames.toLocaleString(), "Daytime games", "before 17:00", "day") + '</div>';
    var hrs = Object.keys(o.byHour).map(Number).sort(function (a, b) { return a - b; });
    h += '<div class="fa-hours">';
    hrs.forEach(function (hr) { var pct = Math.round(o.byHour[hr] / hmax * 100); h += '<div class="fa-hcol" title="' + pad(hr) + ':00 — ' + o.byHour[hr] + ' fixtures"><span class="fa-hbar ' + (hr >= 17 ? 'night' : '') + '" style="height:' + Math.max(4, pct) + '%"></span><span class="fa-hl">' + pad(hr) + '</span></div>'; });
    h += '</div><p class="hint">Bars are kick-off hours; amber bars are 17:00+ (night games).</p></div>';
    h += '</div>';

    // goals summary (where scores exist)
    if (o.scored) {
      h += '<div class="fa-tiles">';
      h += tile(o.goals.toLocaleString(), "Goals scored", "across " + o.scored.toLocaleString() + " completed games", "");
      h += tile((o.goals / o.scored).toFixed(2), "Goals per game", "average", "");
      h += tile(o.cleanSheets.toLocaleString(), "Clean sheets", "one side kept out", "");
      if (o.biggestWin) { var bw = o.biggestWin; h += tile(bw.hs + "-" + bw.rs, "Biggest margin", clean(bw.f.homeTeamName) + " v " + clean(bw.f.roadTeamName), ""); }
      h += '</div>';
    }

    var top = Object.keys(o.byDate).map(function (k) { return [k, o.byDate[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    h += '<div class="card"><h3>Busiest match days</h3><table><thead><tr><th>Date</th><th>Day</th><th style="text-align:right">Fixtures</th></tr></thead><tbody>';
    top.forEach(function (r) { var d = new Date(r[0] + "T00:00:00"); h += '<tr class="fa-click" data-drill="date:' + r[0] + '"><td>' + fmtDate(r[0]) + '</td><td>' + DOW[d.getDay()] + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
    h += '</tbody></table><p class="hint" style="margin-top:6px">Click a row to list and export that day.</p></div>';
    return h;
  }

  function renderEntrants(o) {
    var clubs = Object.keys(o.clubs).map(function (c) { return [c, o.clubs[c]]; }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
    var h = '<div class="fa-tiles">';
    h += tile(o.nClubs, "Clubs", "distinct clubs", "");
    h += tile(o.nTeams.toLocaleString(), "Teams entered", "across all divisions", "");
    h += tile((o.nClubs ? (o.nTeams / o.nClubs).toFixed(1) : 0), "Avg teams / club", "", "");
    h += tile(clubs.length ? clubs[0][1] : 0, "Most teams", clubs.length ? clubs[0][0] : "", "");
    h += '</div>';
    h += '<div class="card"><h3>Teams entered per club</h3><p class="hint" style="margin-bottom:8px">How many teams each club fields across every age group and division. Click a club to list its fixtures.</p>';
    h += '<table><thead><tr><th>#</th><th>Club</th><th style="text-align:right">Teams</th></tr></thead><tbody>';
    clubs.forEach(function (r, i) { h += '<tr class="fa-click" data-drill="club:' + NS.esc(r[0]) + '"><td>' + (i + 1) + '</td><td>' + NS.esc(r[0]) + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
    h += '</tbody></table></div>';
    return h;
  }

  function renderIssues(o) {
    var h = '<div class="fa-tiles">';
    h += tile(o.walkovers, "Walkovers", o.walkHome + " home · " + o.walkAway + " away", "walkovers");
    h += tile(o.byes.toLocaleString(), "Byes", "teams with no opponent", "byes");
    h += tile(o.postponed, "Postponed", "still marked postponed", "postponed");
    h += tile(o.abandoned, "Abandoned", "matches abandoned", "abandoned");
    h += '</div>';
    h += '<div class="card"><h3>Result &amp; status breakdown</h3>';
    var max = Math.max(o.normal, o.walkovers, o.byes, o.abandoned, o.postponed, 1);
    h += bar("Normal (no issue)", o.normal, max, "green");
    h += bar("Home walkovers", o.walkHome, max, "gold", "walkHome");
    h += bar("Away walkovers", o.walkAway, max, "gold", "walkAway");
    h += bar("Byes", o.byes, max, "blue", "byes");
    h += bar("Abandoned", o.abandoned, max, "red", "abandoned");
    h += bar("Postponed", o.postponed, max, "red", "postponed");
    h += '<p class="hint" style="margin-top:8px">Walkovers, abandonments and postponements are the fixture-integrity items to watch. Byes are scheduled gaps, not problems. Click any to export.</p></div>';
    // walkover hotspots by club
    var wo = filtered().filter(function (f) { return /walkover/i.test(f.fixtureStatusDesc || ""); });
    var hot = {}; wo.forEach(function (f) { var loser = /home walkover/i.test(f.fixtureStatusDesc) ? f.roadTeamName : f.homeTeamName; var c = clubOf(loser); if (c) hot[c] = (hot[c] || 0) + 1; });
    var hotArr = Object.keys(hot).map(function (k) { return [k, hot[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
    if (hotArr.length) {
      h += '<div class="card"><h3>Walkover hotspots by club</h3><p class="hint" style="margin-bottom:8px">Clubs conceding the most walkovers (the side that did not fulfil the fixture). A discipline and reliability signal.</p><table><thead><tr><th>Club</th><th style="text-align:right">Walkovers conceded</th></tr></thead><tbody>';
      hotArr.forEach(function (r) { h += '<tr class="fa-click" data-drill="club:' + NS.esc(r[0]) + '"><td>' + NS.esc(r[0]) + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
      h += '</tbody></table></div>';
    }
    var tv = Object.keys(o.venues).map(function (k) { return [k, o.venues[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    if (tv.length) {
      h += '<div class="card"><h3>Most-used venues</h3><table><thead><tr><th>Venue</th><th style="text-align:right">Fixtures</th></tr></thead><tbody>';
      tv.forEach(function (r) { h += '<tr><td>' + NS.esc(r[0]) + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
      h += '</tbody></table></div>';
    }
    return h;
  }

  function renderCalendar(o) {
    if (o.firstT === Infinity) return '<div class="card"><p class="hint">No dated fixtures for this selection.</p></div>';
    var months = Object.keys(o.byMonth).sort();
    var vals = Object.keys(o.byDate).map(function (k) { return o.byDate[k]; });
    var hmax = Math.max.apply(null, vals.concat([1]));
    function heat(n) { if (!n) return ""; var l = n / hmax; return l > .66 ? "h3" : l > .33 ? "h2" : "h1"; }
    var h = '<div class="card"><h3>Season calendar</h3><p class="hint" style="margin-bottom:10px">Every match day for the selection. Darker = more fixtures; Saturdays are outlined. Click a day to list and export its fixtures.</p><div class="fa-cal">';
    months.forEach(function (ym) {
      var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      var first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
      h += '<div class="fa-mon"><div class="fa-mon-h">' + MON[m - 1] + " " + y + '</div><div class="fa-week">';
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { h += '<span class="fa-wd">' + d + '</span>'; });
      for (var i = 0; i < first.getDay(); i++) h += '<span class="fa-day empty"></span>';
      for (var dd = 1; dd <= days; dd++) {
        var iso = y + "-" + pad(m) + "-" + pad(dd), n = o.byDate[iso] || 0, dow = new Date(y, m - 1, dd).getDay();
        h += '<span class="fa-day ' + heat(n) + (dow === 6 ? ' sat' : '') + (n ? ' has' : '') + '"' + (n ? ' data-drill="date:' + iso + '"' : '') + ' title="' + dd + " " + MON[m - 1] + ": " + n + ' fixtures">' + dd + (n ? '<i>' + n + '</i>' : '') + '</span>';
      }
      h += '</div></div>';
    });
    h += '</div></div>';
    return h;
  }

  function renderSchedule() {
    var fx = filtered();
    var now = Date.now();
    // per division
    var divs = {};
    fx.forEach(function (f) {
      var g = f.fixtureGroupIdentifier; if (!divs[g]) divs[g] = { name: f.fixtureGroupDesc || "?", type: f.fixtureTypeID, total: 0, played: 0, overdue: 0, last: 0 };
      var D = divs[g]; D.total++; if (f.result) D.played++;
      var d = dParts(f.fixtureDate);
      if (d) { if (d.t > D.last) D.last = d.t; var bye = isBye(f.homeTeamName) || isBye(f.roadTeamName); if (d.t < now && !f.result && !bye && !/postpon/i.test(f.fixtureStatusDesc || "")) D.overdue++; }
    });
    var arr = Object.keys(divs).map(function (g) { var D = divs[g]; D.gid = g; D.pct = D.total ? Math.round(D.played / D.total * 100) : 0; D.remaining = D.total - D.played; return D; })
      .sort(function (a, b) { return b.overdue - a.overdue || a.pct - b.pct; });
    var totOver = arr.reduce(function (s, D) { return s + D.overdue; }, 0);
    var tc = teamClashes(), vl = venueLoad();

    var h = '<div class="fa-tiles">';
    h += tile(arr.length, "Competitions", "divisions and cups in view", "");
    h += tile(totOver, "Overdue fixtures", "date passed, no result", "overdue:*");
    h += tile(tc.slots, "Scheduling clashes", "a team booked twice at one time", "teamClash");
    h += tile(vl.length ? vl[0].n : 0, "Busiest venue-day", vl.length ? (vl[0].venue.split(" ").slice(0, 2).join(" ")) : "", "");
    h += '</div>';

    h += '<div class="card"><h3>Completion by competition</h3><p class="hint" style="margin-bottom:8px">Played versus scheduled, with fixtures whose date has passed but no result is recorded. Sorted by overdue, then by lowest completion. Click a row to list its fixtures.</p>';
    h += '<table><thead><tr><th>Competition</th><th style="text-align:right">Played</th><th style="text-align:right">Total</th><th>Progress</th><th style="text-align:right">Overdue</th></tr></thead><tbody>';
    arr.forEach(function (D) {
      var barc = D.overdue > 0 ? "red" : (D.pct >= 100 ? "green" : "");
      h += '<tr class="fa-click" data-drill="div:' + D.gid + '"><td>' + NS.esc(D.name) + '</td><td style="text-align:right">' + D.played + '</td><td style="text-align:right">' + D.total + '</td>' +
        '<td><span class="fa-mini"><span class="fa-mini-f ' + barc + '" style="width:' + D.pct + '%"></span></span><span class="fa-mini-l">' + D.pct + '%</span></td>' +
        '<td style="text-align:right">' + (D.overdue ? '<b class="fa-warn" data-drill="overdue:' + D.gid + '">' + D.overdue + '</b>' : '<span class="fa-ok">0</span>') + '</td></tr>';
    });
    h += '</tbody></table></div>';

    // scheduling clashes (genuine): a team booked twice at the same time
    h += '<div class="card"><h3>Scheduling clashes</h3>';
    if (tc.slots) {
      h += '<p class="hint" style="margin-bottom:8px">A team appears in two fixtures at the same date and kick-off time. It cannot play both, so one needs rescheduling in LeagueRepublic. Click the tile above to export.</p>';
      var cr = fxRows(tc.fx);
      h += '<table><thead><tr>' + FX_COLS.map(function (c) { return '<th>' + c + '</th>'; }).join("") + '</tr></thead><tbody>';
      cr.forEach(function (r) { h += '<tr>' + r.map(function (c) { return '<td>' + NS.esc(c) + '</td>'; }).join("") + '</tr>'; });
      h += '</tbody></table>';
    } else {
      h += '<p class="hint"><b class="fa-ok">No clashes found.</b> No team is scheduled in two fixtures at the same time for this selection.</p>';
    }
    h += '</div>';

    // venue load (planning information, not an error)
    var top = vl.slice(0, 12);
    if (top.length) {
      h += '<div class="card"><h3>Busiest venue-days</h3><p class="hint" style="margin-bottom:8px">Grounds hosting the most fixtures on a single day. Planning information for pitch load and parking, not a scheduling error. Click a row to list that day.</p>';
      h += '<table><thead><tr><th>Venue</th><th>Date</th><th style="text-align:right">Fixtures</th></tr></thead><tbody>';
      top.forEach(function (r) { h += '<tr class="fa-click" data-drill="date:' + r.iso + '"><td>' + NS.esc(r.venue) + '</td><td>' + fmtDate(r.iso) + '</td><td style="text-align:right"><b>' + r.n + '</b></td></tr>'; });
      h += '</tbody></table></div>';
    }
    return h;
  }

  function renderTrends() {
    var need = SEASONS.filter(function (s) { return !cache[s.id]; });
    if (need.length) {
      NS.$("faBody").innerHTML = '<div class="card"><p class="hint">Loading all seasons (2022–2026) from LeagueRepublic…</p></div>';
      (function chain(i) {
        if (i >= SEASONS.length) { paint(cur); return; }
        var s = SEASONS[i];
        if (cache[s.id]) return chain(i + 1);
        loadSeason(s.id).then(function () { setTimeout(function () { chain(i + 1); }, 250); });
      })(0);
      return '<div class="card"><p class="hint">Loading all seasons (2022–2026) from LeagueRepublic…</p></div>';
    }
    var rows = SEASONS.slice().sort(function (a, b) { return a.y - b.y; }).map(function (s) {
      var fx = cache[s.id].fixtures.filter(function (f) { return segment === "junior" ? isJunior(f.fixtureGroupDesc) : segment === "senior" ? !isJunior(f.fixtureGroupDesc) : true; });
      var o = analyze(fx, cache[s.id].groups);
      var clubset = {}; Object.keys(o.teams).forEach(function (id) { clubset[clubOf(o.teams[id])] = 1; });
      return { y: s.y, fx: o.total, teams: o.nTeams, clubs: o.nClubs, goals: o.goals, clubset: clubset };
    });
    function growth(cur, prev) { if (prev == null || !prev) return ""; var d = cur - prev; return d === 0 ? '<span class="fa-flat">±0</span>' : (d > 0 ? '<span class="fa-up">▲ ' + d + '</span>' : '<span class="fa-down">▼ ' + Math.abs(d) + '</span>'); }

    var latest = rows[rows.length - 1], first = rows[0];
    var h = '<div class="fa-tiles">';
    h += tile(latest.teams.toLocaleString(), "Teams (" + latest.y + ")", growthTxt(latest.teams, first.teams) + " since " + first.y, "");
    h += tile(latest.clubs, "Clubs (" + latest.y + ")", growthTxt(latest.clubs, first.clubs) + " since " + first.y, "");
    h += tile(latest.fx.toLocaleString(), "Fixtures (" + latest.y + ")", growthTxt(latest.fx, first.fx) + " since " + first.y, "");
    var ret = retention(rows);
    h += tile(ret.pct + "%", "Club retention", ret.kept + " of " + ret.base + " clubs stayed " + (latest.y - 1) + "→" + latest.y, "");
    h += '</div>';

    h += '<div class="card"><h3>Year-on-year growth — ' + segLabel() + '</h3><p class="hint" style="margin-bottom:8px">Team entrants, clubs and fixtures per season, with the change on the previous year. Straight into the Treasurer\'s report and AGM.</p>';
    h += '<table><thead><tr><th>Season</th><th style="text-align:right">Teams</th><th></th><th style="text-align:right">Clubs</th><th></th><th style="text-align:right">Fixtures</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var p = i ? rows[i - 1] : null;
      h += '<tr><td><b>' + r.y + '</b></td><td style="text-align:right">' + r.teams.toLocaleString() + '</td><td>' + (p ? growth(r.teams, p.teams) : "") + '</td>' +
        '<td style="text-align:right">' + r.clubs + '</td><td>' + (p ? growth(r.clubs, p.clubs) : "") + '</td>' +
        '<td style="text-align:right">' + r.fx.toLocaleString() + '</td><td>' + (p ? growth(r.fx, p.fx) : "") + '</td></tr>';
    });
    h += '</tbody></table></div>';

    // simple team-count trend bars
    var tmax = Math.max.apply(null, rows.map(function (r) { return r.teams; }).concat([1]));
    h += '<div class="card"><h3>Team entrants trend</h3>';
    rows.forEach(function (r) { h += bar(String(r.y), r.teams, tmax, "blue"); });
    h += '<p class="hint" style="margin-top:8px">Distinct teams entered per season for ' + segLabel().toLowerCase() + '.</p></div>';
    return h;
  }
  function growthTxt(cur, prev) { if (!prev) return ""; var d = cur - prev; return (d >= 0 ? "+" : "") + d; }
  function retention(rows) {
    if (rows.length < 2) return { pct: 0, kept: 0, base: 0 };
    var a = rows[rows.length - 2].clubset, b = rows[rows.length - 1].clubset;
    var base = Object.keys(a).length, kept = Object.keys(a).filter(function (c) { return b[c]; }).length;
    return { pct: base ? Math.round(kept / base * 100) : 0, kept: kept, base: base };
  }

  /* ---------- drill modal + exports ---------- */
  var lastDrill = null;
  function openDrill(key) {
    var d = drillSet(key); lastDrill = d;
    var rows = fxRows(d.fx);
    var scrim = NS.$("faScrim");
    if (!scrim) { scrim = document.createElement("div"); scrim.id = "faScrim"; scrim.className = "fa-scrim"; document.body.appendChild(scrim); }
    var head = '<div class="fa-mhead"><div><h3 style="margin:0">' + NS.esc(d.title) + '</h3><p class="hint" style="margin:2px 0 0">' + seasonYear(cur) + " · " + segLabel() + (divFilter ? " · filtered division" : "") + ' · ' + rows.length + ' fixtures</p></div>' +
      '<div class="fa-mbtns"><button class="btn ghost sm" id="faCsv">Download CSV</button><button class="btn gold sm" id="faPdf">Download PDF</button><button class="btn ghost sm" id="faClose">Close</button></div></div>';
    var body = '<div class="fa-mbody">';
    if (!rows.length) body += '<p class="hint">No fixtures in this selection.</p>';
    else {
      body += '<table><thead><tr>' + FX_COLS.map(function (c) { return '<th>' + c + '</th>'; }).join("") + '</tr></thead><tbody>';
      rows.forEach(function (r) { body += '<tr>' + r.map(function (c) { return '<td>' + NS.esc(c) + '</td>'; }).join("") + '</tr>'; });
      body += '</tbody></table>';
    }
    body += '</div>';
    scrim.innerHTML = '<div class="fa-modal">' + head + body + '</div>';
    scrim.classList.add("on"); scrim.style.display = "flex";
    NS.$("faClose").onclick = closeDrill;
    scrim.onclick = function (e) { if (e.target === scrim) closeDrill(); };
    NS.$("faCsv").onclick = function () { exportCSV(d.title, rows); };
    NS.$("faPdf").onclick = function () { exportPDF(d.title, rows); };
  }
  function closeDrill() { var s = NS.$("faScrim"); if (s) { s.classList.remove("on"); s.style.display = "none"; s.innerHTML = ""; } }

  function safeName(t) { return (seasonYear(cur) + " " + segLabel() + " " + t).replace(/[^A-Za-z0-9 ]+/g, "").replace(/\s+/g, " ").trim(); }
  function exportCSV(title, rows) {
    var esc = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [FX_COLS.join(",")].concat(rows.map(function (r) { return r.map(esc).join(","); }));
    var meta = "CTTLFA Fixture Analytics," + title + "\nSeason," + seasonYear(cur) + ",Segment," + segLabel() + "\nSource,LeagueRepublic API,Extracted," + new Date().toLocaleString("en-ZA") + "\n\n";
    var blob = new Blob([meta + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "CTTLFA " + safeName(title) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }
  function faPdfHead(doc, title) {
    var W = doc.internal.pageSize.getWidth();
    doc.setFillColor(7, 26, 74); doc.rect(0, 0, W, 64, "F");
    // CTTLFA crest on a white badge plate at the right of the navy bar
    try {
      if (window.LOGO_URI) {
        var lw = 43, lh = 44, lx = W - 40 - lw, ly = 10;
        doc.setFillColor(255, 255, 255); doc.roundedRect(lx - 4, ly - 3, lw + 8, lh + 6, 5, 5, "F");
        doc.addImage(window.LOGO_URI, "JPEG", lx, ly, lw, lh);
      }
    } catch (e) { }
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("CTTLFA", 40, 30);
    doc.setFontSize(10); doc.setTextColor(200, 210, 235); doc.text("Cape Town Tygerberg Local Football Association", 40, 46);
    doc.setTextColor(20, 30, 50); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(title, 40, 92);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90, 101, 119);
    doc.text("Season " + seasonYear(cur) + "  |  " + segLabel() + "  |  Source: LeagueRepublic API  |  Extracted " + new Date().toLocaleString("en-ZA"), 40, 108);
  }
  function exportPDF(title, rows) {
    if (!window.jspdf) { alert("PDF library still loading, try again."); return; }
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    faPdfHead(doc, title);
    doc.autoTable({
      startY: 122, head: [FX_COLS], body: rows,
      styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" }, headStyles: { fillColor: [24, 64, 80], textColor: 255 },
      alternateRowStyles: { fillColor: [244, 246, 251] },
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 38, halign: "center" }, 2: { cellWidth: 150 }, 6: { cellWidth: 90 } },
      margin: { left: 40, right: 40 }
    });
    var y = doc.lastAutoTable.finalY + 16; if (y > 520) { doc.addPage(); y = 40; }
    doc.setFontSize(9); doc.setTextColor(90, 101, 119); doc.setFont("helvetica", "normal");
    doc.text(rows.length + " fixtures. Prepared by the Treasurer's office from the CTTLFA LeagueRepublic feed. Read-only analytics; fixtures are managed in LeagueRepublic.", 40, y);
    doc.save("CTTLFA " + safeName(title) + ".pdf");
  }

  /* ---------- paint / wiring ---------- */
  function bindDrills() {
    Array.prototype.forEach.call(document.querySelectorAll("#fixturesRoot [data-drill]"), function (el) {
      el.addEventListener("click", function (e) { e.stopPropagation(); openDrill(el.getAttribute("data-drill")); });
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrill(el.getAttribute("data-drill")); } });
    });
  }
  function paint(id) {
    var body = NS.$("faBody"); if (!body) return;
    var fx = filtered(); var o = analyze(fx, (cache[id] || {}).groups || []);
    var html = "";
    if (subView === "overview") html = renderOverview(o);
    else if (subView === "entrants") html = renderEntrants(o);
    else if (subView === "calendar") html = renderCalendar(o);
    else if (subView === "schedule") html = renderSchedule();
    else if (subView === "trends") html = renderTrends();
    else if (subView === "issues") html = renderIssues(o);
    if (subView === "trends" && SEASONS.some(function (s) { return !cache[s.id]; })) return; // loader in flight
    body.innerHTML = html;
    bindDrills();
  }

  function buildDivOptions() {
    var data = cache[cur]; if (!data) return "";
    var seen = {}, opts = [];
    data.fixtures.forEach(function (f) {
      if (segment === "junior" && !isJunior(f.fixtureGroupDesc)) return;
      if (segment === "senior" && isJunior(f.fixtureGroupDesc)) return;
      var g = String(f.fixtureGroupIdentifier); if (seen[g]) return; seen[g] = 1;
      opts.push([g, f.fixtureGroupDesc || g]);
    });
    opts.sort(function (a, b) { return a[1].localeCompare(b[1]); });
    return '<option value="">All divisions &amp; cups</option>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === divFilter ? " selected" : "") + '>' + NS.esc(o[1]) + '</option>'; }).join("");
  }
  function refreshControls() {
    var sel = NS.$("faDiv"); if (sel) sel.innerHTML = buildDivOptions();
    Array.prototype.forEach.call(document.querySelectorAll("#fixturesRoot .fa-seg"), function (b) { b.classList.toggle("on", b.getAttribute("data-seg") === segment); });
  }

  function selectSeason(id) {
    cur = id; divFilter = "";
    var root = NS.$("fixturesRoot");
    Array.prototype.forEach.call(root.querySelectorAll(".fa-season"), function (b) { b.classList.toggle("on", +b.getAttribute("data-sid") === id); });
    NS.$("faBody").innerHTML = '<div class="card"><p class="hint">Loading ' + seasonYear(id) + ' fixtures from LeagueRepublic…</p></div>';
    loadSeason(id).then(function (d) {
      if (!d) { NS.$("faBody").innerHTML = '<div class="card"><p class="hint">Could not load this season from the API. Try again in a moment.</p></div>'; return; }
      refreshControls(); paint(id);
    });
  }

  function render() {
    var root = NS.$("fixturesRoot"); if (!root) return;
    var h = '<div class="card" style="margin-bottom:12px"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">';
    h += '<div><h3 style="margin:0 0 4px">Fixture Analytics</h3><p class="hint" style="margin:0 0 8px;max-width:78ch">Live from LeagueRepublic. Team entrants, teams per club, day and kick-off breakdowns, a season calendar, schedule completion and clashes, year-on-year trends, and fixture issues. Every number opens the underlying fixtures with PDF and CSV export. LeagueRepublic remains the source of truth for fixtures.</p><a class="btn ghost sm" href="https://a.leaguerepublic.com/myaccount/login/index.html" target="_blank" rel="noopener" title="Sign in to LeagueRepublic administration with the CTTLFA league email to manage fixtures and appointments. On the office machine your saved browser password fills it in — no password is stored on this site.">LR admin login</a></div>';
    h += '<div class="fa-seasons">' + SEASONS.map(function (s) { return '<button class="fa-season" data-sid="' + s.id + '">' + s.y + '</button>'; }).join("") + '</div>';
    h += '</div>';
    h += '<div class="fa-controls"><div class="fa-segs">' +
      '<button class="fa-seg on" data-seg="all">All</button><button class="fa-seg" data-seg="senior">Senior</button><button class="fa-seg" data-seg="junior">Junior</button>' +
      '</div><label class="fa-divlbl">Division <select id="faDiv" class="fa-select"></select></label></div>';
    h += '</div>';
    h += '<div class="fa-subtabs">' +
      '<button class="fa-sub on" data-sub="overview">Overview</button>' +
      '<button class="fa-sub" data-sub="entrants">Entrants</button>' +
      '<button class="fa-sub" data-sub="calendar">Calendar</button>' +
      '<button class="fa-sub" data-sub="schedule">Schedule</button>' +
      '<button class="fa-sub" data-sub="trends">Trends</button>' +
      '<button class="fa-sub" data-sub="issues">Issues</button></div>';
    h += '<div id="faBody"></div>';
    root.innerHTML = h;
    Array.prototype.forEach.call(root.querySelectorAll(".fa-season"), function (b) { b.addEventListener("click", function () { selectSeason(+b.getAttribute("data-sid")); }); });
    Array.prototype.forEach.call(root.querySelectorAll(".fa-seg"), function (b) {
      b.addEventListener("click", function () { segment = b.getAttribute("data-seg"); divFilter = ""; refreshControls(); if (cache[cur]) paint(cur); });
    });
    root.addEventListener("change", function (e) { if (e.target && e.target.id === "faDiv") { divFilter = e.target.value; if (cache[cur]) paint(cur); } });
    Array.prototype.forEach.call(root.querySelectorAll(".fa-sub"), function (b) {
      b.addEventListener("click", function () {
        subView = b.getAttribute("data-sub");
        Array.prototype.forEach.call(root.querySelectorAll(".fa-sub"), function (x) { x.classList.toggle("on", x === b); });
        if (cache[cur]) paint(cur);
      });
    });
    selectSeason(cur);
  }

  NS.renderFixtures = render;
})(window.AC);
