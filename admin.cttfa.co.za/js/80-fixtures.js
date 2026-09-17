/* CTTLFA admin — Fixture Analytics module. Closure over window.AC.
   Pulls every fixture for a season straight from the LeagueRepublic JSON API
   (leagueID 895893986) and builds full analytics: team entrants, teams per club,
   day-of-week and kick-off breakdowns, a season calendar heat-map, and fixture
   issues (walkovers, abandonments, postponements, byes). Seasons 2022-2026. */
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

  function jget(path) {
    return fetch(API + path + ".json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return null; });
  }
  function clean(n) { return (n || "").replace(CODE, "").replace(/\s+/g, " ").trim(); }
  function isBye(n) { return /(^|\s)bye$/i.test(clean(n)); }
  function clubOf(n) { return clean(n).replace(/\s+[A-Z]$/, "").replace(/\s+\d+$/, "").trim(); }
  function pad(x) { return ("0" + x).slice(-2); }
  function dParts(s) { // "20260912 15:00" -> {y,m,d,hh,mm,dow,iso}
    if (!s || s.length < 8) return null;
    var y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    var hh = s.length >= 14 ? +s.slice(9, 11) : null, mm = s.length >= 14 ? +s.slice(12, 14) : null;
    var dt = new Date(y, m - 1, d);
    return { y: y, m: m, d: d, hh: hh, mm: mm, dow: dt.getDay(), iso: y + "-" + pad(m) + "-" + pad(d), t: dt.getTime() };
  }

  function loadSeason(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    return Promise.all([jget("/getFixturesForSeason/" + id), jget("/getFixtureGroupsForSeason/" + id)])
      .then(function (r) {
        if (!r[0]) return null;
        cache[id] = { fixtures: r[0], groups: r[1] || [] };
        return cache[id];
      });
  }

  function analyze(data) {
    var fx = data.fixtures, groups = data.groups;
    var league = fx.filter(function (x) { return x.fixtureTypeID === 1; });
    var cups = fx.filter(function (x) { return x.fixtureTypeID === 2; });
    var divs = groups.filter(function (g) { return g.fixtureTypeID === 1; }).length;
    var comps = groups.filter(function (g) { return g.fixtureTypeID === 2; }).length;

    var o = {
      total: fx.length, league: league.length, cups: cups.length, divs: divs, comps: comps,
      played: 0, unplayed: 0, byes: 0, walkHome: 0, walkAway: 0, abandoned: 0, postponed: 0, normal: 0,
      day: {}, night: 0, dayGames: 0, byHour: {}, byMonth: {}, byDate: {}, venues: {},
      teams: {}, clubs: {}, firstT: Infinity, lastT: -Infinity
    };
    DOW.forEach(function (d) { o.day[d] = 0; });

    fx.forEach(function (f) {
      var bye = isBye(f.homeTeamName) || isBye(f.roadTeamName);
      if (bye) o.byes++;
      // status
      var s = (f.fixtureStatusDesc || "").toLowerCase();
      if (s.indexOf("home walkover") >= 0) o.walkHome++;
      else if (s.indexOf("away walkover") >= 0) o.walkAway++;
      else if (s.indexOf("abandon") >= 0) o.abandoned++;
      else if (s.indexOf("postpon") >= 0) o.postponed++;
      else o.normal++;
      if (f.result) o.played++; else if (!bye) o.unplayed++;
      // teams / clubs (exclude byes)
      [["homeTeam", "homeTeamName"], ["roadTeam", "roadTeamName"]].forEach(function (p) {
        var nm = f[p[1]]; if (!nm || isBye(nm)) return;
        var id = f[p[0]]; if (id != null) o.teams[id] = clean(nm);
      });
      // date / time
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
    // clubs from teams
    Object.keys(o.teams).forEach(function (id) {
      var c = clubOf(o.teams[id]); (o.clubs[c] = o.clubs[c] || 0); o.clubs[c]++;
    });
    o.nTeams = Object.keys(o.teams).length;
    o.nClubs = Object.keys(o.clubs).length;
    o.walkovers = o.walkHome + o.walkAway;
    return o;
  }

  /* ---------- render helpers ---------- */
  function tile(n, lbl, sub) {
    return '<div class="fa-tile"><b>' + n + '</b><span>' + lbl + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }
  function bar(label, val, max, cls) {
    var pct = max ? Math.round(val / max * 100) : 0;
    return '<div class="fa-bar"><span class="fa-bl">' + label + '</span><span class="fa-bt"><span class="fa-bf ' + (cls || '') + '" style="width:' + pct + '%"></span></span><span class="fa-bv">' + val + '</span></div>';
  }

  function renderOverview(o) {
    var h = '<div class="fa-tiles">';
    h += tile(o.total.toLocaleString(), "Total fixtures", o.league.toLocaleString() + " league · " + o.cups + " cup");
    h += tile(o.played.toLocaleString(), "Played", ((o.total ? Math.round(o.played / o.total * 100) : 0)) + "% of the programme");
    h += tile(o.unplayed.toLocaleString(), "Still to play", "excludes byes");
    h += tile(o.divs, "Divisions", o.comps + " knockout cups");
    h += tile(o.nTeams.toLocaleString(), "Team entrants", "distinct teams entered");
    h += tile(o.nClubs, "Clubs", (o.nClubs ? (o.nTeams / o.nClubs).toFixed(1) : 0) + " teams per club");
    h += '</div>';

    // day of week
    var dmax = Math.max.apply(null, DOW.map(function (d) { return o.day[d]; }));
    h += '<div class="fa-grid2">';
    h += '<div class="card"><h3>Fixtures by day of the week</h3>';
    ["Saturday", "Sunday", "Friday", "Thursday", "Wednesday", "Tuesday", "Monday"].forEach(function (d) {
      h += bar(d, o.day[d], dmax, d === "Saturday" ? "gold" : (d === "Sunday" ? "blue" : ""));
    });
    h += '<p class="hint" style="margin-top:8px">Saturday is the league\'s main match day. Sunday and midweek fixtures are shown for planning.</p></div>';
    // kick-off times
    var hmax = Math.max.apply(null, Object.keys(o.byHour).map(function (k) { return o.byHour[k]; }).concat([1]));
    h += '<div class="card"><h3>Kick-off times</h3>';
    h += '<div class="fa-tiles fa-tiles-sm">' + tile(o.night.toLocaleString(), "Night games", "17:00 and later") + tile(o.dayGames.toLocaleString(), "Daytime games", "before 17:00") + '</div>';
    var hrs = Object.keys(o.byHour).map(Number).sort(function (a, b) { return a - b; });
    h += '<div class="fa-hours">';
    hrs.forEach(function (hr) { var pct = Math.round(o.byHour[hr] / hmax * 100); h += '<div class="fa-hcol" title="' + pad(hr) + ':00 — ' + o.byHour[hr] + ' fixtures"><span class="fa-hbar ' + (hr >= 17 ? 'night' : '') + '" style="height:' + Math.max(4, pct) + '%"></span><span class="fa-hl">' + pad(hr) + '</span></div>'; });
    h += '</div><p class="hint">Bars are kick-off hours; amber bars are 17:00+ (night games).</p></div>';
    h += '</div>';

    // busiest dates
    var top = Object.keys(o.byDate).map(function (k) { return [k, o.byDate[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    h += '<div class="card"><h3>Busiest match days</h3><table><thead><tr><th>Date</th><th>Day</th><th style="text-align:right">Fixtures</th></tr></thead><tbody>';
    top.forEach(function (r) { var d = new Date(r[0] + "T00:00:00"); h += '<tr><td>' + d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear() + '</td><td>' + DOW[d.getDay()] + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
    h += '</tbody></table></div>';
    return h;
  }

  function renderEntrants(o) {
    var clubs = Object.keys(o.clubs).map(function (c) { return [c, o.clubs[c]]; }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
    var h = '<div class="fa-tiles">';
    h += tile(o.nClubs, "Clubs", "distinct clubs");
    h += tile(o.nTeams.toLocaleString(), "Teams entered", "across all divisions");
    h += tile((o.nClubs ? (o.nTeams / o.nClubs).toFixed(1) : 0), "Avg teams / club", "");
    h += tile(clubs.length ? clubs[0][1] : 0, "Most teams", clubs.length ? clubs[0][0] : "");
    h += '</div>';
    h += '<div class="card"><h3>Teams entered per club</h3><p class="hint" style="margin-bottom:8px">How many teams each club fields across every age group and division this season.</p>';
    h += '<table><thead><tr><th>#</th><th>Club</th><th style="text-align:right">Teams</th></tr></thead><tbody>';
    clubs.forEach(function (r, i) { h += '<tr><td>' + (i + 1) + '</td><td>' + NS.esc(r[0]) + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
    h += '</tbody></table></div>';
    return h;
  }

  function renderIssues(o) {
    var h = '<div class="fa-tiles">';
    h += tile(o.walkovers, "Walkovers", o.walkHome + " home · " + o.walkAway + " away");
    h += tile(o.byes.toLocaleString(), "Byes", "teams with no opponent");
    h += tile(o.postponed, "Postponed", "still marked postponed");
    h += tile(o.abandoned, "Abandoned", "matches abandoned");
    h += '</div>';
    h += '<div class="card"><h3>Result & status breakdown</h3>';
    var max = Math.max(o.normal, o.walkovers, o.byes, o.abandoned, o.postponed, 1);
    h += bar("Normal (no issue)", o.normal, max, "green");
    h += bar("Home walkovers", o.walkHome, max, "gold");
    h += bar("Away walkovers", o.walkAway, max, "gold");
    h += bar("Byes", o.byes, max, "blue");
    h += bar("Abandoned", o.abandoned, max, "red");
    h += bar("Postponed", o.postponed, max, "red");
    h += '<p class="hint" style="margin-top:8px">Walkovers, abandonments and postponements are the fixture-integrity items to watch. Byes are scheduled gaps, not problems.</p></div>';
    // top venues
    var tv = Object.keys(o.venues).map(function (k) { return [k, o.venues[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    if (tv.length) {
      h += '<div class="card"><h3>Most-used venues</h3><table><thead><tr><th>Venue</th><th style="text-align:right">Fixtures</th></tr></thead><tbody>';
      tv.forEach(function (r) { h += '<tr><td>' + NS.esc(r[0]) + '</td><td style="text-align:right"><b>' + r[1] + '</b></td></tr>'; });
      h += '</tbody></table></div>';
    }
    return h;
  }

  function renderCalendar(data, o) {
    // month grid heat-map across the season's span, Sun..Sat columns
    if (o.firstT === Infinity) return '<div class="card"><p class="hint">No dated fixtures.</p></div>';
    var months = Object.keys(o.byMonth).sort();
    var vals = Object.keys(o.byDate).map(function (k) { return o.byDate[k]; });
    var hmax = Math.max.apply(null, vals.concat([1]));
    function heat(n) { if (!n) return ""; var l = n / hmax; return l > .66 ? "h3" : l > .33 ? "h2" : "h1"; }
    var h = '<div class="card"><h3>Season calendar</h3><p class="hint" style="margin-bottom:10px">Every match day across the season. Darker = more fixtures; Saturdays are outlined. Click a day to list its fixtures below.</p><div class="fa-cal">';
    months.forEach(function (ym) {
      var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      var first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
      h += '<div class="fa-mon"><div class="fa-mon-h">' + MON[m - 1] + " " + y + '</div><div class="fa-week">';
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { h += '<span class="fa-wd">' + d + '</span>'; });
      for (var i = 0; i < first.getDay(); i++) h += '<span class="fa-day empty"></span>';
      for (var dd = 1; dd <= days; dd++) {
        var iso = y + "-" + pad(m) + "-" + pad(dd), n = o.byDate[iso] || 0, dow = new Date(y, m - 1, dd).getDay();
        h += '<span class="fa-day ' + heat(n) + (dow === 6 ? ' sat' : '') + (n ? ' has' : '') + '" data-date="' + iso + '" title="' + dd + " " + MON[m - 1] + ": " + n + ' fixtures">' + dd + (n ? '<i>' + n + '</i>' : '') + '</span>';
      }
      h += '</div></div>';
    });
    h += '</div><div id="faDayList" class="fa-daylist"></div></div>';
    return h;
  }

  function dayList(data, iso) {
    var el = NS.$("faDayList"); if (!el) return;
    var rows = data.fixtures.filter(function (f) { var dp = dParts(f.fixtureDate); return dp && dp.iso === iso && !isBye(f.homeTeamName) && !isBye(f.roadTeamName); })
      .sort(function (a, b) { return (a.fixtureDate || "").localeCompare(b.fixtureDate || ""); });
    var d = new Date(iso + "T00:00:00");
    var h = '<div class="fa-dl-h">' + DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear() + " — " + rows.length + ' fixtures</div>';
    if (!rows.length) { h += '<p class="hint">No fixtures scheduled.</p>'; el.innerHTML = h; return; }
    h += '<table><thead><tr><th>Time</th><th>Competition</th><th>Home</th><th>Away</th><th>Venue</th></tr></thead><tbody>';
    rows.forEach(function (f) {
      var dp = dParts(f.fixtureDate), t = dp && dp.hh != null ? pad(dp.hh) + ":" + pad(dp.mm) : "TBC";
      h += '<tr><td>' + t + '</td><td>' + NS.esc(f.fixtureGroupDesc || "") + '</td><td>' + NS.esc(clean(f.homeTeamName)) + '</td><td>' + NS.esc(clean(f.roadTeamName)) + '</td><td>' + NS.esc(f.venueAndSubVenueDesc || "") + '</td></tr>';
    });
    h += '</tbody></table>';
    el.innerHTML = h;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function paint(id) {
    var root = NS.$("fixturesRoot"); if (!root) return;
    var data = cache[id]; var o = analyze(data);
    var body = "";
    if (subView === "overview") body = renderOverview(o);
    else if (subView === "entrants") body = renderEntrants(o);
    else if (subView === "calendar") body = renderCalendar(data, o);
    else if (subView === "issues") body = renderIssues(o);
    NS.$("faBody").innerHTML = body;
    if (subView === "calendar") {
      Array.prototype.forEach.call(document.querySelectorAll("#fixturesRoot .fa-day.has"), function (c) {
        c.addEventListener("click", function () { dayList(data, c.getAttribute("data-date")); });
      });
    }
  }

  function selectSeason(id) {
    cur = id;
    var root = NS.$("fixturesRoot");
    Array.prototype.forEach.call(root.querySelectorAll(".fa-season"), function (b) { b.classList.toggle("on", +b.getAttribute("data-sid") === id); });
    NS.$("faBody").innerHTML = '<div class="card"><p class="hint">Loading ' + (SEASONS.filter(function (s) { return s.id === id; })[0] || {}).y + ' fixtures from LeagueRepublic…</p></div>';
    loadSeason(id).then(function (d) {
      if (!d) { NS.$("faBody").innerHTML = '<div class="card"><p class="hint">Could not load this season from the API. Try again in a moment.</p></div>'; return; }
      paint(id);
    });
  }

  function render() {
    var root = NS.$("fixturesRoot"); if (!root) return;
    var h = '<div class="card" style="margin-bottom:12px"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">';
    h += '<div><h3 style="margin:0 0 4px">Fixture Analytics</h3><p class="hint" style="margin:0;max-width:74ch">Live from LeagueRepublic. Team entrants, teams per club, day and kick-off breakdowns, a season calendar, and fixture issues (walkovers, byes, postponements). Pick a season.</p></div>';
    h += '<div class="fa-seasons">' + SEASONS.map(function (s) { return '<button class="fa-season" data-sid="' + s.id + '">' + s.y + '</button>'; }).join("") + '</div>';
    h += '</div>';
    h += '<div class="fa-subtabs">' +
      '<button class="fa-sub on" data-sub="overview">Overview</button>' +
      '<button class="fa-sub" data-sub="entrants">Entrants</button>' +
      '<button class="fa-sub" data-sub="calendar">Calendar</button>' +
      '<button class="fa-sub" data-sub="issues">Issues</button></div>';
    h += '<div id="faBody"></div>';
    root.innerHTML = h;
    Array.prototype.forEach.call(root.querySelectorAll(".fa-season"), function (b) { b.addEventListener("click", function () { selectSeason(+b.getAttribute("data-sid")); }); });
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
