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

  /* ---------- context layers (window.FA_CTX) ---------- */
  var CTX = (typeof window !== "undefined" && window.FA_CTX) ? window.FA_CTX : null;
  var overlays = { rain: true, hol: true, ram: true, school: true, ls: true };
  function ctxHol(iso) { return CTX && CTX.hol[iso]; }
  function ctxEid(iso) { return CTX && CTX.eid[iso]; }
  function ctxRain(iso) { return CTX ? (CTX.rain[iso] || 0) : 0; }
  function ctxLS(iso) { return CTX ? (CTX.ls[iso.slice(0, 7)] || 0) : 0; }
  function ctxSchool(iso) { if (!CTX) return null; for (var i = 0; i < CTX.school.length; i++) { var b = CTX.school[i]; if (iso >= b.s && iso <= b.e) return b; } return null; }
  function ctxRamadan(iso) { if (!CTX) return null; for (var i = 0; i < CTX.ramadan.length; i++) { var r = CTX.ramadan[i]; if (iso >= r.s && iso <= r.e) return r; } return null; }
  var LS_WORD = ["None", "Light", "Moderate", "Heavy", "Severe"];

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
    if (key === "rainfx") return { title: "Fixtures on wet days (5 mm or more)", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && ctxRain(d.iso) >= 5 && nonBye(f); }) };
    if (key === "holfx") return { title: "Fixtures on public holidays", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && ctxHol(d.iso) && nonBye(f); }) };
    if (key === "ramfx") return { title: "Fixtures during Ramadan", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && ctxRamadan(d.iso) && nonBye(f); }) };
    if (key === "schoolfx") return { title: "Fixtures during school holidays", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && ctxSchool(d.iso) && nonBye(f); }) };
    if (key === "lsnight") return { title: "Night games in heavy load-shedding months", fx: fx.filter(function (f) { var d = dParts(f.fixtureDate); return d && d.hh != null && d.hh >= 17 && ctxLS(d.iso) >= 3 && nonBye(f); }) };
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

  function ovChip(key, label) { return '<button class="fa-ov' + (overlays[key] ? ' on' : '') + '" data-ov="' + key + '">' + label + '</button>'; }
  function renderCalendar(o) {
    if (o.firstT === Infinity) return '<div class="card"><p class="hint">No dated fixtures for this selection.</p></div>';
    var months = Object.keys(o.byMonth).sort();
    var vals = Object.keys(o.byDate).map(function (k) { return o.byDate[k]; });
    var hmax = Math.max.apply(null, vals.concat([1]));
    function heat(n) { if (!n) return ""; var l = n / hmax; return l > .66 ? "h3" : l > .33 ? "h2" : "h1"; }
    var h = '<div class="card"><h3>Season calendar</h3><p class="hint" style="margin-bottom:8px">Every match day for the selection. Darker = more fixtures; Saturdays are outlined. Overlay the context layers below, then click a day to list and export its fixtures.</p>';
    if (CTX) {
      h += '<div class="fa-ovbar">' + ovChip("rain", "💧 Rain") + ovChip("hol", "● Public holiday") + ovChip("ram", "Ramadan / Eid") + ovChip("school", "School holiday") + ovChip("ls", "⚡ Load shedding") + '</div>';
    }
    h += '<div class="fa-cal">';
    months.forEach(function (ym) {
      var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      var first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
      var lsv = ctxLS(ym + "-01");
      var lsBadge = (CTX && overlays.ls && lsv >= 1) ? ' <span class="fa-lsb l' + lsv + '" title="Load shedding: ' + LS_WORD[lsv] + '">⚡' + lsv + '</span>' : '';
      h += '<div class="fa-mon"><div class="fa-mon-h">' + MON[m - 1] + " " + y + lsBadge + '</div><div class="fa-week">';
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { h += '<span class="fa-wd">' + d + '</span>'; });
      for (var i = 0; i < first.getDay(); i++) h += '<span class="fa-day empty"></span>';
      for (var dd = 1; dd <= days; dd++) {
        var iso = y + "-" + pad(m) + "-" + pad(dd), n = o.byDate[iso] || 0, dow = new Date(y, m - 1, dd).getDay();
        var cls = "fa-day " + heat(n) + (dow === 6 ? " sat" : "") + (n ? " has" : "");
        var tip = dd + " " + MON[m - 1] + ": " + n + " fixtures";
        var marks = "";
        if (CTX) {
          var ram = overlays.ram && ctxRamadan(iso), sch = overlays.school && ctxSchool(iso);
          if (ram) { cls += " ov-ram"; tip += " · Ramadan"; }
          else if (sch) { cls += " ov-sch"; tip += " · " + sch.name; }
          var eidN = overlays.ram && ctxEid(iso);
          if (eidN) { cls += " ov-eid"; tip += " · " + eidN; }
          var holN = overlays.hol && ctxHol(iso);
          if (holN) { marks += '<em class="fa-mh" title="' + NS.esc(holN) + '"></em>'; tip += " · " + holN; }
          var mm = overlays.rain && ctxRain(iso);
          if (mm) { marks += '<em class="fa-mr' + (mm >= 20 ? " big" : "") + '" title="' + mm + ' mm rain"></em>'; tip += " · " + mm + " mm rain"; }
        }
        h += '<span class="' + cls + '"' + (n ? ' data-drill="date:' + iso + '"' : '') + ' title="' + tip + '">' + dd + (n ? '<i>' + n + '</i>' : '') + marks + '</span>';
      }
      h += '</div></div>';
    });
    h += '</div>';
    if (CTX) h += '<p class="hint" style="margin-top:10px">' + NS.esc(CTX.meta.rainNote) + " " + NS.esc(CTX.meta.lsNote) + '</p>';
    h += '</div>';
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

  /* ---------- context / insights ---------- */
  function datedFx() { return filtered().filter(function (f) { return !isBye(f.homeTeamName) && !isBye(f.roadTeamName) && dParts(f.fixtureDate); }); }
  var FWD = {
    y: 2027,
    hol: [["2027-03-26", "Good Friday"], ["2027-03-29", "Family Day"], ["2027-04-27", "Freedom Day"], ["2027-05-01", "Workers' Day"], ["2027-06-16", "Youth Day"], ["2027-08-09", "National Women's Day"], ["2027-09-24", "Heritage Day"]],
    ramadan: { s: "2027-02-08", e: "2027-03-09", eid: "2027-03-10" },
    school: [["2027-03-27", "2027-04-06", "Autumn break"], ["2027-06-26", "2027-07-19", "Winter break"], ["2027-09-25", "2027-10-04", "Spring break"]],
    schoolBasis: "projected", holBasis: "statutory"
  };
  // A public holiday falling on a Sunday is observed the following Monday (Public Holidays Act 36 of 1994).
  (function () { var p2 = function (n) { return n < 10 ? "0" + n : "" + n; }, add = []; FWD.hol.forEach(function (x) { var dt = new Date(x[0] + "T00:00:00"); if (dt.getDay() === 0) { dt.setDate(dt.getDate() + 1); add.push([dt.getFullYear() + "-" + p2(dt.getMonth() + 1) + "-" + p2(dt.getDate()), x[1] + " (observed Monday)"]); } }); if (add.length) FWD.hol = FWD.hol.concat(add).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); })();
  function wettestBuckets() {
    // aggregate 5-year rain into month + week-of-month buckets. The last week of a month is longer
    // than seven days, so rank by rainfall NORMALISED to mm per calendar day, not raw total.
    var b = {};
    Object.keys(CTX.rain).forEach(function (iso) {
      var m = +iso.slice(5, 7), d = +iso.slice(8, 10), wk = Math.min(3, Math.floor((d - 1) / 7));
      var wl = ["1st", "8th", "15th", "22nd"][wk];
      var key = m + "|" + wk;
      if (!b[key]) { var span = wk < 3 ? 7 : (new Date(2027, m, 0).getDate() - 21); b[key] = { m: m, wk: wk, span: span, label: wl + "–" + (wk < 3 ? ["7th", "14th", "21st"][wk] : "end") + " " + MON[m - 1], days: 0, mm: 0 }; }
      b[key].days++; b[key].mm += CTX.rain[iso];
    });
    return Object.keys(b).map(function (k) { var x = b[k]; x.mmPerDay = x.span ? x.mm / x.span / 5 : 0; return x; }).sort(function (a, b2) { return b2.mmPerDay - a.mmPerDay; });
  }
  function renderContext(o) {
    if (!CTX) return '<div class="card"><p class="hint">Context data is not available.</p></div>';
    var yr = seasonYear(cur);
    var fx = datedFx();
    var night = fx.filter(function (f) { var d = dParts(f.fixtureDate); return d.hh != null && d.hh >= 17; });
    var rainFx = fx.filter(function (f) { return ctxRain(dParts(f.fixtureDate).iso) >= 5; });
    var disrupt = fx.filter(function (f) { return /postpon|abandon/i.test(f.fixtureStatusDesc || ""); });
    var disruptWet = disrupt.filter(function (f) { return ctxRain(dParts(f.fixtureDate).iso) >= 5; });
    var nightHeavyLS = night.filter(function (f) { return ctxLS(dParts(f.fixtureDate).iso) >= 3; });
    var holFx = fx.filter(function (f) { return ctxHol(dParts(f.fixtureDate).iso); });
    var schFx = fx.filter(function (f) { return ctxSchool(dParts(f.fixtureDate).iso); });
    var termFx = fx.length - schFx.length;
    var ramFx = fx.filter(function (f) { return ctxRamadan(dParts(f.fixtureDate).iso); });
    var ramNight = ramFx.filter(function (f) { var d = dParts(f.fixtureDate); return d.hh != null && d.hh >= 17; });
    var nightShare = fx.length ? Math.round(night.length / fx.length * 100) : 0;
    var ramNightShare = ramFx.length ? Math.round(ramNight.length / ramFx.length * 100) : 0;

    var h = '<div class="card" style="margin-bottom:12px"><p class="hint" style="margin:0">External context overlaid on ' + yr + " " + segLabel().toLowerCase() + ' fixtures: weather, load shedding, public and religious holidays, and school terms. Every figure opens the underlying fixtures with export. These are signals, not proof of cause.</p></div>';

    // headline tiles
    h += '<div class="fa-tiles">';
    h += tile(rainFx.length.toLocaleString(), "Fixtures on wet days", "5 mm rain or more", "rainfx");
    h += tile(disrupt.length ? (disruptWet.length + " of " + disrupt.length) : "0", "Disruptions on wet days", "postponed or abandoned", "");
    h += tile(nightHeavyLS.length.toLocaleString(), "Night games in heavy LS", "17:00+ in Stage 3-4 months", "lsnight");
    h += tile(holFx.length.toLocaleString(), "Fixtures on public holidays", "extra match days", "holfx");
    h += '</div>';

    // weather card
    h += '<div class="card"><h3>Weather</h3><p class="hint" style="margin-bottom:8px">Cape Town had ' + Object.keys(CTX.rain).filter(function (k) { return k.slice(0, 4) == yr; }).length + ' disruptive rain days (5 mm+) in the ' + yr + ' season window. ' + rainFx.length + ' fixtures were scheduled on a wet day' + (disrupt.length ? ", and " + disruptWet.length + " of the " + disrupt.length + " postponements/abandonments fell on one" : "") + '.</p>';
    var wet = {}; rainFx.forEach(function (f) { var iso = dParts(f.fixtureDate).iso; wet[iso] = (wet[iso] || 0) + 1; });
    var wetRows = Object.keys(wet).map(function (iso) { return [iso, ctxRain(iso), wet[iso]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
    if (wetRows.length) {
      h += '<table><thead><tr><th>Date</th><th>Day</th><th style="text-align:right">Rain (mm)</th><th style="text-align:right">Fixtures</th></tr></thead><tbody>';
      wetRows.forEach(function (r) { var d = new Date(r[0] + "T00:00:00"); h += '<tr class="fa-click" data-drill="date:' + r[0] + '"><td>' + fmtDate(r[0]) + '</td><td>' + DOW[d.getDay()] + '</td><td style="text-align:right"><b>' + r[1].toFixed(1) + '</b></td><td style="text-align:right">' + r[2] + '</td></tr>'; });
      h += '</tbody></table>';
    } else h += '<p class="hint">No fixtures fell on a wet day in this selection.</p>';
    h += '</div>';

    // load shedding card
    var lsMonths = {}; fx.forEach(function (f) { var mk = dParts(f.fixtureDate).iso.slice(0, 7); lsMonths[mk] = ctxLS(mk + "-01"); });
    var anyLS = Object.keys(lsMonths).some(function (k) { return lsMonths[k] >= 1; });
    h += '<div class="card"><h3>Load shedding &amp; night games</h3>';
    if (anyLS) {
      h += '<p class="hint" style="margin-bottom:8px">' + night.length + ' night games (17:00 and later) this season; ' + nightHeavyLS.length + ' of them fell in a heavy load-shedding month (Stage 3-4). ' + NS.esc(CTX.meta.lsNote) + '</p>';
      h += bar("Night games in heavy LS months", nightHeavyLS.length, Math.max(night.length, 1), "gold", "lsnight");
      h += bar("All other night games", night.length - nightHeavyLS.length, Math.max(night.length, 1), "");
    } else {
      h += '<p class="hint"><b class="fa-ok">No load shedding of note</b> during the ' + yr + ' season. ' + NS.esc(CTX.meta.lsCaveat) + '</p>';
    }
    h += '</div>';

    // school + ramadan card
    h += '<div class="fa-grid2">';
    h += '<div class="card"><h3>School terms</h3><p class="hint" style="margin-bottom:8px">Fixtures in term versus school-holiday weeks. Relevant for junior football load.</p>';
    var smax = Math.max(termFx, schFx.length, 1);
    h += bar("During school terms", termFx, smax, "blue");
    h += bar("During school holidays", schFx.length, smax, "gold", "schoolfx");
    h += '<p class="hint" style="margin-top:6px">' + NS.esc(CTX.meta.schoolNote) + '</p></div>';
    h += '<div class="card"><h3>Ramadan</h3>';
    if (ramFx.length) {
      h += '<p class="hint" style="margin-bottom:8px">' + ramFx.length + ' fixtures fell within Ramadan this season. Night games were ' + ramNightShare + '% of Ramadan fixtures against ' + nightShare + '% across the season.</p>';
      h += bar("Ramadan fixtures", ramFx.length, Math.max(ramFx.length, 1), "green", "ramfx");
      h += '<p class="hint" style="margin-top:6px">' + NS.esc(CTX.meta.islamNote) + '</p>';
    } else {
      h += '<p class="hint">Ramadan fell outside this season’s fixtures (it moves ~11 days earlier each year). ' + NS.esc(CTX.meta.islamNote) + '</p>';
    }
    h += '</div></div>';

    // forward planner
    h += '<div class="card"><h3>Next-season planner &mdash; ' + FWD.y + '</h3><p class="hint" style="margin-bottom:8px">Dates and historically wet weeks to plan the ' + FWD.y + ' calendar around. Public holidays are statutory (Public Holidays Act 36 of 1994), with any Sunday holiday observed the following Monday; Western Cape school breaks are <b>projected</b> and must be confirmed against the WCED calendar; Ramadan follows the projected sighting; wet weeks are the five-year Cape Town pattern, normalised to rainfall per day.</p>';
    h += '<div class="fa-grid2"><div>';
    h += '<h4 class="fa-h4">Dates to plan around</h4><table><tbody>';
    h += '<tr><td>Ramadan <span class="kv">(projected)</span></td><td>' + fmtDate(FWD.ramadan.s) + " – " + fmtDate(FWD.ramadan.e) + ' (Eid ' + fmtDate(FWD.ramadan.eid) + ')</td></tr>';
    FWD.school.forEach(function (s) { h += '<tr><td>' + s[2] + ' <span class="kv">(projected)</span></td><td>' + fmtDate(s[0]) + " – " + fmtDate(s[1]) + '</td></tr>'; });
    FWD.hol.filter(function (x) { return x[0] >= "2027-03" && x[0] <= "2027-10"; }).forEach(function (x) { h += '<tr><td>' + x[1] + '</td><td>' + fmtDate(x[0]) + ' (' + DOW[new Date(x[0] + "T00:00:00").getDay()] + ')</td></tr>'; });
    h += '</tbody></table></div><div>';
    h += '<h4 class="fa-h4">Historically wettest weeks</h4><table><thead><tr><th>Week</th><th style="text-align:right">Rain days (5yr)</th><th style="text-align:right">mm / day</th></tr></thead><tbody>';
    wettestBuckets().slice(0, 8).forEach(function (b) { h += '<tr><td>' + b.label + '</td><td style="text-align:right">' + b.days + '</td><td style="text-align:right">' + (Math.round(b.mmPerDay * 10) / 10) + '</td></tr>'; });
    h += '</tbody></table></div></div>';
    h += '<p class="hint" style="margin-top:8px">' + FWD.y + ' public-holiday dates are statutory under the Public Holidays Act 36 of 1994 (Good Friday and Family Day follow the Easter cycle); the Western Cape school-break dates are projected and must be confirmed against the WCED calendar when released. Wet-week ranking is normalised to millimetres per calendar day, so the longer last week of a month is not overstated.</p></div>';
    return h;
  }

  /* ================= 2027 FIXTURE SCENARIO PLANNER ================= */
  var BASE_ID = 47708359;              // 2026 season = the structural base
  var plan = { start: "2027-04-03", end: "2027-10-31", usePH: true, useSun: false, useMid: true, sundayDH: false, clubGroup: true, promoRel: false, up: 2, down: 2, ko: true, koRounds: 4, koPerRound: 2, view: "table", div: "", sizes: {} };
  var PH27 = {}; FWD.hol.forEach(function (x) { PH27[x[0]] = x[1]; });
  // pitch-slot model for the venue/clash check (U07): each ground is a pitch; a match occupies
  // the pitch for MATCH_MINS, with REST_MINS turnaround, in back-to-back slots between DAY_START and DAY_END.
  var MATCH_MINS = 105, REST_MINS = 15, DAY_START = 8 * 60, DAY_END = 18 * 60;
  var _unalloc = [];   // teams that could not be seated after a resize cascade (U06 conservation)
  function mmToHHMM(min) { return min == null ? "TBC" : pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
  var CHAINS = [
    ["A1", "B1", "C1", "D1", "D2", "D3", "D4"],   // senior open: Premier -> First -> Second -> 3rd-6th
    ["A2", "B2", "C2"],                            // senior reserves
    ["E1", "E2"],                                  // Vets O35
    ["F1", "F2"],                                  // Vets O40
    ["G4", "G5", "G6"],                            // Vets O50 A/B/C (G1 = O45 A, standalone)
    ["H1", "H2"],                                  // Women's Premier -> First
    ["I1", "I2", "I3", "I4", "I5"],               // U18
    ["K1", "K2", "K3", "K4", "K5", "K6", "K8"],   // U16 open
    ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M9"], // U14 open
    ["O1", "O2", "O3", "O4", "O5", "O6", "O8"]    // U12 open
  ];
  var KO_ROUNDS = ["Round 1", "Quarter-Final", "Semi-Final", "Final"];
  function codeOf(name) { var m = (name || "").match(/^([A-Z]+)(\d+[A-Z]?)/); return m ? m[1] + m[2] : null; }

  var _base = null;
  function baseDivs() {
    if (_base) return _base;
    var data = cache[BASE_ID]; if (!data) return null;
    var byG = {};
    data.fixtures.forEach(function (f) {
      if (f.fixtureTypeID !== 1) return;
      var g = f.fixtureGroupDesc || "?";
      if (!byG[g]) byG[g] = { name: g, gid: f.fixtureGroupIdentifier, jun: isJunior(g), t: {}, fx: 0, hh: {} };
      var G = byG[g], b = isBye(f.homeTeamName) || isBye(f.roadTeamName);
      if (!b) {
        G.fx++;
        var h = f.homeTeam, a = f.roadTeam;
        [[h, f.homeTeamName], [a, f.roadTeamName]].forEach(function (p) { if (p[0] != null && !G.t[p[0]]) G.t[p[0]] = { id: p[0], name: clean(p[1]), P: 0, GF: 0, GA: 0, Pts: 0 }; });
        var dp = dParts(f.fixtureDate); if (dp && dp.hh != null) G.hh[dp.hh] = (G.hh[dp.hh] || 0) + 1;
        if (isNum(f.homeScore) && isNum(f.roadScore)) { var hs = +f.homeScore, as = +f.roadScore, H = G.t[h], A = G.t[a]; if (H && A) { H.P++; A.P++; H.GF += hs; H.GA += as; A.GF += as; A.GA += hs; if (hs > as) H.Pts += 3; else if (as > hs) A.Pts += 3; else { H.Pts++; A.Pts++; } } }
      }
    });
    _base = Object.keys(byG).map(function (g) {
      var G = byG[g], arr = Object.keys(G.t).map(function (k) { return G.t[k]; });
      arr.sort(function (a, b) { return b.Pts - a.Pts || (b.GF - b.GA) - (a.GF - a.GA) || b.GF - a.GF || a.name.localeCompare(b.name); });
      var nt = arr.length, single = nt > 1 ? nt * (nt - 1) / 2 : 0, ratio = single ? G.fx / single : 0, clean2 = ratio > 0.7 && ratio < 2.4, dbl = ratio >= 1.5;
      var modeHH = Object.keys(G.hh).sort(function (a, b) { return G.hh[b] - G.hh[a]; })[0];
      return { name: g, gid: G.gid, jun: G.jun, code: codeOf(g), std: arr.map(function (t) { return t.name; }), fx: G.fx, dbl: dbl, clean: clean2, ko: modeHH != null ? +modeHH : null };
    });
    return _base;
  }

  // effective 2027 divisions after promotion/relegation, resize-cascade and club ordering
  function planDivs() {
    var base = baseDivs(); if (!base) return null;
    var divs = base.map(function (d) { return { name: d.name, gid: d.gid, jun: d.jun, code: d.code, dbl: d.dbl, clean: d.clean, ko: d.ko, teams: d.std.slice() }; });
    var byCode = {}; divs.forEach(function (d) { if (d.code) byCode[d.code] = d; });
    if (plan.promoRel) {
      // Decide every promotion/relegation from the IMMUTABLE base standings first, then apply
      // once, so a team moves at most one division (no A->C double jumps) and none is lost.
      var relegOut = {}, promoOut = {};   // division code -> team names leaving it
      CHAINS.forEach(function (chain) {
        for (var i = 0; i < chain.length - 1; i++) {
          var up = byCode[chain[i]], dn = byCode[chain[i + 1]]; if (!up || !dn) continue;
          var nDown = Math.min(plan.down, Math.max(0, up.teams.length - 1));
          var nUp = Math.min(plan.up, Math.max(0, dn.teams.length - 1));
          relegOut[up.code] = up.teams.slice(up.teams.length - nDown);   // bottom nDown of the higher division
          promoOut[dn.code] = dn.teams.slice(0, nUp);                    // top nUp of the lower division
        }
      });
      CHAINS.forEach(function (chain) {
        for (var i = 0; i < chain.length; i++) {
          var dv = byCode[chain[i]]; if (!dv) continue;
          var leaving = {}; (relegOut[dv.code] || []).concat(promoOut[dv.code] || []).forEach(function (n) { leaving[n] = 1; });
          var kept = dv.teams.filter(function (n) { return !leaving[n]; });
          var comingUp = (i < chain.length - 1) ? (promoOut[chain[i + 1]] || []) : [];   // promoted from the division below
          var comingDown = (i > 0) ? (relegOut[chain[i - 1]] || []) : [];                // relegated from the division above
          dv.teams = comingUp.concat(kept, comingDown);
        }
      });
    }
    // resize with cascade down the chain; conserve every team — overflow past the last division is listed, never dropped
    _unalloc = [];
    CHAINS.forEach(function (chain) {
      for (var i = 0; i < chain.length; i++) {
        var dv = byCode[chain[i]]; if (!dv) continue; var target = plan.sizes[dv.gid];
        if (!target || target >= dv.teams.length) continue;
        var overflow = dv.teams.splice(target); var below = byCode[chain[i + 1]];
        if (below) below.teams = below.teams.concat(overflow);
        else overflow.forEach(function (n) { _unalloc.push({ team: n, from: dv.name }); });
      }
    });
    if (plan.clubGroup) divs.forEach(function (d) { if (d.jun) d.teams = d.teams.slice().sort(function (a, b) { return clubOf(a).localeCompare(clubOf(b)) || a.localeCompare(b); }); });
    divs.forEach(function (d) { d.nt = d.teams.length; var md = d.nt % 2 === 0 ? Math.max(0, d.nt - 1) : d.nt; d.matchdays = d.dbl ? md * 2 : md; d.fx = d.dbl ? d.nt * (d.nt - 1) : d.nt * (d.nt - 1) / 2; });
    divs.sort(function (a, b) { return b.matchdays - a.matchdays || b.nt - a.nt; });
    return divs;
  }

  function roundRobin(teams, dbl) {
    var t = teams.slice(); if (t.length % 2) t.push("Bye");
    var n = t.length, rounds = [];
    for (var r = 0; r < n - 1; r++) {
      var pairs = [];
      for (var i = 0; i < n / 2; i++) {
        var home = t[i], away = t[n - 1 - i];
        if (r % 2 && i === 0) { var tmp = home; home = away; away = tmp; }
        if (home !== "Bye" && away !== "Bye") pairs.push([home, away]);
      }
      rounds.push(pairs);
      t.splice(1, 0, t.pop());
    }
    if (dbl) rounds = rounds.concat(rounds.map(function (rp) { return rp.map(function (p) { return [p[1], p[0]]; }); }));
    return rounds;
  }

  // most-common 2026 home venue per cleaned team name (a team keeps its ground)
  var _vn = null;
  function venueOfName() {
    if (_vn) return _vn;
    var data = cache[BASE_ID], agg = {};
    if (data) data.fixtures.forEach(function (f) { if (f.fixtureTypeID !== 1 || isBye(f.homeTeamName)) return; var nm = clean(f.homeTeamName), v = f.venueAndSubVenueDesc || ""; if (!nm || !v) return; (agg[nm] = agg[nm] || {})[v] = (agg[nm][v] || 0) + 1; });
    _vn = {}; Object.keys(agg).forEach(function (nm) { var best = "", bn = 0; Object.keys(agg[nm]).forEach(function (v) { if (agg[nm][v] > bn) { bn = agg[nm][v]; best = v; } }); _vn[nm] = best; });
    return _vn;
  }
  // build the full generated schedule and seat each home fixture in a real pitch slot (U07):
  // one ground = one pitch; a match holds the pitch for MATCH_MINS + REST_MINS, in back-to-back
  // slots between DAY_START and DAY_END. A fixture whose division kick-off cannot be honoured is
  // pushed to the next free slot ("moved"), or left "unplaced" if the pitch-day is full.
  function buildSchedule() {
    var divs = planDivs(), maxMd = Math.max.apply(null, divs.map(function (x) { return x.matchdays; }));
    var sd = seasonDates(plan, maxMd), vn = venueOfName(), all = [];
    divs.forEach(function (d) {
      if (!d.clean || d.nt < 2) return;
      var rounds = roundRobin(d.teams, d.dbl), koMin = d.ko != null ? d.ko * 60 : null;
      rounds.forEach(function (rp, ri) { var dt = sd.all[ri] ? sd.all[ri].iso : null; if (!dt) return; rp.forEach(function (p) { all.push({ date: dt, div: d.name, home: p[0], away: p[1], venue: vn[p[0]] || "", koWant: koMin }); }); });
    });
    var by = {}; all.forEach(function (x) { if (!x.venue) { x.status = "novenue"; x.koGot = null; return; } (by[x.date + "|" + x.venue] = by[x.date + "|" + x.venue] || []).push(x); });
    Object.keys(by).forEach(function (k) {
      var list = by[k].slice().sort(function (a, b) { return (a.koWant == null ? DAY_START : a.koWant) - (b.koWant == null ? DAY_START : b.koWant); });
      var cursor = DAY_START;
      list.forEach(function (x) {
        var want = x.koWant == null ? DAY_START : x.koWant, start = Math.max(want, cursor);
        if (start + MATCH_MINS <= DAY_END) { x.koGot = start; x.status = (x.koWant != null && start > x.koWant) ? "moved" : "ok"; cursor = start + MATCH_MINS + REST_MINS; }
        else { x.koGot = null; x.status = "unplaced"; }
      });
    });
    return { fx: all, sd: sd, divs: divs };
  }
  function clashReport() {
    var s = buildSchedule(), moved = [], unplaced = [], placed = 0, withVenue = 0, pd = {};
    s.fx.forEach(function (x) {
      if (x.status === "novenue") return;
      withVenue++; pd[x.date + "|" + x.venue] = (pd[x.date + "|" + x.venue] || 0) + 1;
      if (x.status === "unplaced") unplaced.push(x); else { placed++; if (x.status === "moved") moved.push(x); }
    });
    var busy = Object.keys(pd).filter(function (k) { return pd[k] > 1; }).length;
    return { moved: moved, unplaced: unplaced, placed: placed, withVenue: withVenue, conflicts: moved.length + unplaced.length, busyPitchDays: busy, total: s.fx.length, schedule: s };
  }
  // named scenarios in browser storage
  var SC_KEY = "cttlfa_plan27_scenarios";
  function scLoadAll() { try { return JSON.parse(localStorage.getItem(SC_KEY) || "{}"); } catch (e) { return {}; } }
  function scSave(name) { try { var all = scLoadAll(); all[name] = JSON.parse(JSON.stringify(plan)); localStorage.setItem(SC_KEY, JSON.stringify(all)); return true; } catch (e) { return false; } }
  function scApply(name) { var all = scLoadAll(), s = all[name]; if (!s) return false; Object.keys(s).forEach(function (k) { plan[k] = s[k]; }); return true; }
  function scDelete(name) { try { var all = scLoadAll(); delete all[name]; localStorage.setItem(SC_KEY, JSON.stringify(all)); return true; } catch (e) { return false; } }

  function pWk(iso) { var m = +iso.slice(5, 7), d = +iso.slice(8, 10); return m + "|" + Math.min(3, Math.floor((d - 1) / 7)); }
  function rainRisk() { var b = {}; if (CTX) Object.keys(CTX.rain).forEach(function (iso) { var k = pWk(iso); b[k] = (b[k] || 0) + CTX.rain[iso]; }); return b; }
  function seasonDates(p, needMd) {
    var d = new Date(p.start + "T00:00:00"), e = new Date(p.end + "T00:00:00");
    var sat = [], ph = [], sun = [], mid = [];
    for (; d <= e; d.setDate(d.getDate() + 1)) {
      var iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), wd = d.getDay();
      if (wd === 6) sat.push(iso);
      else if (PH27[iso]) ph.push(iso);
      else if (wd === 0) sun.push(iso);
      else if (wd === 3) mid.push(iso);
    }
    // knockout weekends: reserve Saturdays at the actual 2026 cup cadence. In 2026
    // the cup-heavy Saturdays fell at ~23% (mid-May), ~47% (late June), ~71%
    // (early August) and ~96% (late September) of the season. Each round takes
    // koPerRound Saturdays, matching how 2026 ran two weekends per round.
    var koSats = [], koIdx = {};
    if (p.ko && sat.length) {
      var rounds = Math.min(p.koRounds || 4, KO_ROUNDS.length), per = Math.max(1, p.koPerRound || 2);
      var fr = [0.24, 0.47, 0.71, 0.96];
      for (var r = 0; r < rounds; r++) {
        var center = fr[r] != null ? fr[r] : (r + 0.7) / rounds;
        var start = Math.min(sat.length - 1, Math.max(0, Math.round(center * sat.length) - Math.floor(per / 2)));
        for (var k = 0; k < per; k++) { var ix = start + k; while (ix < sat.length && koIdx[ix]) ix++; if (ix < sat.length) { koIdx[ix] = 1; koSats.push({ iso: sat[ix], round: KO_ROUNDS[r] }); } }
      }
      koSats.sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
    }
    var leagueSat = sat.filter(function (x, i) { return !koIdx[i]; });
    function byIso(a, b) { return a.iso < b.iso ? -1 : 1; }
    var pool = [];
    if (p.usePH) pool = pool.concat(ph.map(function (x) { return { iso: x, type: "Hol" }; }).sort(byIso));
    if (p.useSun) { var ss = sun.map(function (x) { return { iso: x, type: "Sun" }; }).sort(byIso); pool = pool.concat(ss); if (p.sundayDH) pool = pool.concat(ss.map(function (x) { return { iso: x.iso, type: "Sun 2nd" }; })); }
    if (p.useMid) pool = pool.concat(mid.map(function (x) { return { iso: x, type: "Mid" }; }).sort(byIso));
    var shortfall = Math.max(0, (needMd || leagueSat.length) - leagueSat.length);
    var overflow = pool.slice(0, shortfall);
    var seq = leagueSat.map(function (x) { return { iso: x, type: "Sat" }; }).concat(overflow).sort(function (a, b) { return a.iso < b.iso ? -1 : (a.iso > b.iso ? 1 : 0); });
    return { all: seq, sat: leagueSat, allSat: sat, ph: ph, sun: sun, mid: mid, overflow: overflow, shortfall: shortfall, canFit: overflow.length >= shortfall, koSats: koSats };
  }
  function ctxSchoolFwd(iso) { for (var i = 0; i < FWD.school.length; i++) { if (iso >= FWD.school[i][0] && iso <= FWD.school[i][1]) return FWD.school[i][2]; } return null; }

  function ck(id, on, label) { return '<label class="fa-ck"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + '> ' + label + '</label>'; }
  function repaintPlan() {
    var root = NS.$("planner27Root"); if (!root) return;
    if (!cache[BASE_ID]) { root.innerHTML = '<div class="card"><p class="hint">Loading the 2026 structure to model 2027…</p></div>'; loadSeason(BASE_ID).then(function () { repaintPlan(); }); return; }
    root.innerHTML = renderPlannerBody();
    bindPlanner();
  }
  function renderPlannerBody() {
    var divs = planDivs();
    var maxMd = Math.max.apply(null, divs.map(function (d) { return d.matchdays; }));
    var sd = seasonDates(plan, maxMd);
    var risk = rainRisk();
    var riskVals = Object.keys(risk).map(function (k) { return risk[k]; }).sort(function (a, b) { return a - b; });
    var t1 = riskVals[Math.floor(riskVals.length / 3)] || 30, t2 = riskVals[Math.floor(riskVals.length * 2 / 3)] || 60;
    function dayRisk(iso) { var v = risk[pWk(iso)] || 0; return v >= t2 ? 3 : v >= t1 ? 2 : v > 0 ? 1 : 0; }
    var RISKW = ["low", "low-moderate", "moderate", "high"];
    var totFx = divs.reduce(function (s, d) { return s + d.fx; }, 0);
    var totTeams = divs.reduce(function (s, d) { return s + d.nt; }, 0);
    var satN = sd.sat.length, playN = sd.all.length, shortfall = sd.shortfall;
    var jr = divs.filter(function (d) { return d.jun; }), sr = divs.filter(function (d) { return !d.jun; });
    function loadOnDate(k) { var n = 0; divs.forEach(function (d) { if (d.matchdays >= k) n += Math.floor(d.nt / 2); }); return n; }

    var h = '';
    h += '<div class="card" style="margin-bottom:12px"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><h3 style="margin:0 0 4px">2027 Season Planner</h3><p class="hint" style="margin:0;max-width:82ch"><b>Assumption:</b> models 2027 on the <b>2026 league structure</b> (' + divs.length + ' divisions, ' + totTeams + ' team entries). A planning scenario to shape and draft the season, not a confirmed fixture list; entries, promotions and venues will change it. LeagueRepublic stays the system of record.</p></div><a class="btn ghost sm" href="https://a.leaguerepublic.com/myaccount/login/index.html" target="_blank" rel="noopener" title="Sign in to LeagueRepublic administration to enter the finalised fixtures.">LR admin login</a></div></div>';

    // controls
    h += '<div class="card" style="margin-bottom:12px"><div class="fa-planctl">' +
      '<label>Season start <input type="date" id="pStart" value="' + plan.start + '"></label>' +
      '<label>Season end <input type="date" id="pEnd" value="' + plan.end + '"></label>' +
      ck("pPH", plan.usePH, "Public holidays") + ck("pSun", plan.useSun, "Sundays") + ck("pMid", plan.useMid, "Midweek (Wed)") + ck("pDH", plan.sundayDH, "Sunday double-headers") +
      '</div><div class="fa-planctl" style="margin-top:8px">' +
      ck("pClub", plan.clubGroup, "Club-grouped juniors (age groups play together)") +
      ck("pPR", plan.promoRel, "Apply promotion / relegation") +
      '<label>Up <input type="number" id="pUp" value="' + plan.up + '" min="0" max="4" style="width:52px"></label>' +
      '<label>Down <input type="number" id="pDn" value="' + plan.down + '" min="0" max="4" style="width:52px"></label>' +
      '<span class="fa-segs"><button class="fa-seg' + (plan.view === "table" ? " on" : "") + '" data-view="table">Table view</button><button class="fa-seg' + (plan.view === "calendar" ? " on" : "") + '" data-view="calendar">Calendar view</button></span>' +
      '</div><div class="fa-planctl" style="margin-top:8px">' +
      ck("pKO", plan.ko, "Reserve knockout weekends") +
      '<label>KO rounds <input type="number" id="pKOr" value="' + plan.koRounds + '" min="1" max="4" style="width:52px"></label>' +
      '<label>Saturdays each <input type="number" id="pKOp" value="' + plan.koPerRound + '" min="1" max="3" style="width:52px"></label>' +
      '<span class="fa-plan-scn"><label>Scenario <input type="text" id="pScName" placeholder="name this scenario" style="width:170px"></label><button class="btn gold sm" id="pScSave">Save</button><select id="pScSel" class="fa-select" style="max-width:200px"></select><button class="btn ghost sm" id="pScLoad">Load</button><button class="btn ghost sm" id="pScDel">Delete</button></span>' +
      '</div><p class="hint" style="margin:8px 0 0">Adjust anything and the model recomputes. Knockout weekends follow the actual 2026 cup cadence — Round 1 in mid-May, Quarter-Finals in late June, Semi-Finals in early August, Finals in late September — and are taken out of the league Saturdays. Promotion/relegation and club-grouping are provisional and do not change the season size.</p></div>';

    // capacity tiles
    h += '<div class="fa-tiles">';
    h += tile(satN, "League Saturdays", sd.allSat.length + " total less " + sd.koSats.length + " knockout", "");
    h += tile(sd.koSats.length, "Knockout weekends", plan.ko ? (plan.koRounds + " rounds x " + plan.koPerRound + " Sat") : "off", "");
    h += tile(maxMd, "Rounds needed (max)", "biggest division (" + divs.filter(function (d) { return d.matchdays === maxMd; })[0].nt + " teams)", "");
    h += tile(shortfall, "Saturday shortfall", shortfall ? "rounds off Saturday" : "within league Saturdays", "");
    h += '</div>';
    h += '<div class="fa-tiles">';
    h += tile(totFx.toLocaleString(), "League fixtures", divs.length + " divisions", "");
    h += tile(playN, "Match rounds scheduled", satN + " on Saturdays" + (sd.overflow.length ? " + " + sd.overflow.length + " overflow" : ""), "");
    h += tile(Math.round(totFx / Math.max(satN, 1)), "Avg fixtures / Saturday", "if spread evenly (2026 peaked ~212)", "");
    h += tile(jr.length + " / " + sr.length, "Junior / senior divisions", "max rounds " + Math.max.apply(null, jr.map(function (d) { return d.matchdays; })) + " / " + Math.max.apply(null, sr.map(function (d) { return d.matchdays; })), "");
    h += '</div>';

    // verdict
    h += '<div class="card"><h3>Season date capacity</h3><p class="hint" style="margin-bottom:6px">';
    if (shortfall === 0) h += '<b class="fa-ok">Yes on Saturdays.</b> The biggest divisions need ' + maxMd + ' rounds and there are ' + satN + ' Saturdays, so every division runs on Saturdays with ' + (satN - maxMd) + ' week(s) of weather buffer.';
    else if (sd.canFit) h += '<b class="fa-ok">Yes, with ' + sd.overflow.length + ' non-Saturday round(s).</b> The ' + maxMd + '-round divisions are ' + shortfall + ' short of the ' + satN + ' Saturdays, absorbed by ' + sd.overflow.map(function (x) { return fmtDate(x.iso) + " (" + x.type + ")"; }).join(", ") + '. Smaller divisions finish inside the Saturdays.';
    else h += '<b class="fa-warn">Does not fit.</b> The ' + maxMd + '-round divisions are ' + shortfall + ' rounds short of the ' + satN + ' Saturdays and the enabled overflow dates cover only ' + sd.overflow.length + '. Extend the end date or enable public holidays / Sundays (with double-headers) / midweek.';
    if (plan.ko && sd.koSats.length) h += ' <b>' + sd.koSats.length + ' Saturdays are reserved for knockouts</b> (' + sd.koSats.map(function (x) { return x.round; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ") + '), which is why only ' + satN + ' of the ' + sd.allSat.length + ' Saturdays carry league rounds.';
    h += ' A full round is ~' + Math.round(totTeams / 2) + ' fixtures, above the 2026 Saturday peak of ~212, so the age-group time ladder and byes spread it. This measures dates only, which is necessary but not sufficient: whether every fixture physically fits also depends on pitches and kick-off times, checked in the venue &amp; pitch-slot card below, where any fixture that cannot be seated is listed.</p>';
    h += bar("Rounds needed (biggest)", maxMd, Math.max(maxMd, satN), "gold");
    h += bar("League Saturdays", satN, Math.max(maxMd, satN), "blue");
    if (plan.ko && sd.koSats.length) h += bar("Knockout Saturdays", sd.koSats.length, Math.max(maxMd, satN), "green");
    h += '</div>';

    // knockout lookup for the calendar
    var koByIso = {}; sd.koSats.forEach(function (x) { koByIso[x.iso] = x.round; });
    var koAbbr = { "Round 1": "KO1", "Quarter-Final": "QF", "Semi-Final": "SF", "Final": "FIN" };
    // season calendar OR month-grid
    if (plan.view === "calendar") {
      h += '<div class="card"><h3>Proposed season calendar</h3><p class="hint" style="margin-bottom:10px">Each match round on its date. Shaded by five-year Cape Town weather risk; H = public holiday; green cells are knockout weekends.</p><div class="fa-cal">';
      var months = {}; sd.all.forEach(function (dt, i) { var ym = dt.iso.slice(0, 7); (months[ym] = months[ym] || []).push({ dt: dt, round: i + 1 }); });
      sd.koSats.forEach(function (x) { var ym = x.iso.slice(0, 7); (months[ym] = months[ym] || []); });
      var byIsoRound = {}; sd.all.forEach(function (dt, i) { byIsoRound[dt.iso] = i + 1; });
      Object.keys(months).sort().forEach(function (ym) {
        var y = +ym.slice(0, 4), m = +ym.slice(5, 7), first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
        h += '<div class="fa-mon"><div class="fa-mon-h">' + MON[m - 1] + " " + y + '</div><div class="fa-week">';
        ["S", "M", "T", "W", "T", "F", "S"].forEach(function (x) { h += '<span class="fa-wd">' + x + '</span>'; });
        for (var i = 0; i < first.getDay(); i++) h += '<span class="fa-day empty"></span>';
        for (var dd = 1; dd <= days; dd++) {
          var iso = y + "-" + pad(m) + "-" + pad(dd), dow = new Date(y, m - 1, dd).getDay(), rn = byIsoRound[iso], koR = koByIso[iso], hol = PH27[iso];
          if (koR) h += '<span class="fa-day has ko' + (dow === 6 ? " sat" : "") + '" title="Knockout — ' + koR + " — " + fmtDate(iso) + '">' + dd + '<i>' + koAbbr[koR] + '</i></span>';
          else if (rn) { var r = dayRisk(iso); h += '<span class="fa-day has r' + r + (dow === 6 ? " sat" : "") + '" title="Round ' + rn + " — " + fmtDate(iso) + " — " + RISKW[r] + ' weather risk' + (hol ? " — " + hol : "") + '">' + dd + '<i>R' + rn + '</i>' + (hol ? '<em class="fa-mh"></em>' : "") + '</span>'; }
          else h += '<span class="fa-day' + (dow === 6 ? " sat" : "") + '">' + dd + '</span>';
        }
        h += '</div></div>';
      });
      h += '</div><p class="hint" style="margin-top:8px">R = league round; KO1/QF/SF/FIN = knockout weekends. Darker cells are historically wetter weeks; a gold dot marks a public holiday used as a match day.</p></div>';
    } else {
      h += '<div class="card"><h3>Proposed season calendar</h3><p class="hint" style="margin-bottom:8px">Each playable date carries a league round; knockout weekends are shown in green. Weather risk is the five-year Cape Town wet-week pattern; overflow rounds fall on the public holidays / Sundays / midweek shown.</p>';
      h += '<table><thead><tr><th>Date</th><th>Type</th><th>Round</th><th style="text-align:right">~Fixtures</th><th>Weather risk</th><th>Notes</th></tr></thead><tbody>';
      var merged = sd.all.map(function (dt, i) { return { iso: dt.iso, type: dt.type, round: "Round " + (i + 1), load: loadOnDate(i + 1) }; }).concat(sd.koSats.map(function (x) { return { iso: x.iso, type: "Cup", round: x.round, ko: true }; }));
      merged.sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
      merged.forEach(function (row) {
        var r = dayRisk(row.iso), note = [];
        if (PH27[row.iso]) note.push(PH27[row.iso]);
        if (ctxSchoolFwd(row.iso)) note.push("school holiday");
        h += '<tr' + (row.ko ? ' style="background:#eef7f0"' : '') + '><td>' + fmtDate(row.iso) + " (" + DOW[new Date(row.iso + "T00:00:00").getDay()].slice(0, 3) + ')</td><td><span class="' + (row.ko ? "fa-ok" : (row.type === "Sat" ? "" : "fa-warn")) + '">' + row.type + '</span></td><td>' + (row.ko ? "<b>Knockout — " + row.round + "</b>" : row.round) + '</td><td style="text-align:right">' + (row.ko ? "—" : row.load.toLocaleString()) + '</td><td><span class="fa-risk r' + r + '">' + RISKW[r] + '</span></td><td>' + NS.esc(note.join(" · ")) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }

    // venue & pitch-slot check
    var cr = clashReport();
    h += '<div class="card"><h3>Venue &amp; pitch slots</h3><p class="hint" style="margin-bottom:8px">Each home fixture is seated at the home team’s 2026 ground, treated as one pitch. A match holds the pitch for ' + MATCH_MINS + ' minutes with a ' + REST_MINS + '-minute turnaround, in back-to-back slots from ' + mmToHHMM(DAY_START) + ' to ' + mmToHHMM(DAY_END) + '. A fixture whose division kick-off falls in a slot already taken is pushed to the next free slot (<b>moved</b>); if the pitch has no slot left that day it is <b>unplaced</b> and must move to another pitch or date in LeagueRepublic.</p>';
    h += '<div class="fa-tiles fa-tiles-sm">' + tile(cr.placed.toLocaleString(), "Fixtures seated", cr.moved.length ? (cr.moved.length + " with kick-off moved") : "all at their division kick-off", cr.conflicts ? "planClash" : "") + tile(cr.unplaced.length.toLocaleString(), "Unplaced", cr.unplaced.length ? "no pitch slot — must move" : "every fixture has a slot", cr.unplaced.length ? "planClash" : "") + '</div>';
    if (cr.conflicts) {
      var sample = cr.unplaced.concat(cr.moved).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 20);
      h += '<table><thead><tr><th>Date</th><th>Venue (pitch)</th><th>Division</th><th>Home</th><th>Away</th><th>Wanted</th><th>Seated</th></tr></thead><tbody>';
      sample.forEach(function (x) { h += '<tr><td>' + fmtDate(x.date) + '</td><td>' + NS.esc(x.venue) + '</td><td>' + NS.esc(x.div) + '</td><td>' + NS.esc(x.home) + '</td><td>' + NS.esc(x.away) + '</td><td>' + mmToHHMM(x.koWant) + '</td><td>' + (x.status === "unplaced" ? '<b class="fa-warn">no slot</b>' : mmToHHMM(x.koGot)) + '</td></tr>'; });
      h += '</tbody></table>' + (cr.conflicts > 20 ? '<p class="hint" style="margin-top:6px">Showing 20 of ' + cr.conflicts + ' fixtures that were moved or could not be seated; open the drill-down for the full list and CSV.</p>' : '') + '</div>';
    } else {
      h += '<p class="hint"><b class="fa-ok">Every fixture seats at its division kick-off.</b> No pitch is over-booked in this scenario.</p></div>';
    }

    // per-division demand with editable sizes
    h += '<div class="card"><h3>Fixture demand by division</h3><p class="hint" style="margin-bottom:8px">Rounds and fixtures at the scenario sizes. <b>Edit the Teams number</b> to resize a division — overflow teams cascade into the division below on the ladder. Sorted by rounds.</p>';
    h += '<table><thead><tr><th>Division</th><th style="text-align:right">Teams</th><th style="text-align:right">Rounds</th><th style="text-align:right">Fixtures</th><th>Within Saturdays?</th></tr></thead><tbody>';
    divs.forEach(function (d) {
      var fits = d.matchdays <= satN, editable = !!d.code;
      h += '<tr><td>' + NS.esc(d.name) + '</td><td style="text-align:right">' + (editable ? '<input type="number" class="fa-szin" data-gid="' + d.gid + '" value="' + d.nt + '" min="2" max="20">' : d.nt) + '</td><td style="text-align:right">' + d.matchdays + '</td><td style="text-align:right">' + d.fx + '</td><td>' + (fits ? '<span class="fa-ok">Yes</span>' : '<b class="fa-warn">+' + (d.matchdays - satN) + ' off-Sat</b>') + '</td></tr>';
    });
    h += '</tbody></table>';
    if (_unalloc.length) h += '<p class="hint" style="margin-top:6px;color:#9A3130"><b>' + _unalloc.length + ' team(s) could not be seated</b> after resizing: ' + _unalloc.map(function (u) { return NS.esc(u.team) + ' (from ' + NS.esc(u.from) + ')'; }).join(', ') + '. The last division on that ladder is full — raise a size or add a division so no team is dropped.</p>';
    h += '<p class="hint" style="margin-top:6px">Editing sizes only cascades within the senior (A–D), reserve (A2–C2) and junior age-group ladders. Vets and Women’s are standalone; every team removed by a resize is carried into the division below or listed above, never dropped.</p></div>';

    // proposed fixtures for a chosen division
    h += '<div class="card"><h3>Proposed fixture list</h3><p class="hint" style="margin-bottom:8px">Generated round-robin at the scenario line-up, mapped onto the season dates. With club-grouping on, junior age groups are ordered by club so a club’s teams meet the same opponent on the same day. Home/away alternates; venues and exact kick-offs stay a LeagueRepublic step.</p>';
    h += '<label class="fa-divlbl">Division <select id="pDiv" class="fa-select">' + divs.map(function (d) { return '<option value="' + d.gid + '"' + (String(d.gid) === plan.div ? " selected" : "") + '>' + NS.esc(d.name) + " (" + d.nt + " teams)</option>"; }).join("") + '</select></label>';
    h += '<div class="fa-mbtns" style="margin:8px 0"><button class="btn ghost sm" id="pCsvAll">Download full 2027 draft (CSV)</button><button class="btn gold sm" id="pPdfDiv">Download this division (PDF)</button></div>';
    h += '<div id="pFix" class="fa-pfix"></div></div>';
    return h;
  }

  function planFixturesFor(gid) {
    var divs = planDivs(); var d = divs.filter(function (x) { return String(x.gid) === String(gid); })[0]; if (!d) return null;
    var maxMd = Math.max.apply(null, divs.map(function (x) { return x.matchdays; }));
    var sd = seasonDates(plan, maxMd);
    var rounds = d.clean && d.nt > 1 ? roundRobin(d.teams, d.dbl) : null;
    var ko = d.ko != null ? pad(d.ko) + ":00" : "TBC";
    return { div: d, rounds: rounds, dates: sd.all, ko: ko };
  }
  function renderPlanFix(gid) {
    var el = NS.$("pFix"); if (!el) return;
    var pf = planFixturesFor(gid); if (!pf) { el.innerHTML = ""; return; }
    var d = pf.div;
    if (!pf.rounds) { el.innerHTML = '<p class="hint">' + NS.esc(d.name) + ' has an irregular 2026 structure (combined mini-groups), so a clean round-robin is not modelled. It carries about ' + d.fx + ' fixtures; plan it directly in LeagueRepublic.</p>'; return; }
    var vn = venueOfName();
    var h = '<p class="hint" style="margin:6px 0 8px"><b>' + NS.esc(d.name) + '</b> — ' + d.nt + ' teams, ' + pf.rounds.length + ' rounds, ' + pf.rounds.reduce(function (s, r) { return s + r.length; }, 0) + ' fixtures. Suggested kick-off ' + pf.ko + ' (2026 pattern). Venue is the home team’s most-used 2026 ground.</p>';
    h += '<table><thead><tr><th>Round</th><th>Date</th><th>Home</th><th>Away</th><th>Venue</th><th>KO</th></tr></thead><tbody>';
    pf.rounds.forEach(function (rp, ri) {
      var dt = pf.dates[ri] ? fmtDate(pf.dates[ri].iso) : "overflow";
      rp.forEach(function (p, pi) { h += '<tr><td>' + (pi === 0 ? "R" + (ri + 1) : "") + '</td><td>' + (pi === 0 ? dt : "") + '</td><td>' + NS.esc(p[0]) + '</td><td>' + NS.esc(p[1]) + '</td><td>' + NS.esc(vn[p[0]] || "—") + '</td><td>' + pf.ko + '</td></tr>'; });
    });
    h += '</tbody></table>';
    el.innerHTML = h;
  }
  function exportPlanCSV() {
    var divs = planDivs(); var maxMd = Math.max.apply(null, divs.map(function (x) { return x.matchdays; }));
    var sd = seasonDates(plan, maxMd);
    var vn = venueOfName();
    var esc = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = ["Division,Round,Date,Home,Away,Venue,KO"];
    divs.forEach(function (d) {
      if (!d.clean || d.nt < 2) { lines.push(esc(d.name) + ",,,irregular structure — plan in LeagueRepublic,,,"); return; }
      var rounds = roundRobin(d.teams, d.dbl), ko = d.ko != null ? pad(d.ko) + ":00" : "TBC";
      rounds.forEach(function (rp, ri) { var dt = sd.all[ri] ? sd.all[ri].iso : "overflow"; rp.forEach(function (p) { lines.push([esc(d.name), "R" + (ri + 1), dt, esc(p[0]), esc(p[1]), esc(vn[p[0]] || ""), ko].join(",")); }); });
    });
    var meta = "CTTLFA 2027 fixture scenario (draft) — assumes 2026 league structure\nSeason," + plan.start + " to " + plan.end + ",Promotion/relegation," + (plan.promoRel ? plan.up + " up / " + plan.down + " down" : "off") + ",Club-grouped juniors," + (plan.clubGroup ? "yes" : "no") + ",Knockout weekends," + (plan.ko ? (plan.koRounds + " rounds x " + plan.koPerRound + " Sat = " + sd.koSats.length + " reserved") : "off") + "\nVenue is the home team's most-used 2026 ground; exact pitch and kick-off are set in LeagueRepublic. Generated," + new Date().toLocaleString("en-ZA") + ". Not a confirmed fixture list; LeagueRepublic is the system of record.\n\n";
    var blob = new Blob([meta + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "CTTLFA 2027 fixture scenario draft.csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }
  function exportPlanDivPDF(gid) {
    if (!window.jspdf) { alert("PDF library still loading, try again."); return; }
    var pf = planFixturesFor(gid); if (!pf || !pf.rounds) { alert("This division has an irregular structure and is not modelled."); return; }
    var d = pf.div, doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    faPdfHead(doc, "2027 draft fixtures — " + d.name);
    var vn = venueOfName(), body = [];
    pf.rounds.forEach(function (rp, ri) { var dt = pf.dates[ri] ? fmtDate(pf.dates[ri].iso) : "overflow"; rp.forEach(function (p, pi) { body.push([pi === 0 ? "R" + (ri + 1) : "", pi === 0 ? dt : "", p[0], p[1], vn[p[0]] || "—", pf.ko]); }); });
    doc.autoTable({ startY: 122, head: [["Round", "Date", "Home", "Away", "Venue", "KO"]], body: body, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [24, 64, 80], textColor: 255 }, alternateRowStyles: { fillColor: [244, 246, 251] } });
    var y = doc.lastAutoTable.finalY + 16; if (y > 760) { doc.addPage(); y = 40; }
    doc.setFontSize(9); doc.setTextColor(90, 101, 119); doc.setFont("helvetica", "normal");
    doc.text("Draft scenario. Not a confirmed fixture list; venues and exact kick-offs are set in LeagueRepublic.", 40, y);
    doc.save("CTTLFA 2027 draft " + d.name.replace(/[^A-Za-z0-9 ]+/g, "") + ".pdf");
  }
  function bindPlanner() {
    var root = NS.$("planner27Root"); if (!root) return;
    function chg(id, key, isNum2) { var el = NS.$(id); if (el) el.addEventListener("change", function () { plan[key] = isNum2 ? (+el.value || 0) : el.value; repaintPlan(); }); }
    function chk(id, key) { var el = NS.$(id); if (el) el.addEventListener("change", function () { plan[key] = el.checked; repaintPlan(); }); }
    chg("pStart", "start"); chg("pEnd", "end"); chg("pUp", "up", true); chg("pDn", "down", true);
    chk("pPH", "usePH"); chk("pSun", "useSun"); chk("pMid", "useMid"); chk("pDH", "sundayDH"); chk("pClub", "clubGroup"); chk("pPR", "promoRel");
    chk("pKO", "ko"); chg("pKOr", "koRounds", true); chg("pKOp", "koPerRound", true);
    Array.prototype.forEach.call(root.querySelectorAll(".fa-seg[data-view]"), function (b) { b.addEventListener("click", function () { plan.view = b.getAttribute("data-view"); repaintPlan(); }); });
    Array.prototype.forEach.call(root.querySelectorAll(".fa-szin"), function (inp) { inp.addEventListener("change", function () { var v = +inp.value || 0, gid = inp.getAttribute("data-gid"); if (v >= 2) plan.sizes[gid] = v; else delete plan.sizes[gid]; repaintPlan(); }); });
    var dv = NS.$("pDiv"); if (dv) { if (!plan.div || !dv.querySelector('option[value="' + plan.div + '"]')) plan.div = dv.value; renderPlanFix(plan.div); dv.addEventListener("change", function () { plan.div = dv.value; renderPlanFix(dv.value); }); }
    var ca = NS.$("pCsvAll"); if (ca) ca.addEventListener("click", exportPlanCSV);
    var pd = NS.$("pPdfDiv"); if (pd) pd.addEventListener("click", function () { exportPlanDivPDF(plan.div || (dv && dv.value)); });
    // scenarios: populate the picker, wire save / load / delete
    var sel = NS.$("pScSel"); if (sel) { var all = scLoadAll(), names = Object.keys(all).sort(); sel.innerHTML = '<option value="">' + (names.length ? "saved scenarios…" : "no saved scenarios") + '</option>' + names.map(function (n) { return '<option value="' + NS.esc(n) + '">' + NS.esc(n) + '</option>'; }).join(""); }
    var sv = NS.$("pScSave"); if (sv) sv.addEventListener("click", function () { var nm = NS.$("pScName"); var name = nm ? (nm.value || "").trim() : ""; if (!name) { alert("Give the scenario a name first."); return; } if (!scSave(name)) { alert("This browser blocked local storage, so the scenario could not be saved."); return; } if (nm) nm.value = ""; repaintPlan(); });
    var ld = NS.$("pScLoad"); if (ld) ld.addEventListener("click", function () { var s = NS.$("pScSel"); var name = s ? s.value : ""; if (!name) { alert("Pick a saved scenario to load."); return; } if (scApply(name)) repaintPlan(); });
    var del = NS.$("pScDel"); if (del) del.addEventListener("click", function () { var s = NS.$("pScSel"); var name = s ? s.value : ""; if (!name) { alert("Pick a saved scenario to delete."); return; } scDelete(name); repaintPlan(); });
    // clash tile drill
    var clash = root.querySelector('[data-drill="planClash"]'); if (clash) { clash.style.cursor = "pointer"; clash.addEventListener("click", openPlanClash); }
  }
  function openPlanClash() {
    var cr = clashReport();
    var scrim = NS.$("faScrim");
    if (!scrim) { scrim = document.createElement("div"); scrim.id = "faScrim"; scrim.className = "fa-scrim"; document.body.appendChild(scrim); }
    var rows = cr.unplaced.concat(cr.moved).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.venue < b.venue ? -1 : 1)); });
    var head = '<div class="fa-mhead"><div><h3 style="margin:0">Pitch slots — 2027 scenario</h3><p class="hint" style="margin:2px 0 0">' + cr.unplaced.length + ' unplaced, ' + cr.moved.length + ' with kick-off moved, of ' + cr.withVenue.toLocaleString() + ' fixtures at a home ground. Assign another pitch, kick-off or date in LeagueRepublic to clear one.</p></div>' +
      '<div class="fa-mbtns"><button class="btn ghost sm" id="faCsv">Download CSV</button><button class="btn ghost sm" id="faClose">Close</button></div></div>';
    var body = '<div class="fa-mbody">';
    if (!rows.length) body += '<p class="hint"><b class="fa-ok">Every fixture seats at its division kick-off in this scenario.</b></p>';
    else {
      body += '<table><thead><tr><th>Date</th><th>Venue (pitch)</th><th>Division</th><th>Home</th><th>Away</th><th>Wanted</th><th>Seated</th><th>Status</th></tr></thead><tbody>';
      rows.forEach(function (x) { body += '<tr><td>' + fmtDate(x.date) + '</td><td>' + NS.esc(x.venue) + '</td><td>' + NS.esc(x.div) + '</td><td>' + NS.esc(x.home) + '</td><td>' + NS.esc(x.away) + '</td><td>' + mmToHHMM(x.koWant) + '</td><td>' + (x.status === "unplaced" ? "—" : mmToHHMM(x.koGot)) + '</td><td>' + (x.status === "unplaced" ? '<b class="fa-warn">unplaced</b>' : '<span class="fa-warn">moved</span>') + '</td></tr>'; });
      body += '</tbody></table>';
    }
    body += '</div>';
    scrim.innerHTML = '<div class="fa-modal">' + head + body + '</div>';
    scrim.classList.add("on"); scrim.style.display = "flex";
    NS.$("faClose").onclick = closeDrill;
    scrim.onclick = function (e) { if (e.target === scrim) closeDrill(); };
    NS.$("faCsv").onclick = function () {
      var esc = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = ["Date,Venue,Division,Home,Away,WantedKO,SeatedKO,Status"].concat(rows.map(function (x) { return [x.date, esc(x.venue), esc(x.div), esc(x.home), esc(x.away), mmToHHMM(x.koWant), x.status === "unplaced" ? "" : mmToHHMM(x.koGot), x.status].join(","); }));
      var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "CTTLFA 2027 pitch slots.csv";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    };
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
    else if (subView === "context") html = renderContext(o);
    else if (subView === "issues") html = renderIssues(o);
    if (subView === "trends" && SEASONS.some(function (s) { return !cache[s.id]; })) return; // loader in flight
    body.innerHTML = html;
    bindDrills();
    Array.prototype.forEach.call(document.querySelectorAll("#fixturesRoot .fa-ov"), function (b) {
      b.addEventListener("click", function () { var k = b.getAttribute("data-ov"); overlays[k] = !overlays[k]; paint(cur); });
    });
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
      '<button class="fa-sub" data-sub="context">Context</button>' +
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
  NS.renderPlanner27 = repaintPlan;
})(window.AC);
