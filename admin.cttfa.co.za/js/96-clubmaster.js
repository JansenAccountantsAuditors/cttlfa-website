/* CTTLFA admin - Club master record (Data Integrity). Closure over window.AC.
   The register (clubs) is the anchor. club_link records what each external system calls each
   club: Sage (customer code), LeagueRepublic (team names, with B/C/D team labels), the website,
   the DC system and SAFA card labels. club_master_check() compares that against what each
   system holds today and returns unlinked items, links whose item no longer exists at source,
   and every club's names side by side. Editors with club-record rights (can_edit('debtors'))
   link, re-link, mark "not a club" or unlink; every change is logged (club_link_log).
   Status is always a word plus a symbol, never colour alone. */
(function (NS) {
  "use strict";
  var D = null, ONLY_DIFF = false, SHOW_NON = false, Q = "";
  var SYS = ["sage", "leaguerepublic", "website", "dc", "safa"];
  var LBL = { sage: "Sage", leaguerepublic: "LeagueRepublic", website: "Website", dc: "DC system", safa: "SAFA cards" };
  var CTRL = { sage: "controlled", leaguerepublic: "controlled", website: "controlled", dc: "controlled from 2027", safa: "not controlled" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return NS.esc ? NS.esc(s == null ? "" : String(s)) : String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function num(n) { return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function pad(x) { return (x < 10 ? "0" : "") + x; }
  function stamp(s) { if (!s) return "–"; var d = new Date(s); if (isNaN(d)) return esc(s); return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear() + ", " + pad(d.getHours()) + "h" + pad(d.getMinutes()); }
  function root() { return document.getElementById("clubMasterRoot"); }

  function load() {
    var r = root(); if (!r || !NS.sb) return;
    style();
    if (!D) r.innerHTML = '<div class="card"><p class="hint">Loading the club master record&hellip;</p></div>';
    NS.sb.rpc("club_master_check").then(function (res) {
      if (res.error) throw res.error;
      D = res.data || {}; draw();
    }).catch(function (e) { r.innerHTML = '<div class="card"><h3>Club master record</h3><div class="msg err">Could not load: ' + esc(e.message || e) + '</div></div>'; });
  }

  /* first-team base name for LeagueRepublic */
  function lrBase(k) { var m = String(k || "").match(/^(.*?)\s+([A-H])\.?$/); return m ? m[1] : String(k || "").replace(/\.$/, ""); }
  function cellFor(c, sys) {
    var ls = (c.links || []).filter(function (l) { return l.system === sys; });
    if (!ls.length) return { state: "missing", html: '<span class="cm-st bad"><span aria-hidden="true">■</span> Missing</span>' };
    var names, same, extra = "";
    if (sys === "leaguerepublic") {
      var first = ls.filter(function (l) { return !l.label; });
      var shown = first.length ? first : ls;
      names = shown.map(function (l) { return lrBase(l.key); }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      same = names.length === 1 && names[0] === c.name;
      if (ls.length > 1) extra = ' <span class="cm-sub" title="' + esc(ls.map(function (l) { return l.key; }).join(", ")) + '">' + num(ls.length) + ' teams</span>';
    } else {
      names = ls.map(function (l) { return l.name || l.key; });
      same = names.length === 1 && names[0] === c.name;
      if (sys === "sage") extra = ' <span class="cm-sub">' + esc(ls.map(function (l) { return l.key; }).join(", ")) + '</span>';
    }
    var multi = sys !== "leaguerepublic" && sys !== "safa" && ls.length > 1;
    var gone = ls.some(function (l) { return !l.present; });
    var st = gone ? '<span class="cm-st bad"><span aria-hidden="true">■</span> Gone at source</span>'
      : multi ? '<span class="cm-st warn"><span aria-hidden="true">▲</span> ' + num(ls.length) + ' linked</span>'
      : same ? '<span class="cm-st ok"><span aria-hidden="true">●</span> Same</span>'
      : '<span class="cm-st warn"><span aria-hidden="true">▲</span> Differs</span>';
    return { state: gone ? "missing" : (multi || !same) ? "differs" : "same", html: st + (same && !multi ? "" : '<div class="cm-nm">' + esc(names.join(" | ")) + '</div>') + extra };
  }

  function tiles() {
    var s = D.systems || {}, h = '<div class="cm-tiles">';
    SYS.forEach(function (k) {
      var x = s[k] || {}, bad = (Number(x.unlinked) || 0) + (Number(x.gone) || 0);
      h += '<div class="cm-tile"><div class="cm-tl">' + esc(LBL[k]) + ' <span class="cm-sub">' + esc(CTRL[k]) + '</span></div>' +
        '<div class="cm-tv">' + num(x.linked) + ' <span class="cm-sub">of ' + num(x.in_source) + ' linked</span></div>' +
        '<div>' + (bad ? '<span class="cm-st warn"><span aria-hidden="true">▲</span> ' + num(x.unlinked) + ' unlinked' + (x.gone ? ', ' + num(x.gone) + ' gone' : "") + '</span>' : '<span class="cm-st ok"><span aria-hidden="true">●</span> All linked</span>') +
        (x.not_a_club ? ' <span class="cm-sub">' + num(x.not_a_club) + ' not a club</span>' : "") + '</div></div>';
    });
    return h + '</div>';
  }

  function clubOptions(sel) {
    return '<option value="">Choose the club&hellip;</option>' + (D.clubs_select || []).map(function (c) { return '<option value="' + esc(c.id) + '"' + (sel === c.id ? " selected" : "") + '>' + esc(c.name) + (c.type && c.type !== "full" ? " (" + esc(c.type) + ")" : "") + '</option>'; }).join("");
  }

  function attention() {
    var un = D.unlinked || [], gone = D.gone || [], can = !!D.can_edit;
    var multi = [];
    (D.clubs || []).forEach(function (c) {
      ["sage", "website", "dc"].forEach(function (s) { var n = (c.links || []).filter(function (l) { return l.system === s; }); if (n.length > 1) multi.push({ club: c.name, system: s, keys: n.map(function (l) { return l.key; }) }); });
    });
    if (!un.length && !gone.length && !multi.length) return '<div class="cm-ok"><span aria-hidden="true">●</span> Nothing needs attention: every item in every system is linked to a club, and every link still exists at source.</div>';
    var h = '<h4 class="cm-h4">Needs attention</h4><div class="cm-tblwrap"><table class="cm-tbl"><thead><tr><th scope="col">System</th><th scope="col">Item</th><th scope="col">Issue</th>' + (can ? '<th scope="col">Action</th>' : "") + '</tr></thead><tbody>';
    un.forEach(function (u, i) {
      h += '<tr><td>' + esc(LBL[u.system]) + '</td><td><b>' + esc(u.key) + '</b>' + (u.name && u.name !== u.key ? '<div class="cm-sub">' + esc(u.name) + '</div>' : "") + '</td>' +
        '<td><span class="cm-st warn"><span aria-hidden="true">▲</span> Not linked to a club</span>' + (u.guess_name ? '<div class="cm-sub">Suggested: ' + esc(u.guess_name) + '</div>' : "") + '</td>' +
        (can ? '<td class="cm-act"><label class="sr" for="cmSel' + i + '">Club for ' + esc(u.key) + '</label><select id="cmSel' + i + '">' + clubOptions(u.guess) + '</select>' +
          '<button type="button" class="btn gold xs" data-link="' + i + '">Link</button><button type="button" class="btn ghost xs" data-nac="' + i + '">Not a club</button></td>' : "") + '</tr>';
    });
    gone.forEach(function (g, i) {
      h += '<tr><td>' + esc(LBL[g.system]) + '</td><td><b>' + esc(g.key) + '</b><div class="cm-sub">linked to ' + esc(g.club || "–") + '</div></td>' +
        '<td><span class="cm-st bad"><span aria-hidden="true">■</span> No longer exists at source</span><div class="cm-sub">Renamed or removed there; link the new name and remove this one</div></td>' +
        (can ? '<td class="cm-act"><button type="button" class="btn ghost xs" data-unlink="' + esc(g.system) + '|' + esc(g.key) + '">Remove link</button></td>' : "") + '</tr>';
    });
    multi.forEach(function (m) {
      h += '<tr><td>' + esc(LBL[m.system]) + '</td><td><b>' + esc(m.club) + '</b></td><td><span class="cm-st warn"><span aria-hidden="true">▲</span> ' + num(m.keys.length) + ' items linked to one club</span><div class="cm-sub">' + esc(m.keys.join(", ")) + '</div></td>' + (can ? '<td class="cm-act"><span class="cm-sub">Remove the wrong one in the club row below</span></td>' : "") + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function table() {
    var q = (Q || "").trim().toLowerCase();
    var list = (D.clubs || []).filter(function (c) { return (SHOW_NON || c.member) && (!q || c.name.toLowerCase().indexOf(q) >= 0); });
    var rows = list.map(function (c) {
      var cells = SYS.map(function (s) { return cellFor(c, s); });
      var differs = cells.some(function (x, i) { return x.state !== "same" && SYS[i] !== "safa"; });
      return { c: c, cells: cells, differs: differs };
    });
    var nDiff = rows.filter(function (r) { return r.differs; }).length;
    if (ONLY_DIFF) rows = rows.filter(function (r) { return r.differs; });
    var h = '<div class="cm-tools"><input id="cmSearch" type="search" placeholder="Search a club&hellip;" value="' + esc(Q) + '" aria-label="Search clubs">' +
      '<label class="cm-chk"><input type="checkbox" id="cmOnlyDiff"' + (ONLY_DIFF ? " checked" : "") + '> Only clubs with a name difference in a system we control (' + num(nDiff) + ')</label>' +
      '<label class="cm-chk"><input type="checkbox" id="cmShowNon"' + (SHOW_NON ? " checked" : "") + '> Include guest and non-member clubs</label>' +
      '<button type="button" class="btn ghost xs" id="cmCsv">CSV</button></div>';
    h += '<div class="cm-tblwrap cm-main"><table class="cm-tbl"><caption class="sr">Club names by system</caption><thead><tr><th scope="col">Register (master)</th>' +
      SYS.map(function (s) { return '<th scope="col">' + esc(LBL[s]) + '<div class="cm-sub">' + esc(CTRL[s]) + '</div></th>'; }).join("") + '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="6" class="cm-sub">No clubs match.</td></tr>';
    rows.forEach(function (r) {
      h += '<tr><th scope="row"><b>' + esc(r.c.name) + '</b><div class="cm-sub">' + esc(r.c.type || "") + (r.c.member ? "" : " · not an active Sage member") + '</div>' +
        (D.can_edit && (r.c.links || []).length ? '<details class="cm-det"><summary>Links</summary><ul>' + r.c.links.map(function (l) {
          return '<li>' + esc(LBL[l.system]) + ': ' + esc(l.key) + (l.label ? " (" + esc(l.label) + " team)" : "") + ' <button type="button" class="cm-lnk" data-unlink="' + esc(l.system) + '|' + esc(l.key) + '" aria-label="Remove ' + esc(LBL[l.system]) + ' link ' + esc(l.key) + '">remove</button></li>';
        }).join("") + '</ul></details>' : "") + '</th>' +
        r.cells.map(function (x) { return '<td>' + x.html + '</td>'; }).join("") + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function draw() {
    var r = root(); if (!r || !D) return;
    var nac = D.not_a_club || [], log = D.log || [];
    r.innerHTML = '<div class="card cm">' +
      '<h3>Club master record</h3>' +
      '<p class="hint">The register is the master. This shows what every system calls each club, so a rename anywhere shows up here instead of quietly breaking a figure. Names are compared exactly with the register name. For LeagueRepublic the first team is compared; B, C and D teams are linked to their club with a team label. SAFA card labels are shown for reference only, as the LFA does not control them.</p>' +
      tiles() + attention() + table() +
      (nac.length ? '<details class="cm-det"><summary>Marked &ldquo;not a club&rdquo; (' + num(nac.length) + ')</summary><ul>' + nac.map(function (x) { return '<li>' + esc(LBL[x.system]) + ': <b>' + esc(x.key) + '</b>' + (x.name && x.name !== x.key ? " · " + esc(x.name) : "") + (x.note ? ' <span class="cm-sub">' + esc(x.note) + '</span>' : "") + (D.can_edit ? ' <button type="button" class="cm-lnk" data-unlink="' + esc(x.system) + '|' + esc(x.key) + '">undo</button>' : "") + '</li>'; }).join("") + '</ul></details>' : "") +
      '<details class="cm-det"><summary>Change history (' + num(log.length) + ')</summary>' + (log.length ? '<ul>' + log.map(function (g) { return '<li>' + stamp(g.at) + ' · ' + esc(g.by || "") + ' · ' + esc(g.action) + ' ' + esc(LBL[g.system] || g.system) + ' <b>' + esc(g.key) + '</b>' + (g.before ? " from " + esc(g.before) : "") + (g.after ? " to " + esc(g.after) : "") + '</li>'; }).join("") + '</ul>' : '<p class="cm-sub">No manual changes yet. Links were seeded from the reconciled matching on 24 Oct 2026.</p>') + '</details>' +
      '<p class="cm-sub" style="margin-top:10px">Checked ' + stamp(D.as_at) + '. Sources: current Sage snapshot (active customers only), LeagueRepublic fixture mirror (latest season), website club list, DC system club list, SAFA cards in the current cycle.</p>' +
      '</div>';
    wire(r);
  }

  function wire(r) {
    var s = document.getElementById("cmSearch");
    if (s) s.addEventListener("input", function () { Q = s.value; var pos = s.selectionStart; draw(); var n = document.getElementById("cmSearch"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } });
    var od = document.getElementById("cmOnlyDiff"); if (od) od.onchange = function () { ONLY_DIFF = od.checked; draw(); };
    var sn = document.getElementById("cmShowNon"); if (sn) sn.onchange = function () { SHOW_NON = sn.checked; draw(); };
    var cv = document.getElementById("cmCsv"); if (cv) cv.onclick = csv;
    Array.prototype.forEach.call(r.querySelectorAll("[data-link]"), function (b) {
      b.onclick = function () {
        var u = D.unlinked[Number(b.getAttribute("data-link"))], sel = document.getElementById("cmSel" + b.getAttribute("data-link"));
        if (!sel || !sel.value) { msg("Choose the club first."); if (sel) sel.focus(); return; }
        act(b, NS.sb.rpc("club_link_set", { p_system: u.system, p_key: u.key, p_register: sel.value, p_status: "linked", p_note: null }), "Linked " + u.key + ".");
      };
    });
    Array.prototype.forEach.call(r.querySelectorAll("[data-nac]"), function (b) {
      b.onclick = function () {
        var u = D.unlinked[Number(b.getAttribute("data-nac"))];
        act(b, NS.sb.rpc("club_link_set", { p_system: u.system, p_key: u.key, p_register: null, p_status: "not_a_club", p_note: "Marked not a club in Data Integrity" }), "Marked " + u.key + " as not a club.");
      };
    });
    Array.prototype.forEach.call(r.querySelectorAll("[data-unlink]"), function (b) {
      var armed = false;
      b.onclick = function () {
        if (!armed) { armed = true; var t = b.textContent; b.textContent = "click again to confirm"; setTimeout(function () { armed = false; b.textContent = t; }, 5000); return; }
        var p = b.getAttribute("data-unlink").split("|");
        act(b, NS.sb.rpc("club_link_remove", { p_system: p[0], p_key: p.slice(1).join("|") }), "Removed the link.");
      };
    });
  }

  function act(btn, promise, okText) {
    btn.disabled = true;
    promise.then(function (res) { if (res.error) throw res.error; msg(okText); load(); })
      .catch(function (e) { btn.disabled = false; msg("Could not save: " + (e.message || e)); });
  }
  function msg(t) {
    var x = document.getElementById("cmToast");
    if (!x) { x = document.createElement("div"); x.id = "cmToast"; x.className = "cm-toast"; x.setAttribute("role", "status"); x.setAttribute("aria-live", "polite"); document.body.appendChild(x); }
    x.textContent = t; x.classList.add("on"); clearTimeout(msg._h); msg._h = setTimeout(function () { x.classList.remove("on"); }, 4000);
  }

  function csv() {
    var head = ["Register", "Member", "Sage", "Sage code", "LeagueRepublic first team", "LeagueRepublic teams", "Website", "DC system", "SAFA card label"];
    var rows = (D.clubs || []).filter(function (c) { return SHOW_NON || c.member; }).map(function (c) {
      function pick(s) { return (c.links || []).filter(function (l) { return l.system === s; }); }
      var lr = pick("leaguerepublic");
      return [c.name, c.member ? "Yes" : "No", pick("sage").map(function (l) { return l.name; }).join(" | "), pick("sage").map(function (l) { return l.key; }).join(" | "),
        lr.filter(function (l) { return !l.label; }).map(function (l) { return l.key; }).join(" | "), lr.length, pick("website").map(function (l) { return l.key; }).join(" | "),
        pick("dc").map(function (l) { return l.key; }).join(" | "), pick("safa").map(function (l) { return l.key; }).join(" | ")];
    });
    function q(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var text = [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\n");
    try { var b = new Blob([text], { type: "text/csv" }), u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = "CTTLFA club master record.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 500); } catch (e) {}
  }

  function style() {
    if (document.getElementById("cm-style")) return;
    var css = "" +
      "#clubMasterRoot .cm h3{margin:0 0 6px;color:var(--navy)}" +
      "#clubMasterRoot .cm-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:12px 0}" +
      "#clubMasterRoot .cm-tile{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}" +
      "#clubMasterRoot .cm-tl{font-weight:700;font-size:13px;color:var(--navy)}" +
      "#clubMasterRoot .cm-tv{font-size:1.25rem;font-weight:800;margin:4px 0}" +
      "#clubMasterRoot .cm-sub{font-size:11.5px;color:var(--muted);font-weight:400}" +
      "#clubMasterRoot .cm-st{display:inline-flex;gap:5px;align-items:center;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid;white-space:nowrap}" +
      "#clubMasterRoot .cm-st.ok{background:var(--good-bg);color:var(--good);border-color:var(--good-ln)}" +
      "#clubMasterRoot .cm-st.warn{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-ln)}" +
      "#clubMasterRoot .cm-st.bad{background:var(--bad-bg);color:var(--bad);border-color:var(--bad-ln)}" +
      "#clubMasterRoot .cm-nm{font-size:12.5px;margin-top:3px;color:var(--ink)}" +
      "#clubMasterRoot .cm-ok{background:var(--good-bg);border:1px solid var(--good-ln);color:var(--good);border-radius:10px;padding:10px 12px;font-weight:600;font-size:13px;margin:6px 0 12px}" +
      "#clubMasterRoot .cm-h4{margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--navy)}" +
      "#clubMasterRoot .cm-tools{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:16px 0 8px}" +
      "#clubMasterRoot .cm-tools input[type=search]{padding:9px 11px;border:1px solid var(--line);border-radius:9px;font:inherit;min-width:220px}" +
      "#clubMasterRoot .cm-chk{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:var(--muted)}" +
      "#clubMasterRoot .cm-tblwrap{overflow:auto}#clubMasterRoot .cm-main{max-height:680px}" +
      "#clubMasterRoot table.cm-tbl{border-collapse:collapse;width:100%;font-size:13px}" +
      "#clubMasterRoot table.cm-tbl th,#clubMasterRoot table.cm-tbl td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line2)}" +
      "#clubMasterRoot table.cm-tbl thead th{position:sticky;top:0;background:var(--navy);color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;z-index:1}" +
      "#clubMasterRoot table.cm-tbl thead th .cm-sub{color:#c7d2ec;text-transform:none;letter-spacing:0}" +
      "#clubMasterRoot table.cm-tbl tbody th{font-weight:400;min-width:170px}" +
      "#clubMasterRoot .cm-act{display:flex;flex-wrap:wrap;gap:6px;align-items:center}" +
      "#clubMasterRoot .cm-act select{padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:12.5px;max-width:220px}" +
      "#clubMasterRoot .btn.xs{font-size:11px;padding:5px 10px;min-height:30px;border-radius:8px}" +
      "#clubMasterRoot .cm-det{margin-top:10px;font-size:12.5px}#clubMasterRoot .cm-det summary{cursor:pointer;font-weight:700;color:var(--navy)}" +
      "#clubMasterRoot .cm-det ul{margin:6px 0 0;padding-left:18px;line-height:1.7}" +
      "#clubMasterRoot .cm-lnk{background:none;border:0;color:var(--blue);text-decoration:underline;cursor:pointer;font:inherit;font-size:11.5px;padding:0 2px}" +
      "#clubMasterRoot .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
      ".cm-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#071A4A;color:#fff;padding:11px 16px;border-radius:12px;font-size:13.5px;box-shadow:0 12px 30px rgba(7,26,74,.3);z-index:9999;display:none;max-width:calc(100vw - 32px)}" +
      ".cm-toast.on{display:block}";
    var st = document.createElement("style"); st.id = "cm-style"; st.textContent = css; document.head.appendChild(st);
  }

  /* render alongside the existing Data Integrity page */
  var prev = NS.renderIntegrity;
  NS.renderIntegrity = function () { var out = prev ? prev.apply(this, arguments) : undefined; load(); return out; };
  NS.renderClubMaster = load;
})(window.AC = window.AC || {});
