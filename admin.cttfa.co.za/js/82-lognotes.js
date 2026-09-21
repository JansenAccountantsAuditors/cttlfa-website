/* 82-lognotes.js — Log Notes: public annotations on the league logs.
   Lets an admin mark a LeagueRepublic fixture as a "no result" or a points
   adjustment, with a short note shown under that division's log on the public
   site (www.cttfa.co.za). Stored in Supabase (public.log_notes); the public site
   reads active + public rows and applies them when it builds the logs.
   Gated under the Football / "fixtures" access area. */
(function (NS) {
  "use strict";
  var API = "https://api.leaguerepublic.com/json";
  var SEASONS = [
    { y: 2026, id: 47708359, file: "season.json" },
    { y: 2025, id: 763744782, file: "season-2025.json" }
  ];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var CODE = /^[A-Za-z0-9]+-\s*\d+\s*-\s*/;
  var KINDS = { no_result: "No result", points_adjustment: "Points adjustment", note: "Note only" };

  var cache = {};        // seasonId -> { groups:[], fixtures:[] }
  var cur = SEASONS[0];  // selected season
  var notes = [];        // existing log_notes rows
  var editing = null;    // row being edited, or null

  function esc(s) { return NS.esc(s); }
  function clean(n) { return (n || "").replace(CODE, "").replace(/\s+/g, " ").trim(); }
  function isBye(n) { return /(^|\s)bye\.?$/i.test(clean(n)); }
  function keyOf(desc) { var m = String(desc || "").match(/^([A-Za-z0-9]+)\s*-/); return m ? m[1] : ""; }
  function nameOf(desc) { var m = String(desc || "").match(/^[A-Za-z0-9]+\s*-\s*(.+)$/); return m ? m[1].trim() : String(desc || "").trim(); }
  function fdate(s) { if (!s || s.length < 8) return ""; return (+s.slice(6, 8)) + " " + (MON[(+s.slice(4, 6)) - 1] || "") + " " + s.slice(0, 4); }
  function canEdit() { return NS.canEdit ? NS.canEdit("fixtures") : false; }
  function myEmail() { try { var s = NS.session(); return (s && s.me && s.me.email) || "admin"; } catch (e) { return "admin"; } }
  function seasonByFile(f) { for (var i = 0; i < SEASONS.length; i++) if (SEASONS[i].file === f) return SEASONS[i]; return SEASONS[0]; }

  function jget(path) { return fetch(API + path + ".json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  function loadSeason(s) {
    if (cache[s.id]) return Promise.resolve(cache[s.id]);
    return Promise.all([jget("/getFixtureGroupsForSeason/" + s.id), jget("/getFixturesForSeason/" + s.id)]).then(function (r) {
      var groups = (r[0] || []).filter(function (g) { return g.fixtureTypeID === 1; })
        .sort(function (a, b) { return keyOf(a.fixtureGroupDesc).localeCompare(keyOf(b.fixtureGroupDesc)); });
      var fixtures = (r[1] || []).filter(function (f) { return f.fixtureTypeID === 1; });
      cache[s.id] = { groups: groups, fixtures: fixtures };
      return cache[s.id];
    });
  }
  function loadNotes() {
    return NS.sb.from("log_notes").select("*").order("created_at", { ascending: false }).then(function (r) {
      if (r.error) throw r.error; notes = r.data || []; return notes;
    });
  }

  function style() {
    if (document.getElementById("lnStyle")) return;
    var s = document.createElement("style"); s.id = "lnStyle";
    s.textContent =
      '#tab-lognotes .ln-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;max-width:900px}' +
      '#tab-lognotes .ln-f{display:flex;flex-direction:column;gap:5px}' +
      '#tab-lognotes .ln-f.full{grid-column:1/-1}' +
      '#tab-lognotes .ln-f label{font-size:12px;font-weight:700;color:var(--muted,#59666b);text-transform:uppercase;letter-spacing:.04em}' +
      '#tab-lognotes select,#tab-lognotes input[type=text],#tab-lognotes input[type=number],#tab-lognotes textarea{font-size:14px;padding:8px 10px;border:1px solid var(--line,#d3dbde);border-radius:9px;color:var(--navy,#071A4A);background:#fff;width:100%;font-family:inherit}' +
      '#tab-lognotes textarea{min-height:64px;resize:vertical}' +
      '#tab-lognotes .ln-pts{display:none;gap:14px 18px;grid-column:1/-1;grid-template-columns:1fr 1fr}' +
      '#tab-lognotes .ln-pts.on{display:grid}' +
      '#tab-lognotes .ln-chk{display:flex;align-items:center;gap:9px;grid-column:1/-1}' +
      '#tab-lognotes .ln-chk input{width:18px;height:18px}' +
      '#tab-lognotes .ln-chk label{text-transform:none;letter-spacing:0;font-size:13.5px;color:var(--ink,#212d33)}' +
      '#tab-lognotes .ln-btn{background:var(--navy,#071A4A);color:#fff;border:0;border-radius:10px;padding:10px 20px;font-weight:700;font-size:14px;cursor:pointer}' +
      '#tab-lognotes .ln-btn:disabled{opacity:.5;cursor:default}' +
      '#tab-lognotes .ln-btn.sec{background:#fff;color:var(--navy,#071A4A);border:1px solid var(--line,#d3dbde)}' +
      '#tab-lognotes .ln-actions{display:flex;gap:10px;align-items:center;grid-column:1/-1;margin-top:4px}' +
      '#tab-lognotes table.ln-tbl{border-collapse:collapse;width:100%;font-size:13.5px}' +
      '#tab-lognotes .ln-tbl th{background:var(--navy,#071A4A);color:#fff;text-align:left;padding:8px 10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}' +
      '#tab-lognotes .ln-tbl td{padding:8px 10px;border-bottom:1px solid var(--line,#eef1f6);vertical-align:top}' +
      '#tab-lognotes .ln-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}' +
      '#tab-lognotes .ln-tag.nr{background:rgba(154,49,48,.12);color:#9A3130}' +
      '#tab-lognotes .ln-tag.pa{background:rgba(208,152,47,.16);color:#996A16}' +
      '#tab-lognotes .ln-tag.no{background:rgba(24,64,80,.10);color:#184050}' +
      '#tab-lognotes .ln-tag.off{background:#eef1f6;color:#59666b}' +
      '#tab-lognotes .ln-mini{background:none;border:0;color:var(--navy,#071A4A);font-weight:700;cursor:pointer;font-size:12.5px;padding:2px 4px;text-decoration:underline}' +
      '#tab-lognotes .ln-mini.warn{color:#9A3130}';
    document.head.appendChild(s);
  }

  /* ---------- render ---------- */
  function render() {
    var root = NS.$("lognotesRoot"); if (!root) return;
    style();
    root.innerHTML = '<div class="card"><p class="hint">Loading Log Notes&hellip;</p></div>';
    Promise.all([loadSeason(cur), loadNotes()]).then(paint).catch(function (e) {
      root.innerHTML = '<div class="card"><p class="hint">Could not load Log Notes: ' + esc(e.message || String(e)) + '</p></div>';
    });
  }

  function divOptions() {
    var g = cache[cur.id].groups, h = '<option value="">Select a division&hellip;</option>';
    g.forEach(function (x) { h += '<option value="' + x.fixtureGroupIdentifier + '">' + esc(keyOf(x.fixtureGroupDesc) + " — " + nameOf(x.fixtureGroupDesc)) + '</option>'; });
    return h;
  }
  function fixtureOptions(fgid) {
    if (!fgid) return '<option value="">Choose a division first</option>';
    var fx = cache[cur.id].fixtures.filter(function (f) {
      return String(f.fixtureGroupIdentifier) === String(fgid) && !isBye(f.homeTeamName) && !isBye(f.roadTeamName);
    }).sort(function (a, b) { return (a.fixtureDateInMilliseconds || 0) - (b.fixtureDateInMilliseconds || 0); });
    if (!fx.length) return '<option value="">No fixtures found</option>';
    var h = '<option value="">Select a fixture&hellip;</option>';
    fx.forEach(function (f) {
      h += '<option value="' + f.fixtureID + '">' + esc(fdate(f.fixtureDate) + "  —  " + clean(f.homeTeamName) + " v " + clean(f.roadTeamName)) + '</option>';
    });
    return h;
  }

  function paint() {
    var root = NS.$("lognotesRoot"); if (!root) return;
    var editable = canEdit();
    var h = '';

    // intro
    h += '<div class="card">' +
      '<h3 style="margin:0 0 6px">Log Notes</h3>' +
      '<p class="hint" style="margin:0;max-width:90ch">Add a public annotation to a league log. Use it when a fixture must be recorded as a <b>no result</b> (for example a Disciplinary Committee ruling on an abandoned match), or when a points adjustment applies. The note appears under that division&rsquo;s log on the public site. A no result counts the match as played and as a goalless draw, but awards no points to either side.</p>' +
      '</div>';

    // form
    if (editable) {
      if (editing) {
        h += '<div class="card"><h3 style="margin:0 0 4px">Edit note</h3>' +
          '<p class="hint" style="margin:0 0 14px">' + esc((editing.division_name || editing.division_key || "") + " · " + (editing.home_team || "") + " v " + (editing.away_team || "") + " · " + fdate(editing.fixture_date)) + '</p>' +
          '<div class="ln-grid">' + formFields(editing) + '</div>' +
          '<div id="lnMsg"></div></div>';
      } else {
        h += '<div class="card"><h3 style="margin:0 0 14px">Add a note</h3>' +
          '<div class="ln-grid">' +
          '<div class="ln-f"><label>Season</label><select id="lnSeason">' + SEASONS.map(function (s) { return '<option value="' + s.file + '"' + (s.file === cur.file ? ' selected' : '') + '>' + s.y + '</option>'; }).join('') + '</select></div>' +
          '<div class="ln-f"><label>Division</label><select id="lnDiv">' + divOptions() + '</select></div>' +
          '<div class="ln-f full"><label>Fixture</label><select id="lnFix">' + fixtureOptions("") + '</select></div>' +
          formFields(null) +
          '</div><div id="lnMsg"></div></div>';
      }
    } else {
      h += '<div class="card"><p class="hint">You have view-only access here. Ask an administrator for edit rights on the Football area to add or change log notes.</p></div>';
    }

    // list
    h += '<div class="card"><h3 style="margin:0 0 12px">Existing notes</h3>' + listHtml(editable) + '</div>';

    root.innerHTML = h;
    if (editable) wire();
  }

  function formFields(row) {
    var kind = row ? row.kind : "no_result";
    var note = row ? (row.public_note || "") : "";
    var dc = row ? (row.dc_ref || "") : "";
    var ha = row ? row.home_points_adj : 0, aa = row ? row.away_points_adj : 0;
    var sp = row ? !!row.show_public : true;
    var hteam = row ? (row.home_team || "Home") : "Home", ateam = row ? (row.away_team || "Away") : "Away";
    return '' +
      '<div class="ln-f"><label>Treatment</label><select id="lnKind">' +
      Object.keys(KINDS).map(function (k) { return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + KINDS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="ln-f"><label>DC / reference (optional)</label><input type="text" id="lnRef" value="' + esc(dc) + '" placeholder="e.g. DC042-13-06-2026"></div>' +
      '<div class="ln-pts' + (kind === "points_adjustment" ? " on" : "") + '" id="lnPts">' +
      '<div class="ln-f"><label>' + esc(hteam) + ' points</label><input type="number" id="lnHa" value="' + (ha || 0) + '" step="1"></div>' +
      '<div class="ln-f"><label>' + esc(ateam) + ' points</label><input type="number" id="lnAa" value="' + (aa || 0) + '" step="1"></div></div>' +
      '<div class="ln-f full"><label>Public note</label><textarea id="lnNote" placeholder="Shown under the division log, e.g. Recorded as a no result (DC042).">' + esc(note) + '</textarea></div>' +
      '<div class="ln-chk"><input type="checkbox" id="lnPub"' + (sp ? ' checked' : '') + '><label for="lnPub">Show this note on the public log</label></div>' +
      '<div class="ln-actions"><button class="ln-btn" id="lnSave">' + (row ? "Update note" : "Save note") + '</button>' +
      (row ? '<button class="ln-btn sec" id="lnCancel">Cancel</button>' : '') + '</div>';
  }

  function listHtml(editable) {
    if (!notes.length) return '<p class="hint" style="margin:0">No log notes yet.</p>';
    var h = '<div class="tscroll"><table class="ln-tbl"><thead><tr>' +
      '<th>Season</th><th>Division</th><th>Fixture</th><th>Treatment</th><th>Public note</th><th>Public</th><th>Status</th>' + (editable ? '<th></th>' : '') + '</tr></thead><tbody>';
    notes.forEach(function (n) {
      var tag = n.kind === "no_result" ? 'nr' : (n.kind === "points_adjustment" ? 'pa' : 'no');
      var adj = n.kind === "points_adjustment" ? (' (' + (n.home_points_adj >= 0 ? '+' : '') + n.home_points_adj + ' / ' + (n.away_points_adj >= 0 ? '+' : '') + n.away_points_adj + ')') : '';
      var sy = seasonByFile(n.season_file).y;
      h += '<tr style="' + (n.active ? '' : 'opacity:.55') + '">' +
        '<td>' + sy + '</td>' +
        '<td>' + esc(n.division_key || "") + '<div style="color:var(--muted,#59666b);font-size:12px">' + esc(n.division_name || "") + '</div></td>' +
        '<td>' + esc((n.home_team || "") + " v " + (n.away_team || "")) + '<div style="color:var(--muted,#59666b);font-size:12px">' + esc(fdate(n.fixture_date)) + '</div></td>' +
        '<td><span class="ln-tag ' + tag + '">' + esc(KINDS[n.kind] || n.kind) + '</span>' + esc(adj) + '</td>' +
        '<td style="max-width:280px">' + esc(n.public_note || "") + '</td>' +
        '<td>' + (n.show_public ? 'Yes' : '<span class="ln-tag off">Hidden</span>') + '</td>' +
        '<td>' + (n.active ? 'Active' : '<span class="ln-tag off">Removed</span>') + '</td>' +
        (editable ? '<td style="white-space:nowrap"><button class="ln-mini" data-edit="' + n.id + '">Edit</button> <button class="ln-mini warn" data-toggle="' + n.id + '">' + (n.active ? 'Remove' : 'Restore') + '</button></td>' : '') +
        '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- wiring ---------- */
  function wire() {
    var seasonSel = NS.$("lnSeason"), divSel = NS.$("lnDiv"), fixSel = NS.$("lnFix"), kindSel = NS.$("lnKind");
    if (seasonSel) seasonSel.onchange = function () {
      cur = seasonByFile(seasonSel.value);
      loadSeason(cur).then(function () { if (NS.$("lnDiv")) NS.$("lnDiv").innerHTML = divOptions(); if (NS.$("lnFix")) NS.$("lnFix").innerHTML = fixtureOptions(""); });
    };
    if (divSel) divSel.onchange = function () { if (fixSel) fixSel.innerHTML = fixtureOptions(divSel.value); };
    if (kindSel) kindSel.onchange = function () { var p = NS.$("lnPts"); if (p) p.classList.toggle("on", kindSel.value === "points_adjustment"); };

    var save = NS.$("lnSave"); if (save) save.onclick = onSave;
    var cancel = NS.$("lnCancel"); if (cancel) cancel.onclick = function () { editing = null; paint(); };

    Array.prototype.forEach.call(document.querySelectorAll("#tab-lognotes [data-edit]"), function (b) {
      b.onclick = function () { var row = notes.filter(function (n) { return n.id === b.getAttribute("data-edit"); })[0]; if (row) { editing = row; cur = seasonByFile(row.season_file); paint(); } };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tab-lognotes [data-toggle]"), function (b) {
      b.onclick = function () { var row = notes.filter(function (n) { return n.id === b.getAttribute("data-toggle"); })[0]; if (row) toggleActive(row); };
    });
  }

  function onSave() {
    var msg = NS.$("lnMsg"), save = NS.$("lnSave");
    var kind = (NS.$("lnKind") || {}).value || "no_result";
    var note = ((NS.$("lnNote") || {}).value || "").trim();
    var dc = ((NS.$("lnRef") || {}).value || "").trim();
    var ha = parseInt((NS.$("lnHa") || {}).value, 10) || 0;
    var aa = parseInt((NS.$("lnAa") || {}).value, 10) || 0;
    var showPublic = !!((NS.$("lnPub") || {}).checked);

    var payload = { kind: kind, home_points_adj: ha, away_points_adj: aa, public_note: note || null, dc_ref: dc || null, show_public: showPublic };

    if (editing) {
      save.disabled = true;
      NS.sb.from("log_notes").update(payload).eq("id", editing.id).then(function (r) {
        save.disabled = false;
        if (r.error) { NS.msg(msg, r.error.message, "err"); return; }
        editing = null; loadNotes().then(paint);
      });
      return;
    }

    // new entry — need the picked fixture
    var fixSel = NS.$("lnFix"), fid = fixSel ? fixSel.value : "";
    if (!fid) { NS.msg(msg, "Pick a division and a fixture first.", "err"); return; }
    if (kind !== "note" && !note && kind === "no_result") { /* note optional but encouraged */ }
    var f = cache[cur.id].fixtures.filter(function (x) { return String(x.fixtureID) === String(fid); })[0];
    if (!f) { NS.msg(msg, "That fixture could not be found in the season feed. Reload and try again.", "err"); return; }
    var grp = cache[cur.id].groups.filter(function (g) { return String(g.fixtureGroupIdentifier) === String(f.fixtureGroupIdentifier); })[0];

    var row = {
      fixture_id: f.fixtureID,
      season_file: cur.file,
      division_key: grp ? keyOf(grp.fixtureGroupDesc) : "",
      division_name: grp ? nameOf(grp.fixtureGroupDesc) : "",
      home_team: clean(f.homeTeamName),
      away_team: clean(f.roadTeamName),
      fixture_date: (f.fixtureDate || "").slice(0, 8),
      kind: kind, home_points_adj: ha, away_points_adj: aa,
      public_note: note || null, dc_ref: dc || null,
      show_public: showPublic, active: true, created_by: myEmail()
    };
    save.disabled = true;
    NS.sb.from("log_notes").insert([row]).then(function (r) {
      save.disabled = false;
      if (r.error) { NS.msg(msg, r.error.message, "err"); return; }
      NS.msg(msg, "Saved. It will show on the public log within a few minutes (on the next page load).", "ok");
      loadNotes().then(paint);
    });
  }

  function toggleActive(row) {
    NS.sb.from("log_notes").update({ active: !row.active }).eq("id", row.id).then(function (r) {
      if (r.error) { alert(r.error.message); return; }
      loadNotes().then(paint);
    });
  }

  NS.renderLogNotes = render;
})(window.AC = window.AC || {});
