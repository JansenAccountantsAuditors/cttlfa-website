/* CTTLFA admin - Season & Governance Calendar (read-only, phase 1). Closure over
   window.AC. A proposed association calendar from today to end December 2027, laid
   out for formal Management Committee sign-off. Governance dates are grounded in the
   Constitution (Articles 6.2, 6.3, 6.5, 6.6); football dates mirror the 2027 Season
   Planner (2026 structure); public holidays are statutory (Public Holidays Act 36 of
   1994) and religious observances are indicative. Editing, sign-off state and budget
   linking follow in phase 2. */
(function (NS) {
  "use strict";

  function esc(s) { return NS.esc ? NS.esc(s == null ? "" : String(s)) : String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }

  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOWL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var EXTRACTED = "14 October 2026";

  var CATS = {
    gov:    { label: "Governance",          c: "#184050", bg: "#e7eef2", ln: "#bcd3dc" },
    func:   { label: "Functions & events",  c: "#9a7213", bg: "#faf1dc", ln: "#e8d5a8" },
    ball:   { label: "Football / season",   c: "#296944", bg: "#e3f0e8", ln: "#bcd8c7" },
    course: { label: "Courses",             c: "#6b3f6b", bg: "#efe4ef", ln: "#d6c0d6" },
    ops:    { label: "Operations",          c: "#334155", bg: "#eef1f5", ln: "#cfd8e3" }
  };
  var CAT_ORDER = ["gov", "func", "ball", "course", "ops"];

  /* ---- Events. status: confirmed | proposed | tbc. flag: a governance / clash note. ---- */
  var EVENTS = [
    // ---- 2026 (remaining) ----
    { d: "2026-10-30", t: "Awards Evening — RSVP deadline", cat: "func", status: "confirmed", note: "Confirmation of attendance closes." },
    { d: "2026-11-07", t: "Annual General Meeting (AGM)", cat: "gov", status: "proposed", note: "Constitution 6.2.1 — AGM held during November, date fixed by Mancom. 14 days written notice (6.2.4); Treasurer's report to 30 September (6.2.7.11)." },
    { d: "2026-11-21", t: "Annual Awards Evening", cat: "func", status: "confirmed", note: "The Terrace Rooftop, 12 Kremer Road, Salt River. Smart casual." },
    { d: "2026-12-11", t: "Year-end function", cat: "func", status: "proposed", note: "Committee and office year-end. Date to be confirmed." },
    { d: "2026-12-18", e: "2027-01-11", t: "Office festive closure", cat: "ops", status: "proposed", note: "Proposed close Friday 18 December 2026, reopen Monday 11 January 2027." },

    // ---- 2027 governance ----
    { d: "2027-02-17", t: "Special General Meeting (SGM)", cat: "gov", status: "proposed", note: "Constitution 6.5 — Mancom may convene; 7 days written notice. Pre-season launch, subscription and registration fees." },

    // Mancom — monthly, 2nd Wednesday (proposed cadence)
    { d: "2027-01-13", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-02-10", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-03-10", t: "Management Committee meeting", cat: "gov", status: "proposed", flag: "Falls on Eid al-Fitr (indicative, subject to sighting) — consider moving.", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-04-14", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-05-12", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-06-09", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-07-14", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-08-11", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-09-08", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-10-13", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-11-10", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },
    { d: "2027-12-08", t: "Management Committee meeting", cat: "gov", status: "proposed", note: "Monthly Mancom — 2nd Wednesday (proposed cadence)." },

    // General club meetings — quarterly, 3rd Wednesday (per Treasurer's proposal)
    { d: "2027-03-17", t: "General club meeting", cat: "gov", status: "proposed", note: "3rd Wednesday, 7 days notice (Constitution 6.3)." },
    { d: "2027-06-16", t: "General club meeting", cat: "gov", status: "proposed", flag: "16 June is Youth Day (public holiday) — consider moving.", note: "3rd Wednesday, 7 days notice (Constitution 6.3)." },
    { d: "2027-09-15", t: "General club meeting", cat: "gov", status: "proposed", note: "3rd Wednesday, 7 days notice (Constitution 6.3)." },

    { d: "2027-11-06", t: "Annual General Meeting (AGM)", cat: "gov", status: "proposed", note: "Constitution 6.2.1 — AGM held during November, date fixed by Mancom." },

    // ---- 2027 courses ----
    { d: "2027-02-20", t: "Referee re-accreditation course", cat: "course", status: "tbc", note: "Pre-season — date to be confirmed." },
    { d: "2027-03-06", t: "Coaching clinic", cat: "course", status: "tbc", note: "Pre-season — date to be confirmed." },

    // ---- 2027 football / season (from the 2027 Season Planner, 2026 structure) ----
    { d: "2027-04-03", t: "Season kick-off (first fixtures)", cat: "ball", status: "proposed", note: "2027 season start. League rounds run on Saturdays April–October. Draft scenario; LeagueRepublic is the system of record." },
    { d: "2027-05-15", t: "Knockout — Round 1 (weekend 1)", cat: "ball", status: "proposed", note: "Cup knockout weekend, all divisions. Draft scenario." },
    { d: "2027-05-22", t: "Knockout — Round 1 (weekend 2)", cat: "ball", status: "proposed", note: "Cup knockout weekend, all divisions. Draft scenario." },
    { d: "2027-07-10", t: "Knockout — Quarter-Finals (weekend 1)", cat: "ball", status: "proposed", note: "Cup knockout weekend, all divisions. Draft scenario." },
    { d: "2027-07-17", t: "Knockout — Quarter-Finals (weekend 2)", cat: "ball", status: "proposed", note: "Cup knockout weekend, all divisions. Draft scenario." },
    { d: "2027-08-28", t: "Knockout — Semi-Finals (weekend 1)", cat: "ball", status: "proposed", note: "Cup knockout weekend, all divisions. Draft scenario." },
    { d: "2027-09-04", t: "Knockout — Semi-Finals (weekend 2)", cat: "ball", status: "proposed", note: "Cup knockout weekend, all divisions. Draft scenario." },
    { d: "2027-10-23", t: "Knockout Finals — junior & senior (weekend 1)", cat: "ball", status: "proposed", note: "Cup finals. Draft scenario." },
    { d: "2027-10-30", t: "Knockout Finals — junior & senior (weekend 2)", cat: "ball", status: "proposed", note: "Cup finals. Draft scenario." },
    { d: "2027-10-31", t: "Season ends", cat: "ball", status: "proposed", note: "Planner season window closes 31 October 2027." },

    // ---- 2027 functions (year-end) ----
    { d: "2027-11-20", t: "Annual Awards Evening", cat: "func", status: "proposed", note: "Mirrors 2026 (3rd Saturday). Venue to be confirmed." },
    { d: "2027-12-10", t: "Year-end function", cat: "func", status: "proposed", note: "Committee and office year-end. Date to be confirmed." },
    { d: "2027-12-17", t: "Office festive closure begins", cat: "ops", status: "proposed", note: "Proposed close Friday 17 December 2027." }
  ];

  /* ---- Public holidays (statutory, Public Holidays Act 36 of 1994). obs = observed Monday. ---- */
  var PUBHOL = [
    { d: "2026-12-16", t: "Day of Reconciliation" },
    { d: "2026-12-25", t: "Christmas Day" },
    { d: "2026-12-26", t: "Day of Goodwill" },
    { d: "2027-01-01", t: "New Year's Day" },
    { d: "2027-03-21", t: "Human Rights Day", obs: "2027-03-22" },
    { d: "2027-03-26", t: "Good Friday" },
    { d: "2027-03-29", t: "Family Day" },
    { d: "2027-04-27", t: "Freedom Day" },
    { d: "2027-05-01", t: "Workers' Day" },
    { d: "2027-06-16", t: "Youth Day" },
    { d: "2027-08-09", t: "National Women's Day" },
    { d: "2027-09-24", t: "Heritage Day" },
    { d: "2027-12-16", t: "Day of Reconciliation" },
    { d: "2027-12-25", t: "Christmas Day" },
    { d: "2027-12-26", t: "Day of Goodwill", obs: "2027-12-27" }
  ];

  /* ---- Religious observances (indicative; lunar dates subject to sighting). ---- */
  var RELIG = [
    { d: "2027-02-08", e: "2027-03-09", t: "Ramadan" },
    { d: "2027-03-10", t: "Eid al-Fitr", approx: true },
    { d: "2027-03-26", e: "2027-03-28", t: "Good Friday to Easter Sunday" },
    { d: "2027-04-22", e: "2027-04-30", t: "Passover", approx: true },
    { d: "2027-05-16", t: "Eid al-Adha", approx: true },
    { d: "2027-10-29", t: "Diwali", approx: true }
  ];

  var FILTER = "all";

  /* ---------- helpers ---------- */
  function iso(y, m, d) { return y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d); }
  function parse(s) { var p = String(s).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function dow(s) { return parse(s).getUTCDay(); }
  function dnum(s) { return +String(s).slice(8, 10); }
  function longDate(s) { var dt = parse(s); return DOWL[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + MON[dt.getUTCMonth()] + " " + dt.getUTCFullYear(); }
  function shortDate(s) { var dt = parse(s); return DOWS[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + MONS[dt.getUTCMonth()]; }

  function obsOf(h) { return h.obs ? (" — observed " + longDate(h.obs)) : ""; }

  // index: ISO -> { ev:[], hol:obj|null, holObs:obj|null }
  function buildIndex() {
    var ix = {};
    EVENTS.forEach(function (e) { (ix[e.d] = ix[e.d] || { ev: [] }).ev.push(e); });
    PUBHOL.forEach(function (h) { (ix[h.d] = ix[h.d] || { ev: [] }).hol = h; if (h.obs) (ix[h.obs] = ix[h.obs] || { ev: [] }).holObs = h; });
    return ix;
  }

  function monthsSpan() {
    // Oct 2026 .. Dec 2027 inclusive
    var out = [], y = 2026, m = 10;
    while (y < 2027 || (y === 2027 && m <= 12)) { out.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }

  function visible(e) { return FILTER === "all" || e.cat === FILTER; }

  /* ---------- render pieces ---------- */
  function provenance() {
    return '<div class="cal-prov no-screen-hide">' +
      '<div><b>Cape Town Tygerberg Local Football Association</b></div>' +
      '<div>Season &amp; governance calendar &middot; present to 31 December 2027</div>' +
      '<div>Basis: proposed dates for Management Committee sign-off. Governance dates per the Constitution (Articles 6.2, 6.3, 6.5, 6.6); football dates from the 2027 Season Planner on the 2026 structure; public holidays statutory under the Public Holidays Act 36 of 1994; religious observances indicative.</div>' +
      '<div>Prepared by the Treasurer &middot; compiled ' + EXTRACTED + ' &middot; status: <b>PROPOSED — not yet approved</b></div>' +
      '</div>';
  }

  function keyTiles() {
    function tile(lbl, dStr, cat) {
      var c = CATS[cat];
      return '<div class="cal-kt" style="border-top:3px solid ' + c.c + '"><div class="l">' + esc(lbl) + '</div><div class="n">' + esc(shortDate(dStr)) + '</div><div class="y">' + parse(dStr).getUTCFullYear() + '</div></div>';
    }
    return '<div class="cal-kts">' +
      tile("AGM (proposed)", "2026-11-07", "gov") +
      tile("Awards Evening", "2026-11-21", "func") +
      tile("Season kick-off", "2027-04-03", "ball") +
      tile("Knockout finals", "2027-10-23", "ball") +
      tile("AGM 2027 (proposed)", "2027-11-06", "gov") +
      '</div>';
  }

  function legend() {
    var h = '<div class="cal-legend no-print-controls">';
    CAT_ORDER.forEach(function (k) { var c = CATS[k]; h += '<span class="cal-lg"><i style="background:' + c.c + '"></i>' + esc(c.label) + '</span>'; });
    h += '<span class="cal-lg"><i class="hol"></i>Public holiday (H)</span>';
    h += '<span class="cal-lg"><i class="relig"></i>Religious observance</span>';
    h += '</div>';
    return h;
  }

  function filterBar() {
    var h = '<div class="seg cal-seg no-print" role="tablist" aria-label="Filter calendar by category">';
    h += '<button data-f="all"' + (FILTER === "all" ? ' class="on"' : "") + ' role="tab">All</button>';
    CAT_ORDER.forEach(function (k) { h += '<button data-f="' + k + '"' + (FILTER === k ? ' class="on"' : "") + ' role="tab">' + esc(CATS[k].label) + '</button>'; });
    h += '</div>';
    h += '<div class="cal-bar no-print"><button class="btn ghost sm" id="calPrint">Print / save as PDF</button></div>';
    return h;
  }

  function monthGrid(ix) {
    var h = '<div class="cal-grid">';
    monthsSpan().forEach(function (ym) {
      var y = ym[0], m = ym[1], first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      h += '<div class="cal-m"><h4>' + MON[m - 1] + ' <span>' + y + '</span></h4>';
      h += '<div class="cal-dow">' + ["M", "T", "W", "T", "F", "S", "S"].map(function (x) { return "<span>" + x + "</span>"; }).join("") + '</div>';
      h += '<div class="cal-days">';
      var lead = (first + 6) % 7; // Monday-first
      for (var i = 0; i < lead; i++) h += '<span class="cal-d e"></span>';
      for (var dd = 1; dd <= days; dd++) {
        var k = iso(y, m, dd), cell = ix[k], wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
        var cls = "cal-d", title = DOWL[wd] + " " + dd + " " + MON[m - 1] + " " + y, dots = "", hmark = "";
        var evs = cell && cell.ev ? cell.ev.filter(visible) : [];
        if (cell && cell.hol) { cls += " hol"; title += " — " + cell.hol.t + " (public holiday)"; hmark = "H"; }
        if (cell && cell.holObs) { cls += " holobs"; title += " — " + cell.holObs.t + " observed"; hmark = "H"; }
        if (wd === 0 || wd === 6) cls += " wk";
        if (evs.length) {
          cls += " has";
          var cats = [];
          evs.forEach(function (e) { if (cats.indexOf(e.cat) < 0) cats.push(e.cat); });
          dots = '<i class="cal-dots">' + cats.slice(0, 3).map(function (c) { return '<b style="background:' + CATS[c].c + '"></b>'; }).join("") + '</i>';
          title += " — " + evs.map(function (e) { return e.t; }).join("; ");
        }
        h += '<span class="' + cls + '" title="' + esc(title) + '">' + dd + (hmark ? '<em>' + hmark + '</em>' : "") + dots + '</span>';
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

  function agenda() {
    var evs = EVENTS.filter(visible).slice().sort(function (a, b) { return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); });
    var h = '<div class="card cal-ag"><h3>Full schedule</h3>' +
      '<p class="hint">Every proposed item in date order. Flags mark a clash or a point for the Management Committee to settle.</p>';
    var curKey = "";
    h += '<table class="cal-tab"><caption>CTTLFA proposed season &amp; governance schedule — present to 31 December 2027</caption>' +
      '<thead><tr><th scope="col">Date</th><th scope="col">Day</th><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead><tbody>';
    evs.forEach(function (e) {
      var dt = parse(e.d), key = dt.getUTCFullYear() + "-" + dt.getUTCMonth();
      if (key !== curKey) { curKey = key; h += '<tr class="cal-mh"><th colspan="6" scope="colgroup">' + MON[dt.getUTCMonth()] + " " + dt.getUTCFullYear() + '</th></tr>'; }
      var c = CATS[e.cat];
      var span = e.e ? (" &ndash; " + shortDate(e.e)) : "";
      var note = esc(e.note || "");
      if (e.flag) note += ' <span class="cal-flag">⚑ ' + esc(e.flag) + '</span>';
      h += '<tr>' +
        '<td class="nowrap">' + dt.getUTCDate() + " " + MONS[dt.getUTCMonth()] + span + '</td>' +
        '<td class="nowrap">' + DOWS[dt.getUTCDay()] + '</td>' +
        '<td><b>' + esc(e.t) + '</b></td>' +
        '<td><span class="cal-cat" style="background:' + c.bg + ';color:' + c.c + ';border-color:' + c.ln + '">' + esc(c.label) + '</span></td>' +
        '<td>' + statusChip(e.status) + '</td>' +
        '<td class="note">' + note + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function holidaysCard() {
    var h = '<div class="card"><h3>Public holidays &amp; observances</h3>' +
      '<p class="hint">Statutory public holidays (Public Holidays Act 36 of 1994) and major religious observances. A public holiday on a Sunday is observed the following Monday. Religious dates marked “indicative” follow the lunar calendar and may shift by a day on sighting.</p>';
    h += '<div class="cal-two">';
    h += '<div><h4 class="cal-sub">Public holidays</h4><ul class="cal-ul">';
    PUBHOL.forEach(function (x) { h += '<li><b>' + esc(x.t) + '</b><span>' + esc(longDate(x.d)) + esc(obsOf(x)) + '</span></li>'; });
    h += '</ul></div>';
    h += '<div><h4 class="cal-sub">Religious observances</h4><ul class="cal-ul">';
    RELIG.forEach(function (x) {
      var when = x.e ? (longDate(x.d) + " to " + longDate(x.e)) : longDate(x.d);
      h += '<li><b>' + esc(x.t) + (x.approx ? ' <span class="cal-ind">indicative</span>' : "") + '</b><span>' + esc(when) + '</span></li>';
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
      '<li><b>Youth Day clash.</b> The proposed 3rd-Wednesday General Meeting of 16 June 2027 falls on Youth Day, a public holiday. Consider moving it.</li>' +
      '<li><b>Eid al-Fitr.</b> The proposed Mancom meeting of 10 March 2027 falls on Eid al-Fitr (indicative). Consider moving it.</li>' +
      '<li><b>AGM.</b> Must be held during November (Article 6.2.1), with 14 days written notice and the Treasurer\'s report drawn to 30 September (Articles 6.2.4, 6.2.7.11). Proposed Saturdays are placeholders for Mancom to fix.</li>' +
      '<li><b>Football dates.</b> Season kick-off, knockout rounds and finals are drawn from the 2027 Season Planner on the 2026 structure. They are a planning scenario, not confirmed fixtures; LeagueRepublic remains the system of record.</li>' +
      '</ul>' +
      '<p class="hint" style="margin-top:12px">Next phase: Mancom sign-off marks each date confirmed, after which budgets and linked items are attached per event.</p>' +
      '</div>';
  }

  /* ---------- main ---------- */
  function render() {
    var root = document.getElementById("calRoot");
    if (!root) return;
    injectStyle();
    var ix = buildIndex();
    var h = "";
    h += '<div class="card cal-head">' +
      '<div class="cal-badge">PROPOSED — for Management Committee sign-off</div>' +
      '<h2>Season &amp; Governance Calendar</h2>' +
      '<p class="hint">The association\'s proposed dates from now to the end of December 2027 — governance, functions, the 2027 football season and public holidays — laid out for formal Mancom sign-off. Read-only for now; sign-off and budget linking follow.</p>' +
      provenance() +
      keyTiles() +
      '</div>';
    h += '<div class="card">' + legend() + filterBar() +
      '<p class="hint" style="margin:10px 0 0">Each month shows event days by category dot; shaded cells with “H” are public holidays. Full detail is in the schedule below.</p>' +
      monthGrid(ix) + '</div>';
    h += agenda();
    h += governanceCard();
    h += holidaysCard();
    root.innerHTML = h;

    Array.prototype.forEach.call(root.querySelectorAll(".cal-seg button"), function (b) {
      b.addEventListener("click", function () { FILTER = b.getAttribute("data-f") || "all"; render(); });
    });
    var pb = document.getElementById("calPrint");
    if (pb) pb.addEventListener("click", function () { window.print(); });
  }

  function injectStyle() {
    if (document.getElementById("cal-style")) return;
    var css = "" +
      "#calRoot .cal-head{text-align:left}" +
      "#calRoot .cal-head h2{font-family:var(--head,Georgia,serif);color:#184050;margin:10px 0 2px;font-size:1.5rem}" +
      "#calRoot .cal-badge{display:inline-block;font-family:var(--cond,sans-serif);font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:11px;background:#faf1dc;color:#9a7213;border:1px solid #e8d5a8;padding:3px 10px;border-radius:999px}" +
      "#calRoot .cal-prov{font-size:12px;color:#59666b;line-height:1.55;border-left:3px solid #d3dbde;padding:4px 0 4px 12px;margin:12px 0}" +
      "#calRoot .cal-prov b{color:#212d33}" +
      "#calRoot .cal-kts{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0 2px}" +
      "#calRoot .cal-kt{background:#fff;border:1px solid #d3dbde;border-radius:12px;padding:12px 10px}" +
      "#calRoot .cal-kt .l{font-size:11.5px;color:#59666b}" +
      "#calRoot .cal-kt .n{font-size:1.15rem;font-weight:800;color:#184050;line-height:1.1;margin-top:3px}" +
      "#calRoot .cal-kt .y{font-size:11px;color:#9aa6ad}" +
      "#calRoot .cal-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 12px;font-size:12.5px;color:#59666b}" +
      "#calRoot .cal-lg{display:inline-flex;align-items:center;gap:6px}" +
      "#calRoot .cal-lg i{width:12px;height:12px;border-radius:3px;display:inline-block}" +
      "#calRoot .cal-lg i.hol{background:#fbecea;border:1px solid #e3b9b4}" +
      "#calRoot .cal-lg i.relig{background:#efe4ef;border:1px solid #d6c0d6}" +
      "#calRoot .cal-bar{margin:0 0 6px}" +
      "#calRoot .btn.sm{font-size:12px;padding:7px 12px;min-height:34px}" +
      "#calRoot .cal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:14px}" +
      "#calRoot .cal-m{border:1px solid #e7ecee;border-radius:12px;padding:10px;background:#fff}" +
      "#calRoot .cal-m h4{margin:0 0 8px;font-size:13.5px;color:#184050;font-weight:700}" +
      "#calRoot .cal-m h4 span{color:#9aa6ad;font-weight:600}" +
      "#calRoot .cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:3px}" +
      "#calRoot .cal-dow span{text-align:center;font-size:10px;color:#9aa6ad;font-weight:700}" +
      "#calRoot .cal-days{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}" +
      "#calRoot .cal-d{position:relative;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#334155;border-radius:6px;background:#f7fafb}" +
      "#calRoot .cal-d.e{background:transparent}" +
      "#calRoot .cal-d.wk{color:#9aa6ad}" +
      "#calRoot .cal-d.has{font-weight:800;color:#0b1220;background:#eef4f6;box-shadow:inset 0 0 0 1px #cfe0e6}" +
      "#calRoot .cal-d.hol,#calRoot .cal-d.holobs{background:#fbecea;color:#9a3130;box-shadow:inset 0 0 0 1px #e3b9b4}" +
      "#calRoot .cal-d em{position:absolute;top:1px;right:3px;font-style:normal;font-size:8px;font-weight:800;color:#9a3130}" +
      "#calRoot .cal-dots{position:absolute;bottom:2px;left:0;right:0;display:flex;gap:2px;justify-content:center}" +
      "#calRoot .cal-dots b{width:5px;height:5px;border-radius:50%}" +
      "#calRoot .cal-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}" +
      "#calRoot .cal-sub{margin:0 0 8px;font-size:13px;color:#184050}" +
      "#calRoot .cal-ul{list-style:none;margin:0;padding:0;font-size:12.5px}" +
      "#calRoot .cal-ul li{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #eef2f3}" +
      "#calRoot .cal-ul li span{color:#59666b;text-align:right;white-space:nowrap}" +
      "#calRoot .cal-ind{font-size:10px;font-weight:700;color:#6b3f6b;background:#efe4ef;border:1px solid #d6c0d6;border-radius:999px;padding:1px 6px;margin-left:4px}" +
      "#calRoot table.cal-tab{border-collapse:collapse;width:100%;font-size:13px}" +
      "#calRoot table.cal-tab caption{text-align:left;padding:4px 0 10px;font-weight:700;color:#184050}" +
      "#calRoot table.cal-tab th,#calRoot table.cal-tab td{text-align:left;padding:8px 10px;border-bottom:1px solid #eef2f3;vertical-align:top}" +
      "#calRoot table.cal-tab thead th{background:#184050;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:600}" +
      "#calRoot table.cal-tab tr.cal-mh th{background:#eef4f6;color:#184050;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid #cfe0e6}" +
      "#calRoot table.cal-tab td.nowrap{white-space:nowrap}" +
      "#calRoot table.cal-tab td.note{color:#59666b;font-size:12px;line-height:1.5}" +
      "#calRoot .cal-cat{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid}" +
      "#calRoot .cal-st{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}" +
      "#calRoot .cal-st.ok{background:#e3f0e8;color:#296944;border:1px solid #bcd8c7}" +
      "#calRoot .cal-st.prop{background:#faf1dc;color:#9a7213;border:1px solid #e8d5a8}" +
      "#calRoot .cal-st.tbc{background:#eef1f5;color:#334155;border:1px solid #cfd8e3}" +
      "#calRoot .cal-flag{display:inline-block;background:#fcf3d8;color:#8a5a12;border:1px solid #f1e2ae;border-radius:6px;padding:1px 7px;font-size:11.5px;font-weight:600;margin-top:3px}" +
      "#calRoot .cal-notes{margin:0;padding-left:18px;font-size:13px;line-height:1.6}" +
      "#calRoot .cal-notes li{margin-bottom:7px}" +
      "#calRoot .cal-gov h3{color:#184050}" +
      "@media(max-width:640px){#calRoot .cal-two{grid-template-columns:1fr}#calRoot .cal-ul li span{white-space:normal}}" +
      "@media print{#calRoot .no-print,#calRoot .no-print-controls{display:none!important}#calRoot .cal-grid{grid-template-columns:repeat(3,1fr)}}";
    var st = document.createElement("style");
    st.id = "cal-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  NS.renderCalendar = render;
})(window.AC = window.AC || {});
