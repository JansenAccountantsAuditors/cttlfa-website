/* CTTLFA live snapshot — computes division / team / fixture figures from season.json
   at render time, so any change to the leagues (a withdrawal, a new entry, played
   results) is reflected automatically. Byes are excluded; the empty "Premier 3 A&B"
   combined-log placeholders are skipped so their fixtures are not double counted. */
(function (w) {
  function realRows(v) {
    return (v.table || []).filter(function (r) {
      return Array.isArray(r) && r[0] && String(r[0]).toLowerCase().indexOf('bye') < 0;
    });
  }
  function leagueStats(v) {
    var rr = realRows(v);
    var pl = rr.reduce(function (a, r) { return a + (Number(r[1]) || 0); }, 0);
    return { teams: rr.length, played: Math.round(pl / 2), remaining: (v.fixtures || []).length };
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function longDate(iso) {
    try {
      var d = new Date(iso), M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
    } catch (e) { return ''; }
  }

  function build(mountId, cfg, data) {
    var mount = document.getElementById(mountId);
    if (!mount || !data || !data.leagues) return;
    var L = data.leagues;

    var streams = cfg.streams.map(function (s) {
      var divs = [];
      Object.keys(L).forEach(function (k) {
        var v = L[k];
        if (v.group !== s.group) return;
        var st = leagueStats(v);
        if (st.teams === 0) return;
        var nm = v.name || '';
        if (cfg.stripPrefix) nm = nm.replace(cfg.stripPrefix, '');
        divs.push({ name: nm, teams: st.teams, played: st.played, remaining: st.remaining });
      });
      var T = divs.reduce(function (a, d) { return a + d.teams; }, 0);
      var P = divs.reduce(function (a, d) { return a + d.played; }, 0);
      var R = divs.reduce(function (a, d) { return a + d.remaining; }, 0);
      return { label: s.label, divs: divs, count: divs.length, teams: T, played: P, remaining: R };
    }).filter(function (s) { return s.count > 0; });

    if (!streams.length) return;

    var totDiv = 0, totTeams = 0, totPlayed = 0, totRem = 0;
    streams.forEach(function (s) { totDiv += s.count; totTeams += s.teams; totPlayed += s.played; totRem += s.remaining; });
    var totFix = totPlayed + totRem;
    var avg = totDiv ? (totTeams / totDiv) : 0;
    var pct = totFix ? Math.round(100 * totPlayed / totFix) : 0;
    var maxTeams = Math.max.apply(null, streams.map(function (s) { return s.teams; })) || 1;

    var h = '';
    h += '<div class="snapblock">';
    h += '<span class="snap-eyebrow">Season ' + esc(data.season || '') + ' · at a glance</span>';
    h += '<h2 class="snap-h2">' + esc(cfg.title) + '</h2>';
    h += '<p class="snap-lede">' + esc(cfg.lede) + '</p>';

    h += '<div class="snap-stats">';
    h += tile(fmt(totDiv), cfg.divWord, 'across ' + streams.length + ' ' + cfg.groupWord);
    h += tile(fmt(totTeams), 'Teams entered', cfg.teamsSub);
    h += tile(fmt(totFix), 'Fixtures this season', 'played and still to play');
    h += tile((Math.round(avg * 10) / 10).toString(), 'Average teams<br>per division', fmt(totTeams) + ' ÷ ' + totDiv + ' divisions');
    h += '</div>';

    h += '<div class="snap-sec"><h3 class="snap-h3">Season progress</h3>';
    h += '<p class="snap-bh">' + pct + '% of the season’s fixtures have been played.</p>';
    h += '<div class="snap-prog" role="img" aria-label="' + fmt(totPlayed) + ' of ' + fmt(totFix) + ' fixtures played, ' + pct + ' percent">';
    h += '<span class="snap-progfill" style="width:' + pct + '%"></span></div>';
    h += '<p class="snap-proglabel"><b>' + fmt(totPlayed) + '</b> played · <b>' + fmt(totRem) + '</b> still to play · ' + fmt(totFix) + ' fixtures in total</p>';
    h += '</div>';

    h += '<div class="snap-sec"><h3 class="snap-h3">Teams by ' + cfg.streamWord + '</h3>';
    h += '<p class="snap-bh">Where the ' + fmt(totTeams) + ' teams sit.</p>';
    streams.forEach(function (s) {
      var wpc = Math.round(1000 * s.teams / maxTeams) / 10;
      h += '<div class="snap-sbar"><span class="snap-bn">' + esc(s.label) + '</span>';
      h += '<span class="snap-track"><span class="snap-fill" style="width:' + wpc + '%"></span></span>';
      h += '<span class="snap-meta"><b>' + fmt(s.teams) + '</b>teams · ' + s.count + ' div · ' + fmt(s.played) + '/' + fmt(s.played + s.remaining) + ' played</span></div>';
    });
    h += '</div>';

    h += '<div class="snap-sec"><h3 class="snap-h3">League sizes &amp; how each division is tracking</h3>';
    h += '<p class="snap-bh">Each division shows its team count, the share of fixtures played and the matches still to play. Byes excluded.</p>';
    h += '<div class="snap-cols">';
    streams.forEach(function (s) {
      h += '<div class="snap-col"><div class="snap-ch">' + esc(s.label) + ' <small>' + s.count + ' div · ' + fmt(s.teams) + ' teams</small></div>';
      s.divs.forEach(function (d) {
        var dtot = d.played + d.remaining, dp = dtot ? Math.round(100 * d.played / dtot) : 0;
        h += '<div class="snap-row">';
        h += '<div class="snap-rtop"><span class="snap-rname">' + esc(d.name) + '</span><b class="snap-rteams">' + d.teams + '<small>teams</small></b></div>';
        h += '<div class="snap-rprog"><span class="snap-rtrack"><span class="snap-rfill" style="width:' + dp + '%"></span></span>';
        h += '<span class="snap-rpct">' + dp + '%</span><span class="snap-rleft">' + fmt(d.remaining) + ' left</span></div>';
        h += '</div>';
      });
      h += '</div>';
    });
    h += '</div></div>';

    h += '<p class="snap-src"><b>Source:</b> CTTLFA Match Centre (LeagueRepublic), as at ' + esc(longDate(data.updated)) + '. ' + esc(cfg.scope) + ' Byes excluded. Figures update automatically with the league data.</p>';
    h += '</div>';

    mount.innerHTML = h;
  }

  function tile(n, label, sub) {
    return '<div class="snap-stat"><span class="snap-cap"></span><div class="snap-n">' + n + '</div><div class="snap-l">' + label + '</div><div class="snap-s">' + sub + '</div></div>';
  }

  var SENIOR = {
    title: 'Adult football by the numbers',
    lede: 'Every adult division, team, league size and fixture in one view, across senior, reserve, veterans and women’s football, so clubs can see the shape of the game without opening each log.',
    streams: [
      { group: 'Senior Divisions', label: 'Senior Divisions' },
      { group: 'Reserves', label: 'Reserves' },
      { group: 'Veterans', label: 'Veterans' },
      { group: 'Women', label: 'Women’s' }
    ],
    stripPrefix: null,
    divWord: 'Adult divisions',
    groupWord: 'streams',
    streamWord: 'competition stream',
    teamsSub: 'senior, reserve, vets, women’s',
    scope: 'Scope: all adult football — senior, reserve, veterans and women’s leagues.'
  };
  var JUNIOR = {
    title: 'Junior football by the numbers',
    lede: 'Every junior division, team, league size and fixture in one view, across the Under-18 to Under-12 age groups, so clubs and parents can see the shape of the youth game without opening each log.',
    streams: [
      { group: 'Under-18', label: 'Under-18' },
      { group: 'Under-16', label: 'Under-16' },
      { group: 'Under-14', label: 'Under-14' },
      { group: 'Under-12', label: 'Under-12' }
    ],
    stripPrefix: /^Under\s*\d+\s*/i,
    divWord: 'Junior divisions',
    groupWord: 'age groups',
    streamWord: 'age group',
    teamsSub: 'U18 to U12 leagues',
    scope: 'Scope: junior league football, Under-18 to Under-12. Mini football (U7–U11) runs as festivals, not leagues, and is not counted here.'
  };

  w.buildCTTLFASnapshots = function (data) {
    if (!data) return;
    build('seniorSnapshot', SENIOR, data);
    build('juniorSnapshot', JUNIOR, data);
  };
})(window);

/* self-init: build as soon as the season data is available; the site preloads it
   into window.__seasonP, otherwise we fetch it directly. */
(function () {
  function go(d) { try { if (d) window.buildCTTLFASnapshots(d); } catch (e) {} }
  function fromFetch() { fetch('season.json').then(function (r) { return r.json(); }).then(go).catch(function () {}); }
  function start() {
    var P = window.__seasonP;
    if (P && typeof P.then === 'function') { P.then(function (d) { d ? go(d) : fromFetch(); }).catch(fromFetch); }
    else { fromFetch(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
