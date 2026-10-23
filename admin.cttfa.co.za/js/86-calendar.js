/* CTTLFA admin - Season & Governance Calendar (phase 2, editable). Closure over
   window.AC. Items live in Supabase (cal_event) and are read through cal_list();
   users with edit rights on the "calendar" area (administrators, and staff with the
   Season Calendar area ticked) add, change, move and remove items through cal_save()
   and cal_remove(). Every change is written to cal_event_log and shown in the change
   history. Governance dates are grounded in the Constitution (Articles 6.2, 6.3, 6.5,
   6.6); public holidays are statutory (Public Holidays Act 36 of 1994); religious
   observances are indicative. Clash flags against holidays are worked out live. */
(function (NS) {
  "use strict";

  function esc(s) { return NS.esc ? NS.esc(s == null ? "" : String(s)) : String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }

  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOWL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var ORD = ["", "1st", "2nd", "3rd", "4th", "last"];

  var CATS = {
    gov:    { label: "Governance",          c: "#184050", bg: "#e7eef2", ln: "#bcd3dc" },
    func:   { label: "Functions & events",  c: "#9a7213", bg: "#faf1dc", ln: "#e8d5a8" },
    ball:   { label: "Football / season",   c: "#296944", bg: "#e3f0e8", ln: "#bcd8c7" },
    course: { label: "Courses",             c: "#6b3f6b", bg: "#efe4ef", ln: "#d6c0d6" },
    ops:    { label: "Operations",          c: "#334155", bg: "#eef1f5", ln: "#cfd8e3" }
  };
  var CAT_ORDER = ["gov", "func", "ball", "course", "ops"];
  var KIND_LBL = { event: "Calendar item", holiday: "Public holiday", observance: "Religious observance" };
  var STATUS_LBL = { confirmed: "Confirmed", proposed: "Proposed", tbc: "Date TBC" };
  var CLASH_CATS = ["gov", "func"]; // meetings and functions are checked against holidays

  var S = { loaded: false, loading: false, err: null, can: false, all: [], log: [] };
  var FILTER = "all", SHOWPAST = false;

  /* ---------- date helpers (all ISO yyyy-mm-dd, UTC arithmetic) ---------- */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function iso(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function parse(s) { var p = String(s).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fromDate(dt) { return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(s, n) { var dt = parse(s); dt.setUTCDate(dt.getUTCDate() + n); return fromDate(dt); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function todayIso() { var n = new Date(); return iso(n.getFullYear(), n.getMonth() + 1, n.getDate()); }
  function longDate(s) { var dt = parse(s); return DOWL[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + MON[dt.getUTCMonth()] + " " + dt.getUTCFullYear(); }
  function shortDate(s) { var dt = parse(s); return DOWS[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + MONS[dt.getUTCMonth()]; }
  function shortDateY(s) { return shortDate(s) + " " + parse(s).getUTCFullYear(); }
  function stamp(ts) {
    if (!ts) return "";
    var d = new Date(ts); if (isNaN(d)) return "";
    return d.getDate() + " " + MONS[d.getMonth()] + " " + d.getFullYear() + ", " + pad(d.getHours()) + "h" + pad(d.getMinutes());
  }
  function daysOf(e) { var out = [], end = e.e || e.d, k = e.d, guard = 0; while (k <= end && guard++ < 400) { out.push(k); k = addDays(k, 1); } return out; }

  /* ---------- data ---------- */
  function norm(r) {
    return { id: r.id, kind: r.kind || "event", d: r.d, e: r.e || null, t: r.title, cat: r.cat || null,
      status: r.status || "proposed", note: r.note || "", flag: r.flag || "", key_label: r.key_label || "",
      obs: r.obs || null, approx: !!r.approx, saved_at: r.saved_at, saved_by: r.saved_by || "", created_by: r.created_by || "" };
  }
  function evs() { return S.all.filter(function (x) { return x.kind === "event"; }); }
  function hols() { return S.all.filter(function (x) { return x.kind === "holiday"; }); }
  function rels() { return S.all.filter(function (x) { return x.kind === "observance"; }); }
  function byId(id) { for (var i = 0; i < S.all.length; i++) if (S.all[i].id === id) return S.all[i]; return null; }
  function sortByDate(a, b) { return a.d < b.d ? -1 : (a.d > b.d ? 1 : (a.t < b.t ? -1 : 1)); }

  function load() {
    if (!NS.sb) { S.err = "The Admin Centre connection is not ready."; render(); return Promise.resolve(); }
    S.loading = true;
    return NS.sb.rpc("cal_list").then(function (r) {
      S.loading = false;
      if (r.error) { S.err = r.error.message || "Could not load the calendar."; render(); return; }
      var j = r.data || {};
      S.can = !!j.can_edit; S.all = (j.events || []).map(norm); S.log = j.log || []; S.err = null; S.loaded = true;
      render();
    }).catch(function (e) { S.loading = false; S.err = (e && e.message) || "Could not load the calendar."; render(); });
  }

  function save(p) {
    return NS.sb.rpc("cal_save", { p: p }).then(function (r) {
      if (r.error) throw new Error(r.error.message || "Save failed");
      return r.data;
    });
  }
  function remove(id) {
    return NS.sb.rpc("cal_remove", { p_id: id }).then(function (r) {
      if (r.error) throw new Error(r.error.message || "Remove failed");
      return r.data;
    });
  }
  function payloadOf(x) {
    return { id: x.id || null, kind: x.kind, d: x.d, e: x.e || null, title: x.t, cat: x.kind === "event" ? x.cat : null,
      status: x.status, note: x.note || null, flag: x.flag || null, key_label: x.key_label || null,
      obs: x.kind === "holiday" ? (x.obs || null) : null, approx: x.kind === "observance" ? !!x.approx : false };
  }

  /* ---------- index and clash detection ---------- */
  function buildIndex() {
    var ix = {};
    function cell(k) { return (ix[k] = ix[k] || { ev: [], starts: [], hol: null, holObs: null, rel: [] }); }
    evs().forEach(function (e) { daysOf(e).forEach(function (k) { cell(k).ev.push(e); }); cell(e.d).starts.push(e); });
    hols().forEach(function (h) { cell(h.d).hol = h; if (h.obs) cell(h.obs).holObs = h; });
    rels().forEach(function (r) { if (!r.e) cell(r.d).rel.push(r); });
    return ix;
  }
  function clashesOf(e, ix) {
    if (e.kind !== "event" || CLASH_CATS.indexOf(e.cat) < 0) return [];
    var out = [];
    daysOf(e).forEach(function (k) {
      var c = ix[k]; if (!c) return;
      if (c.hol) out.push("Falls on " + c.hol.t + " (public holiday)");
      if (c.holObs) out.push("Falls on the observed " + c.holObs.t + " public holiday");
      c.rel.forEach(function (r) { out.push("Falls on " + r.t + (r.approx ? " (indicative)" : "")); });
    });
    return out;
  }

  function monthsSpan() {
    var t = parse(todayIso()), y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
    var endY = 2027, endM = 12;
    evs().forEach(function (e) { var last = parse(e.e || e.d); var ly = last.getUTCFullYear(), lm = last.getUTCMonth() + 1; if (ly > endY || (ly === endY && lm > endM)) { endY = ly; endM = lm; } });
    var out = [], guard = 0;
    while ((y < endY || (y === endY && m <= endM)) && guard++ < 48) { out.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }
  function spanLabel() { var sp = monthsSpan(), last = sp[sp.length - 1]; var dd = new Date(Date.UTC(last[0], last[1], 0)).getUTCDate(); return dd + " " + MON[last[1] - 1] + " " + last[0]; }
  function visible(e) { return FILTER === "all" || e.cat === FILTER; }

  /* ---------- render pieces ---------- */
  function counts() {
    var c = { confirmed: 0, proposed: 0, tbc: 0 }, t = todayIso();
    evs().forEach(function (e) { if ((e.e || e.d) >= t) c[e.status] = (c[e.status] || 0) + 1; });
    return c;
  }
  function lastChange() {
    var l = S.log && S.log[0];
    if (l) return "Last changed " + esc(stamp(l.at)) + " by " + esc(l.by || "unknown");
    return "Migrated from the static calendar compiled 14 October 2026; no changes since";
  }

  function provenance() {
    var c = counts();
    return '<div class="cal-prov">' +
      '<div><b>Cape Town Tygerberg Local Football Association</b></div>' +
      '<div>Season &amp; governance calendar &middot; present to ' + esc(spanLabel()) + '</div>' +
      '<div>Basis: dates for Management Committee sign-off, maintained by the office in the Admin Centre. Governance dates per the Constitution (Articles 6.2, 6.3, 6.5, 6.6); public holidays statutory under the Public Holidays Act 36 of 1994; religious observances indicative.</div>' +
      '<div>Upcoming items: <b>' + c.confirmed + ' confirmed</b> &middot; ' + c.proposed + ' proposed &middot; ' + c.tbc + ' date TBC &middot; ' + lastChange() + '</div>' +
      '</div>';
  }

  function keyTiles() {
    var list = evs().filter(function (e) { return e.key_label; }).sort(sortByDate).slice(0, 8);
    if (!list.length) return "";
    return '<div class="cal-kts">' + list.map(function (e) {
      var c = CATS[e.cat] || CATS.ops;
      return '<div class="cal-kt" style="border-top:3px solid ' + c.c + '"><div class="l">' + esc(e.key_label) + (e.status !== "confirmed" ? ' <span class="cal-kt-s">' + esc(STATUS_LBL[e.status].toLowerCase()) + '</span>' : "") + '</div><div class="n">' + esc(shortDate(e.d)) + '</div><div class="y">' + parse(e.d).getUTCFullYear() + '</div></div>';
    }).join("") + '</div>';
  }

  function legend() {
    var h = '<div class="cal-legend">';
    CAT_ORDER.forEach(function (k) { var c = CATS[k]; h += '<span class="cal-lg"><i style="background:' + c.c + '"></i>' + esc(c.label) + '</span>'; });
    h += '<span class="cal-lg"><i class="hol"></i>Public holiday (H)</span>';
    h += '<span class="cal-lg"><i class="relig"></i>Religious observance (R)</span>';
    h += '</div>';
    return h;
  }

  function filterBar() {
    var h = '<div class="cal-tools no-print">';
    h += '<div class="seg cal-seg" role="group" aria-label="Filter calendar by category">';
    h += '<button type="button" data-f="all" aria-pressed="' + (FILTER === "all") + '"' + (FILTER === "all" ? ' class="on"' : "") + '>All</button>';
    CAT_ORDER.forEach(function (k) { h += '<button type="button" data-f="' + k + '" aria-pressed="' + (FILTER === k) + '"' + (FILTER === k ? ' class="on"' : "") + '>' + esc(CATS[k].label) + '</button>'; });
    h += '</div>';
    h += '<div class="cal-bar">';
    if (S.can) h += '<button type="button" class="btn gold sm" id="calAdd">+ Add item</button>';
    h += '<button type="button" class="btn ghost sm" id="calPrint">Print / save as PDF</button>';
    h += '</div></div>';
    return h;
  }

  function monthGrid(ix) {
    var h = '<div class="cal-grid">', t = todayIso();
    monthsSpan().forEach(function (ym) {
      var y = ym[0], m = ym[1], first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      h += '<div class="cal-m"><h4>' + MON[m - 1] + ' <span>' + y + '</span></h4>';
      h += '<div class="cal-dow" aria-hidden="true">' + ["M", "T", "W", "T", "F", "S", "S"].map(function (x) { return "<span>" + x + "</span>"; }).join("") + '</div>';
      h += '<div class="cal-days">';
      var lead = (first + 6) % 7; // Monday-first
      for (var i = 0; i < lead; i++) h += '<span class="cal-d e" aria-hidden="true"></span>';
      for (var dd = 1; dd <= days; dd++) {
        var k = iso(y, m, dd), cell = ix[k], wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
        var cls = "cal-d", title = DOWL[wd] + " " + dd + " " + MON[m - 1] + " " + y, dots = "", hmark = "";
        var list = cell ? cell.ev.filter(visible) : [];
        if (cell && cell.hol) { cls += " hol"; title += ". " + cell.hol.t + " (public holiday)"; hmark = "H"; }
        if (cell && cell.holObs) { cls += " holobs"; title += ". " + cell.holObs.t + " observed"; hmark = "H"; }
        if (cell && cell.rel.length) { cls += " rel"; title += ". " + cell.rel.map(function (r) { return r.t; }).join("; "); if (!hmark) hmark = "R"; }
        if (wd === 0 || wd === 6) cls += " wk";
        if (k === t) cls += " today";
        if (list.length) {
          cls += cell.starts.filter(visible).length ? " has" : " cont";
          var cats = [];
          list.forEach(function (e) { if (cats.indexOf(e.cat) < 0) cats.push(e.cat); });
          dots = '<i class="cal-dots" aria-hidden="true">' + cats.slice(0, 3).map(function (c) { return '<b style="background:' + (CATS[c] || CATS.ops).c + '"></b>'; }).join("") + '</i>';
          title += ". " + list.map(function (e) { return e.t; }).join("; ");
        }
        var interactive = S.can || list.length || (cell && (cell.hol || cell.holObs || cell.rel.length));
        var attrs = ' data-date="' + k + '"';
        var hasContent = list.length || (cell && (cell.hol || cell.holObs || cell.rel.length));
        if (interactive) attrs += ' role="button" tabindex="' + (hasContent ? "0" : "-1") + '" aria-label="' + esc(title + (S.can ? ". Open to add or edit" : ". Open for detail")) + '"';
        if (S.can && list.length) attrs += ' draggable="true"';
        h += '<span class="' + cls + '"' + attrs + ' title="' + esc(title) + '">' + dd + (hmark ? '<em aria-hidden="true">' + hmark + '</em>' : "") + dots + '</span>';
      }
      h += '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function statusChip(s) {
    if (s === "confirmed") return '<span class="cal-st ok">Confirmed</span>';
    if (s === "tbc") return '<span class="cal-st tbc">Date TBC</span>';
    return '<span class="cal-st prop">Proposed</span>';
  }
  function catChip(cat) { var c = CATS[cat] || CATS.ops; return '<span class="cal-cat" style="background:' + c.bg + ';color:' + c.c + ';border-color:' + c.ln + '">' + esc(c.label) + '</span>'; }

  function agenda(ix) {
    var t = todayIso();
    var list = evs().filter(visible).filter(function (e) { return SHOWPAST || (e.e || e.d) >= t; }).sort(sortByDate);
    var past = evs().filter(visible).filter(function (e) { return (e.e || e.d) < t; }).length;
    var cols = S.can ? 7 : 6;
    var h = '<div class="card cal-ag"><div class="cal-aghd"><h3>Full schedule</h3>';
    if (past) h += '<label class="cal-past no-print"><input type="checkbox" id="calShowPast"' + (SHOWPAST ? " checked" : "") + '> Show ' + past + ' past item' + (past === 1 ? "" : "s") + '</label>';
    h += '</div><p class="hint">Every item in date order. ⚑ marks a point for the Management Committee to settle; clash flags against public holidays and observances are worked out automatically.</p>';
    var curKey = "";
    h += '<div class="cal-tabwrap"><table class="cal-tab"><caption>CTTLFA season &amp; governance schedule, present to ' + esc(spanLabel()) + '</caption>' +
      '<thead><tr><th scope="col">Date</th><th scope="col">Day</th><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Notes</th>' + (S.can ? '<th scope="col" class="no-print"><span class="sr">Actions</span></th>' : "") + '</tr></thead><tbody>';
    if (!list.length) h += '<tr><td colspan="' + cols + '" class="note">No items match this filter.</td></tr>';
    list.forEach(function (e) {
      var dt = parse(e.d), key = dt.getUTCFullYear() + "-" + dt.getUTCMonth();
      if (key !== curKey) { curKey = key; h += '<tr class="cal-mh"><th colspan="' + cols + '" scope="colgroup">' + MON[dt.getUTCMonth()] + " " + dt.getUTCFullYear() + '</th></tr>'; }
      var span = e.e ? (" &ndash; " + esc(shortDate(e.e))) : "";
      var note = esc(e.note || "");
      if (e.flag) note += ' <span class="cal-flag">⚑ ' + esc(e.flag) + '</span>';
      clashesOf(e, ix).forEach(function (c) { note += ' <span class="cal-flag auto">⚑ ' + esc(c) + ' &mdash; consider moving</span>'; });
      h += '<tr' + ((e.e || e.d) < t ? ' class="past"' : "") + '>' +
        '<td class="nowrap">' + dt.getUTCDate() + " " + MONS[dt.getUTCMonth()] + span + '</td>' +
        '<td class="nowrap">' + DOWS[dt.getUTCDay()] + '</td>' +
        '<td><b>' + esc(e.t) + '</b>' + (e.key_label ? ' <span class="cal-key" title="Shown as a key date">key date</span>' : "") + '</td>' +
        '<td>' + catChip(e.cat) + '</td>' +
        '<td>' + statusChip(e.status) + '</td>' +
        '<td class="note">' + note + '</td>' +
        (S.can ? '<td class="no-print nowrap"><button type="button" class="btn ghost xs" data-edit="' + esc(e.id) + '" aria-label="Edit ' + esc(e.t) + ' on ' + esc(shortDateY(e.d)) + '">Edit</button></td>' : "") +
        '</tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  function holidaysCard() {
    var h = '<div class="card"><div class="cal-aghd"><h3>Public holidays &amp; observances</h3>';
    if (S.can) h += '<div class="cal-bar no-print"><button type="button" class="btn ghost sm" data-addkind="holiday">+ Public holiday</button><button type="button" class="btn ghost sm" data-addkind="observance">+ Observance</button></div>';
    h += '</div><p class="hint">Statutory public holidays (Public Holidays Act 36 of 1994) and major religious observances. A public holiday on a Sunday is observed the following Monday. Religious dates marked &ldquo;indicative&rdquo; may shift by a day.</p>';
    h += '<div class="cal-two">';
    h += '<div><h4 class="cal-sub">Public holidays</h4><ul class="cal-ul">';
    hols().sort(sortByDate).forEach(function (x) {
      h += '<li><b>' + esc(x.t) + '</b><span>' + esc(longDate(x.d)) + (x.obs ? esc(", observed " + longDate(x.obs)) : "") +
        (S.can ? ' <button type="button" class="cal-lnk no-print" data-edit="' + esc(x.id) + '" aria-label="Edit ' + esc(x.t) + '">Edit</button>' : "") + '</span></li>';
    });
    h += '</ul></div>';
    h += '<div><h4 class="cal-sub">Religious observances</h4><ul class="cal-ul">';
    rels().sort(sortByDate).forEach(function (x) {
      var when = x.e ? (longDate(x.d) + " to " + longDate(x.e)) : longDate(x.d);
      h += '<li><b>' + esc(x.t) + (x.approx ? ' <span class="cal-ind">indicative</span>' : "") + '</b><span>' + esc(when) +
        (S.can ? ' <button type="button" class="cal-lnk no-print" data-edit="' + esc(x.id) + '" aria-label="Edit ' + esc(x.t) + '">Edit</button>' : "") + '</span></li>';
    });
    h += '</ul></div>';
    h += '</div></div>';
    return h;
  }

  function governanceCard() {
    return '<div class="card cal-gov"><h3>Governance notes for sign-off</h3>' +
      '<p class="hint">Where the proposed cadence departs from the Constitution, both are shown so the Management Committee signs off knowingly.</p>' +
      '<ul class="cal-notes">' +
      '<li><b>Management Committee meetings.</b> Proposed as monthly on the 2nd Wednesday. The Constitution (Article 6.6.1) provides for Mancom meetings on the <b>first Wednesday of February to September</b>, or whenever deemed necessary. The monthly 2nd-Wednesday cadence is a proposed enhancement for Mancom to adopt.</li>' +
      '<li><b>General club meetings.</b> Proposed as three, quarterly, on the 3rd Wednesday (March, June, September). The Constitution (Article 6.3.1) provides for General Meetings on the <b>3rd Wednesday of March, May, July and September</b> (four). Confirm whether to retain four or adopt three.</li>' +
      '<li><b>AGM.</b> Must be held during November (Article 6.2.1), with 14 days written notice and the Treasurer\'s report drawn to 30 September (Articles 6.2.4, 6.2.7.11).</li>' +
      '<li><b>Clashes.</b> Meetings and functions that fall on a public holiday (or its observed Monday) or a religious observance are flagged automatically in the schedule. Move the item, or record the reason it stays.</li>' +
      '<li><b>Football dates.</b> LeagueRepublic remains the system of record for fixtures; the season kick-off and knockout dates here are the planning dates.</li>' +
      '</ul></div>';
  }

  function fieldLbl(f) { return ({ d: "date", e: "end date", title: "title", cat: "category", status: "status", note: "notes", flag: "Mancom point", key_label: "key date label", obs: "observed date", approx: "indicative", kind: "type" })[f] || f; }
  function changeSummary(l) {
    var b = l.before || {}, a = l.after || {}, name = (a.title || b.title || "item");
    if (l.action === "add") return 'Added <b>' + esc(name) + '</b> on ' + esc(a.d ? shortDateY(a.d) : "");
    if (l.action === "remove") return 'Removed <b>' + esc(name) + '</b> (' + esc(b.d ? shortDateY(b.d) : "") + ')';
    var parts = [];
    ["d", "e", "title", "cat", "status", "note", "flag", "key_label", "obs", "approx", "kind"].forEach(function (f) {
      var x = b[f] == null ? "" : b[f], y = a[f] == null ? "" : a[f];
      if (String(x) === String(y)) return;
      if (f === "d" || f === "e" || f === "obs") parts.push(fieldLbl(f) + " " + (x ? shortDateY(x) : "none") + " → " + (y ? shortDateY(y) : "none"));
      else if (f === "status") parts.push("status " + (STATUS_LBL[x] || x) + " → " + (STATUS_LBL[y] || y));
      else if (f === "cat") parts.push("category " + ((CATS[x] || {}).label || x || "none") + " → " + ((CATS[y] || {}).label || y || "none"));
      else if (f === "title") parts.push('title "' + x + '" → "' + y + '"');
      else parts.push(fieldLbl(f) + " changed");
    });
    return 'Changed <b>' + esc(name) + '</b>: ' + esc(parts.join("; ") || "no field changes");
  }
  function historyCard() {
    var h = '<div class="card cal-hist no-print"><details><summary><h3>Change history</h3><span class="hint">' + (S.log.length ? S.log.length + ' most recent change' + (S.log.length === 1 ? "" : "s") : "No changes recorded yet") + '</span></summary>';
    if (S.log.length) {
      h += '<div class="cal-tabwrap"><table class="cal-tab"><thead><tr><th scope="col">When</th><th scope="col">By</th><th scope="col">Change</th></tr></thead><tbody>';
      S.log.forEach(function (l) { h += '<tr><td class="nowrap">' + esc(stamp(l.at)) + '</td><td class="nowrap">' + esc(l.by || "") + '</td><td class="note">' + changeSummary(l) + '</td></tr>'; });
      h += '</tbody></table></div>';
    }
    h += '</details></div>';
    return h;
  }

  /* ---------- main ---------- */
  function render() {
    var root = document.getElementById("calRoot");
    if (!root) return;
    injectStyle();
    if (!S.loaded) {
      root.innerHTML = S.err
        ? '<div class="card"><h3>Season calendar</h3><div class="msg err">Could not load the calendar: ' + esc(S.err) + '</div><button type="button" class="btn ghost sm" id="calRetry" style="margin-top:10px">Try again</button></div>'
        : '<div class="card"><p class="hint">Loading the season calendar&hellip;</p></div>';
      var rb = document.getElementById("calRetry"); if (rb) rb.addEventListener("click", function () { S.err = null; render(); load(); });
      return;
    }
    var ix = buildIndex();
    var h = "";
    h += '<div class="card cal-head">' +
      '<div class="cal-badge">For Management Committee sign-off</div>' +
      '<h2>Season &amp; Governance Calendar</h2>' +
      '<p class="hint">' + (S.can
        ? 'You can edit this calendar. Click a day to add or change its items, drag a day with an item onto another day to move it, or use <b>Edit</b> in the schedule. Every change is recorded in the change history at the bottom.'
        : 'Read-only for your account. The office maintains these dates; changes appear here as soon as they are saved.') + '</p>' +
      provenance() + keyTiles() + '</div>';
    if (S.err) h += '<div class="msg err">' + esc(S.err) + '</div>';
    h += '<div class="card">' + legend() + filterBar() +
      '<p class="hint" style="margin:10px 0 0">Event days show a dot per category; &ldquo;H&rdquo; marks a public holiday and &ldquo;R&rdquo; a religious observance.' + (S.can ? ' Drag a dotted day onto another day to move its item.' : "") + '</p>' +
      monthGrid(ix) + '</div>';
    h += agenda(ix);
    h += governanceCard();
    h += holidaysCard();
    h += historyCard();
    root.innerHTML = h;
    wire(root);
  }

  function wire(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".cal-seg button"), function (b) {
      b.addEventListener("click", function () { FILTER = b.getAttribute("data-f") || "all"; render(); });
    });
    var pb = document.getElementById("calPrint"); if (pb) pb.addEventListener("click", function () { window.print(); });
    var sp = document.getElementById("calShowPast"); if (sp) sp.addEventListener("change", function () { SHOWPAST = sp.checked; render(); });
    var ab = document.getElementById("calAdd"); if (ab) ab.addEventListener("click", function () { openEditor(null, { d: firstFutureWeekday() }); });
    Array.prototype.forEach.call(root.querySelectorAll("[data-addkind]"), function (b) {
      b.addEventListener("click", function () { openEditor(null, { kind: b.getAttribute("data-addkind"), d: todayIso() }); });
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-edit]"), function (b) {
      b.addEventListener("click", function () { var x = byId(b.getAttribute("data-edit")); if (x) openEditor(x); });
    });
    var grid = root.querySelector(".cal-grid");
    if (!grid) return;
    grid.addEventListener("click", function (ev) { var c = ev.target.closest(".cal-d[role=button]"); if (c) openDay(c.getAttribute("data-date")); });
    grid.addEventListener("keydown", function (ev) {
      var c = ev.target.closest(".cal-d[role=button]"); if (!c) return;
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openDay(c.getAttribute("data-date")); }
    });
    if (!S.can) return;
    grid.addEventListener("dragstart", function (ev) {
      var c = ev.target.closest(".cal-d[draggable=true]"); if (!c) return;
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", c.getAttribute("data-date")); } catch (e) {}
      c.classList.add("dragging");
    });
    grid.addEventListener("dragend", function () { Array.prototype.forEach.call(grid.querySelectorAll(".dragging,.dropok"), function (x) { x.classList.remove("dragging"); x.classList.remove("dropok"); }); });
    grid.addEventListener("dragover", function (ev) {
      var c = ev.target.closest(".cal-d[data-date]"); if (!c) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
      Array.prototype.forEach.call(grid.querySelectorAll(".dropok"), function (x) { if (x !== c) x.classList.remove("dropok"); });
      c.classList.add("dropok");
    });
    grid.addEventListener("drop", function (ev) {
      var c = ev.target.closest(".cal-d[data-date]"); if (!c) return;
      ev.preventDefault();
      var src = ""; try { src = ev.dataTransfer.getData("text/plain"); } catch (e) {}
      var dst = c.getAttribute("data-date");
      if (!src || !dst || src === dst) return;
      var ix = buildIndex(), list = ((ix[src] && ix[src].ev) || []).filter(visible);
      if (!list.length) return;
      if (list.length === 1) moveItem(list[0], diffDays(src, dst));
      else openDay(src, { moveTo: dst });
    });
  }

  function firstFutureWeekday() { var k = addDays(todayIso(), 1); while (parse(k).getUTCDay() === 0 || parse(k).getUTCDay() === 6) k = addDays(k, 1); return k; }

  /* ---------- moving ---------- */
  function moveItem(x, delta) {
    if (!delta) return;
    var before = { d: x.d, e: x.e };
    var p = payloadOf(x); p.d = addDays(x.d, delta); if (x.e) p.e = addDays(x.e, delta);
    toast("Moving " + x.t + "…");
    save(p).then(function () {
      toast("Moved " + x.t + " to " + shortDateY(p.d) + ".", { label: "Undo", fn: function () {
        var q = payloadOf(x); q.d = before.d; q.e = before.e;
        save(q).then(function () { toast("Move undone."); return load(); }).catch(function (e) { toast("Could not undo: " + e.message, null, true); });
      } });
      return load();
    }).catch(function (e) { toast("Could not move: " + e.message, null, true); load(); });
  }

  /* ---------- dialog shell ---------- */
  function dlg() {
    var d = document.getElementById("calDlg");
    if (!d) {
      d = document.createElement("dialog"); d.id = "calDlg"; d.className = "cal-dlg"; d.setAttribute("aria-labelledby", "calDlgH");
      document.body.appendChild(d);
      d.addEventListener("click", function (ev) { if (ev.target === d) d.close(); });
    }
    return d;
  }
  function openDlg(html) {
    var d = dlg(); d.innerHTML = html;
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
    var x = d.querySelector("[data-close]"); if (x) x.addEventListener("click", function () { d.close(); });
    return d;
  }

  function itemLine(x) {
    var when = x.e ? (shortDate(x.d) + " – " + shortDateY(x.e)) : shortDateY(x.d);
    var meta = x.kind === "event" ? (catChip(x.cat) + " " + statusChip(x.status)) : '<span class="cal-cat" style="background:#fbecea;color:#9a3130;border-color:#e3b9b4">' + esc(KIND_LBL[x.kind]) + '</span>';
    return '<div class="cal-dl"><div><b>' + esc(x.t) + '</b><div class="cal-dlm">' + esc(when) + ' ' + meta + '</div>' + (x.note ? '<div class="cal-dln">' + esc(x.note) + '</div>' : "") + '</div>';
  }

  function openDay(k, opt) {
    opt = opt || {};
    var ix = buildIndex(), c = ix[k] || { ev: [], rel: [] };
    var items = c.ev.filter(visible).slice();
    if (c.hol) items.push(c.hol); if (c.holObs && c.holObs !== c.hol) items.push(c.holObs);
    (c.rel || []).forEach(function (r) { items.push(r); });
    var h = '<form method="dialog" class="cal-dlgf"><h3 id="calDlgH">' + (opt.moveTo ? "Move which item to " + esc(longDate(opt.moveTo)) + "?" : esc(longDate(k))) + '</h3>';
    if (!items.length) h += '<p class="hint">Nothing is scheduled on this day.</p>';
    items.forEach(function (x) {
      h += itemLine(x);
      if (S.can) {
        if (opt.moveTo && x.kind === "event") h += '<button type="button" class="btn gold xs" data-mv="' + esc(x.id) + '">Move here</button>';
        else if (!opt.moveTo) h += '<button type="button" class="btn ghost xs" data-ed="' + esc(x.id) + '" aria-label="Edit ' + esc(x.t) + '">Edit</button>';
      }
      h += '</div>';
    });
    h += '<div class="cal-dlgb">';
    if (S.can && !opt.moveTo) h += '<button type="button" class="btn gold sm" id="calDayAdd">+ Add item on this day</button>';
    h += '<button type="button" class="btn ghost sm" data-close>Close</button></div></form>';
    var d = openDlg(h);
    Array.prototype.forEach.call(d.querySelectorAll("[data-ed]"), function (b) { b.addEventListener("click", function () { var x = byId(b.getAttribute("data-ed")); if (x) openEditor(x); }); });
    Array.prototype.forEach.call(d.querySelectorAll("[data-mv]"), function (b) { b.addEventListener("click", function () { var x = byId(b.getAttribute("data-mv")); d.close(); if (x) moveItem(x, diffDays(k, opt.moveTo)); }); });
    var ad = document.getElementById("calDayAdd"); if (ad) ad.addEventListener("click", function () { openEditor(null, { d: k }); });
  }

  /* ---------- repeats ---------- */
  function isLast(k) { var dt = parse(k), dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate(); return dt.getUTCDate() + 7 > dim; }
  function nthWeekday(y, m, wd, n) { // n 1..4, or 5 = last
    if (n === 5) { var last = new Date(Date.UTC(y, m, 0)); while (last.getUTCDay() !== wd) last.setUTCDate(last.getUTCDate() - 1); return fromDate(last); }
    var dt = new Date(Date.UTC(y, m - 1, 1)); while (dt.getUTCDay() !== wd) dt.setUTCDate(dt.getUTCDate() + 1);
    dt.setUTCDate(dt.getUTCDate() + 7 * (n - 1)); return dt.getUTCMonth() === m - 1 ? fromDate(dt) : null;
  }
  function repeatDates(start, mode, until) {
    var out = [start];
    if (!mode || mode === "none" || !until || until <= start) return out;
    var dt = parse(start), wd = dt.getUTCDay(), dom = dt.getUTCDate(), n = isLast(start) && Math.ceil(dom / 7) >= 5 ? 5 : Math.ceil(dom / 7);
    if (mode === "weekly") { var k = addDays(start, 7); while (k <= until && out.length < 60) { out.push(k); k = addDays(k, 7); } return out; }
    var y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1;
    for (var i = 0; i < 60; i++) {
      m++; if (m > 12) { m = 1; y++; }
      var cand = null;
      if (mode === "monthly_nth") cand = nthWeekday(y, m, wd, n);
      else if (mode === "monthly_last") cand = nthWeekday(y, m, wd, 5);
      else if (mode === "monthly_date") { var dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); cand = dom <= dim ? iso(y, m, dom) : null; }
      if (!cand) continue;
      if (cand > until) break;
      out.push(cand);
      if (out.length >= 60) break;
    }
    return out;
  }
  function repeatOptions(k) {
    if (!k) return "";
    var dt = parse(k), wd = DOWL[dt.getUTCDay()], n = Math.ceil(dt.getUTCDate() / 7);
    var o = '<option value="none">Does not repeat</option><option value="weekly">Every week on ' + wd + '</option>';
    if (n <= 4) o += '<option value="monthly_nth">Every month on the ' + ORD[n] + ' ' + wd + '</option>';
    if (isLast(k)) o += '<option value="monthly_last">Every month on the last ' + wd + '</option>';
    o += '<option value="monthly_date">Every month on the ' + dt.getUTCDate() + ordSuffix(dt.getUTCDate()) + '</option>';
    return o;
  }
  function ordSuffix(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

  /* ---------- editor ---------- */
  function openEditor(x, seed) {
    var isNew = !x; seed = seed || {};
    var it = x ? JSON.parse(JSON.stringify(x)) : { id: null, kind: seed.kind || "event", d: seed.d || todayIso(), e: null, t: "", cat: seed.cat || "gov", status: "proposed", note: "", flag: "", key_label: "", obs: null, approx: false };
    var h = '<form class="cal-dlgf" id="calEdF" novalidate><h3 id="calDlgH">' + (isNew ? "Add " + esc(KIND_LBL[it.kind].toLowerCase()) : "Edit " + esc(it.t)) + '</h3>';
    h += '<div class="cal-fg">';
    h += '<label class="w2">Type<select id="cfKind">' + ["event", "holiday", "observance"].map(function (k) { return '<option value="' + k + '"' + (it.kind === k ? " selected" : "") + '>' + KIND_LBL[k] + '</option>'; }).join("") + '</select></label>';
    h += '<label class="w2">Title<input id="cfTitle" type="text" maxlength="160" required value="' + esc(it.t) + '" autocomplete="off"></label>';
    h += '<label>Date (start)<input id="cfD" type="date" required value="' + esc(it.d) + '"></label>';
    h += '<label><span class="lt">End date <span class="opt">(multi-day only)</span></span><input id="cfE" type="date" value="' + esc(it.e || "") + '"></label>';
    h += '<label class="ev">Category<select id="cfCat">' + CAT_ORDER.map(function (k) { return '<option value="' + k + '"' + (it.cat === k ? " selected" : "") + '>' + esc(CATS[k].label) + '</option>'; }).join("") + '</select></label>';
    h += '<label class="ev">Status<select id="cfStatus">' + ["proposed", "confirmed", "tbc"].map(function (k) { return '<option value="' + k + '"' + (it.status === k ? " selected" : "") + '>' + STATUS_LBL[k] + '</option>'; }).join("") + '</select></label>';
    h += '<label class="hol"><span class="lt">Observed on <span class="opt">(if the holiday falls on a Sunday)</span></span><input id="cfObs" type="date" value="' + esc(it.obs || "") + '"></label>';
    h += '<label class="rel cal-chk"><input id="cfApprox" type="checkbox"' + (it.approx ? " checked" : "") + '> Indicative date (may shift on sighting)</label>';
    h += '<label class="w2">Notes<textarea id="cfNote" rows="3" maxlength="1000">' + esc(it.note) + '</textarea></label>';
    h += '<label class="w2 ev"><span class="lt">Point for Mancom <span class="opt">(shows as ⚑ in the schedule)</span></span><input id="cfFlag" type="text" maxlength="300" value="' + esc(it.flag) + '"></label>';
    h += '<label class="w2 ev"><span class="lt">Key date label <span class="opt">(fill in to show it as a tile at the top, e.g. &ldquo;AGM 2027&rdquo;)</span></span><input id="cfKey" type="text" maxlength="40" value="' + esc(it.key_label) + '"></label>';
    if (isNew) {
      h += '<label class="ev rep">Repeat<select id="cfRep">' + repeatOptions(it.d) + '</select></label>';
      h += '<label class="ev rep">Repeat until<input id="cfUntil" type="date" value=""></label>';
      h += '<p class="w2 ev rep hint" id="cfRepInfo" aria-live="polite"></p>';
    }
    h += '</div>';
    h += '<div class="msg err" id="cfErr" role="alert" hidden></div>';
    if (!isNew) h += '<p class="hint cal-who">' + (/^Migrated/.test(it.saved_by || "") ? "Unchanged since it was migrated from the static calendar (compiled 14 October 2026)." : ("Last saved " + esc(stamp(it.saved_at)) + (it.saved_by ? " by " + esc(it.saved_by) : "") + ".")) + '</p>';
    h += '<div class="cal-dlgb">';
    if (!isNew) h += '<button type="button" class="btn red sm" id="cfDel">Remove</button><button type="button" class="btn ghost sm" id="cfDup">Duplicate</button><span class="sp"></span>';
    h += '<button type="button" class="btn ghost sm" data-close>Cancel</button><button type="submit" class="btn gold sm" id="cfSave">' + (isNew ? "Add" : "Save changes") + '</button></div>';
    h += '</form>';
    var d = openDlg(h);
    var $ = function (id) { return document.getElementById(id); };

    function syncKind() {
      var k = $("cfKind").value;
      Array.prototype.forEach.call(d.querySelectorAll(".ev"), function (el) { el.hidden = k !== "event"; });
      Array.prototype.forEach.call(d.querySelectorAll(".hol"), function (el) { el.hidden = k !== "holiday"; });
      Array.prototype.forEach.call(d.querySelectorAll(".rel"), function (el) { el.hidden = k !== "observance"; });
      var hh = $("calDlgH"); if (isNew && hh) hh.textContent = "Add " + KIND_LBL[k].toLowerCase();
    }
    function repInfo() {
      if (!isNew) return;
      var mode = $("cfRep") ? $("cfRep").value : "none", until = $("cfUntil") ? $("cfUntil").value : "";
      var info = $("cfRepInfo"); if (!info) return;
      if (mode === "none") { info.textContent = ""; $("cfUntil").disabled = true; return; }
      $("cfUntil").disabled = false;
      if (!until) { info.textContent = "Choose the last date for the series."; return; }
      var ds = repeatDates($("cfD").value, mode, until);
      info.textContent = "Creates " + ds.length + " item" + (ds.length === 1 ? "" : "s") + ": " + ds.slice(0, 6).map(shortDate).join(", ") + (ds.length > 6 ? " … " + shortDateY(ds[ds.length - 1]) : "") + ".";
    }
    $("cfKind").addEventListener("change", syncKind);
    $("cfD").addEventListener("change", function () {
      var rep = $("cfRep"); if (rep && $("cfD").value) { var cur = rep.value; rep.innerHTML = repeatOptions($("cfD").value); rep.value = rep.querySelector('option[value="' + cur + '"]') ? cur : "none"; }
      repInfo();
    });
    if ($("cfRep")) { $("cfRep").addEventListener("change", repInfo); $("cfUntil").addEventListener("change", repInfo); }
    syncKind(); repInfo();
    setTimeout(function () { var t = $("cfTitle"); if (t) t.focus(); }, 30);

    function collect() {
      var k = $("cfKind").value;
      return { id: it.id, kind: k, d: $("cfD").value, e: $("cfE").value || null, t: $("cfTitle").value.trim(),
        cat: k === "event" ? $("cfCat").value : null, status: k === "event" ? $("cfStatus").value : "confirmed",
        note: $("cfNote").value.trim(), flag: k === "event" ? $("cfFlag").value.trim() : "", key_label: k === "event" ? $("cfKey").value.trim() : "",
        obs: k === "holiday" ? ($("cfObs").value || null) : null, approx: k === "observance" ? $("cfApprox").checked : false };
    }
    function fail(m, focusId) { var e = $("cfErr"); e.textContent = m; e.hidden = false; if (focusId && $(focusId)) $(focusId).focus(); }
    function busy(on) { Array.prototype.forEach.call(d.querySelectorAll("button"), function (b) { b.disabled = on; }); }

    $("calEdF").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = collect();
      if (!v.t) return fail("Give the item a title.", "cfTitle");
      if (!v.d) return fail("Choose a date.", "cfD");
      if (v.e && v.e < v.d) return fail("The end date is before the start date.", "cfE");
      if (v.e === v.d) v.e = null;
      var dates = [v.d], span = v.e ? diffDays(v.d, v.e) : 0;
      if (isNew && v.kind === "event" && $("cfRep") && $("cfRep").value !== "none") {
        if (!$("cfUntil").value) return fail("Choose the last date for the repeating series.", "cfUntil");
        dates = repeatDates(v.d, $("cfRep").value, $("cfUntil").value);
      }
      busy(true);
      var i = 0;
      (function next() {
        if (i >= dates.length) { d.close(); toast(isNew ? ("Added " + (dates.length > 1 ? dates.length + " items" : v.t) + ".") : ("Saved " + v.t + ".")); load(); return; }
        var p = payloadOf(v); p.d = dates[i]; p.e = span ? addDays(dates[i], span) : null;
        if (i > 0) p.id = null;
        save(p).then(function () { i++; next(); }).catch(function (e) {
          busy(false); fail((i ? "Saved " + i + " of " + dates.length + ". " : "") + "Could not save: " + e.message);
          if (i) load();
        });
      })();
    });

    if (!isNew) {
      $("cfDup").addEventListener("click", function () { var c = collect(); c.id = null; c.key_label = ""; c.status = "proposed"; c.t = c.t + " (copy)"; openEditor(null, {}); fillFrom(c); });
      var armed = false;
      $("cfDel").addEventListener("click", function () {
        if (!armed) { armed = true; $("cfDel").textContent = "Click again to remove"; $("cfDel").setAttribute("aria-live", "assertive"); setTimeout(function () { if ($("cfDel")) { armed = false; $("cfDel").textContent = "Remove"; } }, 5000); return; }
        busy(true);
        remove(it.id).then(function () { d.close(); toast("Removed " + it.t + ". It stays in the change history."); load(); })
          .catch(function (e) { busy(false); fail("Could not remove: " + e.message); });
      });
    }
  }
  function fillFrom(c) {
    var $ = function (id) { return document.getElementById(id); };
    $("cfKind").value = c.kind; $("cfKind").dispatchEvent(new Event("change"));
    $("cfTitle").value = c.t; $("cfD").value = c.d; $("cfD").dispatchEvent(new Event("change")); $("cfE").value = c.e || "";
    if (c.cat) $("cfCat").value = c.cat; $("cfStatus").value = c.status || "proposed"; $("cfNote").value = c.note || "";
    $("cfFlag").value = c.flag || ""; $("cfKey").value = ""; $("cfObs").value = c.obs || ""; $("cfApprox").checked = !!c.approx;
  }

  /* ---------- toast ---------- */
  function toast(text, action, bad) {
    var t = document.getElementById("calToast");
    if (!t) { t = document.createElement("div"); t.id = "calToast"; t.className = "cal-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.className = "cal-toast show" + (bad ? " bad" : "");
    t.innerHTML = '<span>' + esc(text) + '</span>' + (action ? '<button type="button">' + esc(action.label) + '</button>' : "");
    if (action) t.querySelector("button").addEventListener("click", function () { t.className = "cal-toast"; action.fn(); });
    clearTimeout(toast._h); toast._h = setTimeout(function () { t.className = "cal-toast"; }, action ? 9000 : 4500);
  }

  function injectStyle() {
    if (document.getElementById("cal-style")) return;
    var css = "" +
      "#calRoot .cal-head{text-align:left}" +
      "#calRoot .cal-head h2{font-family:var(--head,Georgia,serif);color:#184050;margin:10px 0 2px;font-size:1.5rem}" +
      "#calRoot .cal-badge{display:inline-block;font-family:var(--cond,sans-serif);font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:11px;background:#faf1dc;color:#7a5a0f;border:1px solid #e8d5a8;padding:3px 10px;border-radius:999px}" +
      "#calRoot .cal-prov{font-size:12px;color:#59666b;line-height:1.55;border-left:3px solid #d3dbde;padding:4px 0 4px 12px;margin:12px 0}" +
      "#calRoot .cal-prov b{color:#212d33}" +
      "#calRoot .cal-kts{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0 2px}" +
      "#calRoot .cal-kt{background:#fff;border:1px solid #d3dbde;border-radius:12px;padding:12px 10px}" +
      "#calRoot .cal-kt .l{font-size:11.5px;color:#59666b}" +
      "#calRoot .cal-kt-s{font-size:10px;color:#7a5a0f}" +
      "#calRoot .cal-kt .n{font-size:1.15rem;font-weight:800;color:#184050;line-height:1.1;margin-top:3px}" +
      "#calRoot .cal-kt .y{font-size:11px;color:#6b7780}" +
      "#calRoot .cal-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 12px;font-size:12.5px;color:#59666b}" +
      "#calRoot .cal-lg{display:inline-flex;align-items:center;gap:6px}" +
      "#calRoot .cal-lg i{width:12px;height:12px;border-radius:3px;display:inline-block}" +
      "#calRoot .cal-lg i.hol{background:#fbecea;border:1px solid #e3b9b4}" +
      "#calRoot .cal-lg i.relig{background:#efe4ef;border:1px solid #d6c0d6}" +
      "#calRoot .cal-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}" +
      "#calRoot .cal-bar{display:flex;flex-wrap:wrap;gap:8px}" +
      "#calRoot .cal-seg{flex-wrap:wrap;margin:0}" +
      "#calRoot .btn.sm{font-size:12px;padding:7px 12px;min-height:34px}" +
      "#calRoot .btn.xs,.cal-dlg .btn.xs{font-size:11px;padding:5px 10px;min-height:30px;border-radius:8px}" +
      "#calRoot .cal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:14px}" +
      "#calRoot .cal-m{border:1px solid #e7ecee;border-radius:12px;padding:10px;background:#fff}" +
      "#calRoot .cal-m h4{margin:0 0 8px;font-size:13.5px;color:#184050;font-weight:700}" +
      "#calRoot .cal-m h4 span{color:#6b7780;font-weight:600}" +
      "#calRoot .cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:3px}" +
      "#calRoot .cal-dow span{text-align:center;font-size:10px;color:#6b7780;font-weight:700}" +
      "#calRoot .cal-days{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}" +
      "#calRoot .cal-d{position:relative;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#334155;border-radius:6px;background:#f7fafb;user-select:none}" +
      "#calRoot .cal-d[role=button]{cursor:pointer}" +
      "#calRoot .cal-d[role=button]:hover{box-shadow:inset 0 0 0 2px #184050}" +
      "#calRoot .cal-d[role=button]:focus-visible{outline:3px solid #2E63F6;outline-offset:1px}" +
      "#calRoot .cal-d[draggable=true]{cursor:grab}" +
      "#calRoot .cal-d.dragging{opacity:.45}" +
      "#calRoot .cal-d.dropok{box-shadow:inset 0 0 0 2px #9a7213;background:#faf1dc}" +
      "#calRoot .cal-d.e{background:transparent}" +
      "#calRoot .cal-d.wk{color:#6b7780}" +
      "#calRoot .cal-d.today{box-shadow:inset 0 0 0 2px #2E63F6}" +
      "#calRoot .cal-d.has{font-weight:800;color:#0b1220;background:#eef4f6;box-shadow:inset 0 0 0 1px #cfe0e6}" +
      "#calRoot .cal-d.cont{background:#f1f6f8;color:#334155}" +
      "#calRoot .cal-d.rel{background:#f5eef5;color:#6b3f6b}" +
      "#calRoot .cal-d.hol,#calRoot .cal-d.holobs{background:#fbecea;color:#9a3130;box-shadow:inset 0 0 0 1px #e3b9b4}" +
      "#calRoot .cal-d em{position:absolute;top:1px;right:3px;font-style:normal;font-size:8px;font-weight:800;color:#9a3130}" +
      "#calRoot .cal-d.rel em{color:#6b3f6b}" +
      "#calRoot .cal-dots{position:absolute;bottom:2px;left:0;right:0;display:flex;gap:2px;justify-content:center}" +
      "#calRoot .cal-dots b{width:5px;height:5px;border-radius:50%}" +
      "#calRoot .cal-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}" +
      "#calRoot .cal-sub{margin:0 0 8px;font-size:13px;color:#184050}" +
      "#calRoot .cal-ul{list-style:none;margin:0;padding:0;font-size:12.5px}" +
      "#calRoot .cal-ul li{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #eef2f3}" +
      "#calRoot .cal-ul li span{color:#59666b;text-align:right;white-space:nowrap}" +
      "#calRoot .cal-lnk{background:none;border:0;color:#123FB5;text-decoration:underline;cursor:pointer;font-size:12px;padding:2px 4px;margin-left:4px}" +
      "#calRoot .cal-ind{font-size:10px;font-weight:700;color:#6b3f6b;background:#efe4ef;border:1px solid #d6c0d6;border-radius:999px;padding:1px 6px;margin-left:4px}" +
      "#calRoot .cal-aghd{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}" +
      "#calRoot .cal-aghd h3{margin:0}" +
      "#calRoot .cal-past{font-size:12.5px;color:#59666b;display:inline-flex;gap:6px;align-items:center}" +
      "#calRoot .cal-tabwrap{overflow-x:auto}" +
      "#calRoot table.cal-tab{border-collapse:collapse;width:100%;font-size:13px}" +
      "#calRoot table.cal-tab caption{text-align:left;padding:4px 0 10px;font-weight:700;color:#184050}" +
      "#calRoot table.cal-tab th,#calRoot table.cal-tab td{text-align:left;padding:8px 10px;border-bottom:1px solid #eef2f3;vertical-align:top}" +
      "#calRoot table.cal-tab thead th{background:#184050;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:600}" +
      "#calRoot table.cal-tab tr.cal-mh th{background:#eef4f6;color:#184050;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid #cfe0e6}" +
      "#calRoot table.cal-tab tr.past td{color:#6b7780}" +
      "#calRoot table.cal-tab td.nowrap{white-space:nowrap}" +
      "#calRoot table.cal-tab td.note{color:#59666b;font-size:12px;line-height:1.5}" +
      "#calRoot .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
      "#calRoot .cal-key{font-size:10px;font-weight:700;color:#184050;background:#eef4f6;border:1px solid #cfe0e6;border-radius:999px;padding:1px 6px;margin-left:4px}" +
      ".cal-cat{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid}" +
      ".cal-st{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}" +
      ".cal-st.ok{background:#e3f0e8;color:#296944;border:1px solid #bcd8c7}" +
      ".cal-st.prop{background:#faf1dc;color:#7a5a0f;border:1px solid #e8d5a8}" +
      ".cal-st.tbc{background:#eef1f5;color:#334155;border:1px solid #cfd8e3}" +
      "#calRoot .cal-flag{display:inline-block;background:#fcf3d8;color:#7a4c0e;border:1px solid #f1e2ae;border-radius:6px;padding:1px 7px;font-size:11.5px;font-weight:600;margin-top:3px}" +
      "#calRoot .cal-flag.auto{background:#fbecea;color:#9a3130;border-color:#f1cfcb}" +
      "#calRoot .cal-notes{margin:0;padding-left:18px;font-size:13px;line-height:1.6}" +
      "#calRoot .cal-notes li{margin-bottom:7px}" +
      "#calRoot .cal-gov h3{color:#184050}" +
      "#calRoot .cal-hist summary{cursor:pointer;display:flex;gap:12px;align-items:baseline;list-style:none}" +
      "#calRoot .cal-hist summary::-webkit-details-marker{display:none}" +
      "#calRoot .cal-hist summary h3{margin:0;display:inline}" +
      "#calRoot .cal-hist summary h3::before{content:'\\25B8  ';color:#9a7213}" +
      "#calRoot .cal-hist details[open] summary h3::before{content:'\\25BE  '}" +
      "#calRoot .cal-hist table{margin-top:10px}" +
      ".cal-dlg{border:0;border-radius:16px;padding:0;max-width:640px;width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;box-shadow:0 24px 60px rgba(7,26,74,.28);color:#0B1220}" +
      ".cal-dlg::backdrop{background:rgba(7,26,74,.45)}" +
      ".cal-dlgf{padding:20px 22px;margin:0}" +
      ".cal-dlgf h3{margin:0 0 12px;color:#184050;font-size:1.15rem}" +
      ".cal-dlg .cal-dl{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #eef2f3}" +
      ".cal-dlg .cal-dlm{font-size:12px;color:#59666b;margin-top:3px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}" +
      ".cal-dlg .cal-dln{font-size:12px;color:#59666b;margin-top:4px;line-height:1.5}" +
      ".cal-dlg .cal-fg{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}" +
      ".cal-dlg .cal-fg label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:700;color:#334155}" +
      ".cal-dlg .cal-fg label[hidden],.cal-dlg .cal-fg p[hidden]{display:none}" +
      ".cal-dlg .cal-fg .w2{grid-column:1/-1}" +
      ".cal-dlg .cal-fg .opt{font-weight:400;color:#6b7780}" +
      ".cal-dlg .cal-fg .lt{display:block}" +
      ".cal-dlg .cal-fg input[type=text],.cal-dlg .cal-fg input[type=date],.cal-dlg .cal-fg select,.cal-dlg .cal-fg textarea{font:inherit;font-weight:400;font-size:14px;padding:9px 10px;border:1px solid #cfd8e3;border-radius:9px;background:#fff;color:#0B1220;min-height:40px}" +
      ".cal-dlg .cal-fg textarea{resize:vertical}" +
      ".cal-dlg .cal-fg input:focus-visible,.cal-dlg .cal-fg select:focus-visible,.cal-dlg .cal-fg textarea:focus-visible{outline:3px solid #2E63F6;outline-offset:1px}" +
      ".cal-dlg .cal-chk{flex-direction:row!important;align-items:center;gap:8px!important;font-weight:400!important;grid-column:1/-1}" +
      ".cal-dlg .hint{font-size:12px;color:#59666b;margin:4px 0 0}" +
      ".cal-dlg .msg{margin-top:12px}" +
      ".cal-dlg .cal-who{margin-top:12px}" +
      ".cal-dlg .cal-dlgb{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}" +
      ".cal-dlg .cal-dlgb .sp{flex:1}" +
      ".cal-dlg .btn.sm{font-size:12px;padding:8px 14px;min-height:36px}" +
      ".cal-dlg .btn[disabled]{opacity:.55;cursor:wait}" +
      ".cal-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,140%);background:#071A4A;color:#fff;padding:11px 16px;border-radius:12px;font-size:13.5px;display:flex;gap:14px;align-items:center;box-shadow:0 12px 30px rgba(7,26,74,.3);transition:transform .2s ease;z-index:9999;max-width:calc(100vw - 32px)}" +
      ".cal-toast.show{transform:translate(-50%,0)}" +
      ".cal-toast.bad{background:#B23A32}" +
      ".cal-toast button{background:#F4B41A;color:#071A4A;border:0;border-radius:8px;font-weight:700;padding:6px 12px;cursor:pointer;min-height:32px}" +
      "@media(prefers-reduced-motion:reduce){.cal-toast{transition:none}}" +
      "@media(max-width:640px){#calRoot .cal-two{grid-template-columns:1fr}#calRoot .cal-ul li span{white-space:normal}.cal-dlg .cal-fg{grid-template-columns:1fr}}" +
      "@media print{#calRoot .no-print{display:none!important}#calRoot .cal-grid{grid-template-columns:repeat(3,1fr)}}";
    var st = document.createElement("style");
    st.id = "cal-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  NS.renderCalendar = function () {
    render();
    if (!S.loading) load();
  };
})(window.AC = window.AC || {});
