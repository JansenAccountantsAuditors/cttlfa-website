/* CTTLFA admin - Club Profile (one version of the truth). Closure over window.AC.
   The club view IS the club portal (club.cttfa.co.za), opened read-only inside the Admin Centre
   for the chosen club: the frame receives the admin's access token and the club key by
   postMessage, and every portal read carries x-cttlfa-view-club, which the database honours only
   for active Admin Centre users (portal writes refuse while it is present). Alongside it sits an
   internal panel (club_internal) that clubs never see. The club list (club_view_index) uses the
   same current SAFA card-cycle figures the club sees. Replaces the old two-pager. */
(function (NS) {
  "use strict";
  var PORTAL = "https://club.cttfa.co.za";
  var IDX = null, Q = "", CUR = null, TOKEN_TIMER = null, LISTENER = false;

  function esc(s) { return NS.esc ? NS.esc(s == null ? "" : String(s)) : String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function num(n) { n = Number(n) || 0; return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function rand(n) {
    if (n == null || n === "") return "&ndash;";
    n = Number(n) || 0; var neg = n < 0, v = Math.abs(n).toFixed(2).split(".");
    v[0] = v[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "(R " : "R ") + v.join(".") + (neg ? ")" : "");
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dz(s) { if (!s) return "&ndash;"; var d = new Date(s); if (isNaN(d)) return esc(s); return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); }
  function root() { return document.getElementById("clubProfileRoot"); }

  /* ---------- list ---------- */
  function render() {
    style();
    var r = root(); if (!r) return;
    var pending = NS._cvPending; NS._cvPending = null;
    if (pending) { openClub(pending); return; }
    if (CUR) { drawClub(); return; }
    r.innerHTML = '<div class="card"><p class="hint">Loading clubs&hellip;</p></div>';
    NS.sb.rpc("club_view_index").then(function (res) {
      if (res.error) throw res.error;
      IDX = res.data || {}; drawList();
    }).catch(function (e) { r.innerHTML = '<div class="card"><h3>Club Profile</h3><div class="msg err">Could not load the clubs: ' + esc(e.message || e) + '</div></div>'; });
  }

  function statusPill(c) {
    if (c.ooc) return '<span class="cv-pill bad">Out of compliance</span>';
    var st = c.status || "";
    if (!st) return '<span class="cv-pill mut">&ndash;</span>';
    var cls = /credit|paid|good|clear/i.test(st) ? "ok" : /current|below|up to date/i.test(st) ? "mut" : /remind|due/i.test(st) ? "warn" : "bad";
    return '<span class="cv-pill ' + cls + '">' + esc(st) + '</span>';
  }

  function rowsHtml(list) {
    if (!list.length) return '<tr><td colspan="8" class="hint">No club matches.</td></tr>';
    return list.map(function (c) {
      return '<tr><td><button type="button" class="cv-open" data-k="' + esc(c.club_key) + '">' + esc(c.name) + '</button><div class="cv-sub">' + esc(c.type === "full" ? "Full member" : c.type === "associate" ? "Associate member" : c.type || "") + '</div></td>' +
        '<td class="num">' + num(c.players) + '</td>' +
        '<td class="num">' + rand(c.bal) + '</td>' +
        '<td>' + statusPill(c) + '</td>' +
        '<td class="num">' + num(c.cards) + '</td>' +
        '<td class="num">' + num(c.rulings) + '</td>' +
        '<td class="num">' + (Number(c.fines_outstanding) > 0 ? rand(c.fines_outstanding) : "&ndash;") + '</td>' +
        '<td class="num">' + (Number(c.logins) > 0 ? num(c.logins) : '<span class="cv-pill warn">none</span>') + '</td></tr>';
    }).join("");
  }

  function drawList() {
    var r = root(); if (!r) return;
    var clubs = (IDX && IDX.clubs) || [];
    r.innerHTML =
      '<div class="card cv-head"><h2>Club Profile</h2>' +
        '<p class="hint">One view per club, and it is the same view the club has. Open a club to see its portal exactly as the club sees it at club.cttfa.co.za (read-only here), with an internal panel for the office alongside. Players are the current SAFA card cycle (' + esc((IDX && IDX.cycle_label) || "") + '), the same figure the club sees.</p>' +
        '<input id="cvSearch" class="cv-search" type="search" placeholder="Search a club or code&hellip;" value="' + esc(Q) + '" aria-label="Search clubs">' +
      '</div>' +
      '<div class="card"><div class="cv-tblwrap"><table class="cv-tbl"><caption class="sr">Member clubs</caption><thead><tr>' +
        '<th scope="col">Club</th><th scope="col" class="num">Players (' + esc((IDX && IDX.cycle_label) || "cycle") + ')</th><th scope="col" class="num">Balance</th><th scope="col">Status</th>' +
        '<th scope="col" class="num">Cards</th><th scope="col" class="num">Rulings</th><th scope="col" class="num">Fines out</th><th scope="col" class="num">Portal logins</th>' +
      '</tr></thead><tbody id="cvRows">' + rowsHtml(filter(clubs)) + '</tbody></table></div>' +
      '<p class="hint" style="margin-top:8px">' + num(clubs.length) + ' member clubs (full and associate). Balances from the current Sage snapshot, brackets denote credits. Cards, rulings and fines from the disciplinary system. Guest teams have no portal and are not listed.</p></div>';
    var s = document.getElementById("cvSearch");
    if (s) s.addEventListener("input", function () { Q = s.value; document.getElementById("cvRows").innerHTML = rowsHtml(filter(clubs)); wireRows(); });
    wireRows();
  }
  function filter(list) { var q = (Q || "").trim().toLowerCase(); return !q ? list : list.filter(function (c) { return (c.name || "").toLowerCase().indexOf(q) >= 0 || (c.club_key || "").toLowerCase().indexOf(q) >= 0; }); }
  function wireRows() { Array.prototype.forEach.call(document.querySelectorAll("#cvRows .cv-open"), function (b) { b.onclick = function () { openClub(b.getAttribute("data-k")); }; }); }

  /* ---------- one club ---------- */
  function openClub(key) {
    CUR = { key: key, name: null, internal: null };
    var hit = ((IDX && IDX.clubs) || []).filter(function (c) { return c.club_key === key; })[0];
    if (hit) CUR.name = hit.name;
    drawClub();
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) {}
  }

  function drawClub() {
    var r = root(); if (!r || !CUR) return;
    var nm = CUR.name || CUR.key;
    r.innerHTML =
      '<div class="card cv-bar">' +
        '<button type="button" class="btn ghost sm" id="cvBack">&larr; All clubs</button>' +
        '<div class="cv-bt"><h2>' + esc(nm) + '</h2><div class="hint">Showing the club portal exactly as the club sees it. Read-only in the Admin Centre.</div></div>' +
        '<span class="cv-acts">' +
          (typeof NS.debOpenClub === "function" ? '<button type="button" class="btn ghost sm" id="cvDeb">Open in Club Debtors</button>' : "") +
          '<a class="btn ghost sm" href="' + PORTAL + '" target="_blank" rel="noopener">Live portal &#8599;</a>' +
        '</span>' +
      '</div>' +
      '<div class="cv-grid">' +
        '<div class="cv-frame"><iframe id="cvFrame" title="Club portal for ' + esc(nm) + ' (read-only)" src="' + PORTAL + '/?adminview=1&amp;club=' + encodeURIComponent(CUR.key) + '" loading="eager" referrerpolicy="no-referrer"></iframe></div>' +
        '<aside class="cv-int" id="cvInt" aria-label="Internal panel"><div class="card"><p class="hint">Loading the internal panel&hellip;</p></div></aside>' +
      '</div>';
    document.getElementById("cvBack").onclick = function () { CUR = null; stopToken(); if (IDX) drawList(); else render(); };
    var db = document.getElementById("cvDeb"); if (db) db.onclick = function () { NS.debOpenClub(CUR.key); };
    listen(); startToken();
    NS.sb.rpc("club_internal", { p_club: CUR.key }).then(function (res) {
      if (res.error) throw res.error; CUR.internal = res.data || {}; if (!CUR.name && CUR.internal.name) { CUR.name = CUR.internal.name; var h = r.querySelector(".cv-bt h2"); if (h) h.textContent = CUR.name; }
      drawInternal();
    }).catch(function (e) { var b = document.getElementById("cvInt"); if (b) b.innerHTML = '<div class="card"><div class="msg err">Could not load the internal panel: ' + esc(e.message || e) + '</div></div>'; });
  }

  /* ---------- frame handshake ---------- */
  function sendToken() {
    var f = document.getElementById("cvFrame"); if (!f || !CUR) return;
    NS.sb.auth.getSession().then(function (s) {
      var t = s && s.data && s.data.session && s.data.session.access_token;
      if (t && f.contentWindow) f.contentWindow.postMessage({ type: "cttlfa-adminview", token: t, club: CUR.key }, PORTAL);
    });
  }
  function listen() {
    if (LISTENER) return; LISTENER = true;
    window.addEventListener("message", function (ev) {
      if (ev.origin !== PORTAL) return;
      var d = ev.data || {}, f = document.getElementById("cvFrame");
      if (!f || ev.source !== f.contentWindow) return;
      if (d.type === "cttlfa-adminview-ready") sendToken();
      else if (d.type === "cttlfa-adminview-height" && d.h) f.style.height = Math.max(600, Math.min(20000, Number(d.h) || 0)) + "px";
    });
  }
  function startToken() { stopToken(); TOKEN_TIMER = setInterval(function () { if (!document.getElementById("cvFrame")) { stopToken(); return; } sendToken(); }, 4 * 60 * 1000); }
  function stopToken() { if (TOKEN_TIMER) { clearInterval(TOKEN_TIMER); TOKEN_TIMER = null; } }

  /* ---------- internal panel ---------- */
  function kv(rows) { return '<dl class="cv-kv">' + rows.filter(Boolean).map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join("") + '</dl>'; }
  function drawInternal() {
    var b = document.getElementById("cvInt"); if (!b || !CUR || !CUR.internal) return;
    var d = CUR.internal, col = d.collections || {}, ra = d.registrations_all_time || {};
    var h = '<div class="card cv-ic"><div class="cv-tag">Internal &middot; not shown to the club</div>';
    h += '<h3>Collections</h3>';
    if (d.collections) {
      h += kv([
        ["Stage", esc(col.stage_override || col.step || "–")],
        ["Out of compliance", col.out_of_compliance ? "Yes" + (col.ooc_since ? ", since " + dz(col.ooc_since) : "") : "No"],
        ["Payment plan", col.payment_plan ? "Yes" + (col.plan_note ? " &middot; " + esc(col.plan_note) : "") : "No"],
        ["Last statement", dz(col.statement_last)], ["Last reminder", dz(col.reminder_last)],
        col.follow_up ? ["Follow up", dz(col.follow_up)] : null,
        col.owner ? ["Owner", esc(col.owner)] : null,
        col.next_action ? ["Next action", esc(col.next_action)] : null,
        col.dispute_reason ? ["Dispute", esc(col.dispute_reason)] : null,
        col.note ? ["Note", esc(col.note)] : null ]);
    } else h += '<p class="hint">No collections record.</p>';
    var notes = d.notes || [];
    if (notes.length) {
      h += '<details class="cv-det"><summary>Collection notes (' + notes.length + ')</summary><ul class="cv-notes">' + notes.map(function (n) {
        return '<li><div>' + esc(n.note || "") + '</div><div class="cv-sub">' + dz(n.at) + (n.by ? " &middot; " + esc(n.by) : "") + (n.status ? " &middot; " + esc(n.status) : "") + (n.promise_amount ? " &middot; promise " + rand(n.promise_amount) + (n.promise_date ? " by " + dz(n.promise_date) : "") : "") + '</div></li>';
      }).join("") + '</ul></details>';
    }
    h += '<h3>Registrations, all time</h3>' + kv([["Players ever registered", num(ra.players)], ["Active players", num(ra.active_players)], ["Referees", num(ra.referees)]]) +
      '<p class="cv-sub">The club sees the current-cycle figure. All-time counts are for office reference only.</p>';
    var mc = d.most_carded || [];
    h += '<h3>Most carded players</h3>' + (mc.length ? '<ol class="cv-ol">' + mc.map(function (x) { return '<li>' + esc(x.player) + ' <span class="cv-sub">(' + num(x.n) + ')</span></li>'; }).join("") + '</ol>' : '<p class="hint">No cards on record.</p>');
    var pu = d.portal_users || [];
    h += '<h3>Portal access</h3>' + (pu.length ? '<ul class="cv-ul">' + pu.map(function (u) { return '<li' + (u.active ? "" : ' class="off"') + '><span>' + esc(u.email) + '</span><span class="cv-sub">' + esc([u.name, u.role, u.source, u.active ? "" : "revoked"].filter(Boolean).join(" · ")) + '</span></li>'; }).join("") + '</ul>' : '<p class="hint">No portal logins yet.</p>') +
      '<button type="button" class="btn ghost sm" data-go="clubcontacts">Manage club contacts</button>';
    if (Number(d.pending_edits) > 0) h += '<div class="cv-flag">' + num(d.pending_edits) + ' profile edit' + (Number(d.pending_edits) === 1 ? "" : "s") + ' from the club awaiting approval. <button type="button" class="cv-lnk" data-go="clubportal">Review</button></div>';
    h += '</div>';
    b.innerHTML = h;
    Array.prototype.forEach.call(b.querySelectorAll("[data-go]"), function (x) { x.onclick = function () { if (NS.goTab) NS.goTab(x.getAttribute("data-go")); }; });
  }

  function style() {
    if (document.getElementById("cv-style")) return;
    var css = "" +
      "#clubProfileRoot .cv-head h2,#clubProfileRoot .cv-bar h2{font-family:var(--head);color:var(--navy);margin:0 0 4px}" +
      "#clubProfileRoot .cv-search{width:100%;max-width:360px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;margin-top:10px}" +
      "#clubProfileRoot .cv-search:focus-visible{outline:3px solid var(--blue5);outline-offset:1px}" +
      "#clubProfileRoot .cv-tblwrap{overflow-x:auto;max-height:640px}" +
      "#clubProfileRoot table.cv-tbl{border-collapse:collapse;width:100%;font-size:13.5px}" +
      "#clubProfileRoot table.cv-tbl th,#clubProfileRoot table.cv-tbl td{padding:9px 10px;border-bottom:1px solid var(--line2);text-align:left;vertical-align:top}" +
      "#clubProfileRoot table.cv-tbl thead th{position:sticky;top:0;background:var(--navy);color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;z-index:1}" +
      "#clubProfileRoot table.cv-tbl .num{text-align:right;white-space:nowrap}" +
      "#clubProfileRoot .cv-open{background:none;border:0;padding:0;font:inherit;font-weight:700;color:var(--navy);cursor:pointer;text-align:left;text-decoration:underline;text-decoration-color:rgba(7,26,74,.25);text-underline-offset:3px}" +
      "#clubProfileRoot .cv-open:hover{text-decoration-color:var(--navy)}" +
      "#clubProfileRoot .cv-open:focus-visible{outline:3px solid var(--blue5);outline-offset:2px;border-radius:4px}" +
      "#clubProfileRoot .cv-sub{font-size:11.5px;color:var(--muted)}" +
      "#clubProfileRoot .cv-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap;border:1px solid}" +
      "#clubProfileRoot .cv-pill.ok{background:var(--good-bg);color:var(--good);border-color:var(--good-ln)}" +
      "#clubProfileRoot .cv-pill.mut{background:#eef1f6;color:var(--muted);border-color:var(--line)}" +
      "#clubProfileRoot .cv-pill.warn{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-ln)}" +
      "#clubProfileRoot .cv-pill.bad{background:var(--bad-bg);color:var(--bad);border-color:var(--bad-ln)}" +
      "#clubProfileRoot .cv-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center}" +
      "#clubProfileRoot .cv-bt{flex:1;min-width:220px}" +
      "#clubProfileRoot .cv-acts{display:flex;flex-wrap:wrap;gap:8px}" +
      "#clubProfileRoot .btn.sm{font-size:12px;padding:8px 13px;min-height:36px;text-decoration:none;display:inline-flex;align-items:center}" +
      "#clubProfileRoot .cv-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}" +
      "#clubProfileRoot .cv-frame{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}" +
      "#clubProfileRoot .cv-frame iframe{display:block;width:100%;height:1400px;border:0}" +
      "#clubProfileRoot .cv-int{position:sticky;top:12px}" +
      "#clubProfileRoot .cv-ic h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--navy);margin:16px 0 6px}" +
      "#clubProfileRoot .cv-tag{display:inline-block;background:var(--navy);color:#fff;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:3px 10px}" +
      "#clubProfileRoot .cv-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:12.5px}" +
      "#clubProfileRoot .cv-kv dt{color:var(--muted)}#clubProfileRoot .cv-kv dd{margin:0;font-weight:600;color:var(--ink)}" +
      "#clubProfileRoot .cv-det summary{cursor:pointer;font-size:12.5px;font-weight:700;color:var(--navy);margin-top:8px}" +
      "#clubProfileRoot .cv-notes,#clubProfileRoot .cv-ul{list-style:none;margin:6px 0 8px;padding:0;font-size:12.5px}" +
      "#clubProfileRoot .cv-notes li,#clubProfileRoot .cv-ul li{padding:6px 0;border-bottom:1px solid var(--line2);display:flex;flex-direction:column;gap:2px;word-break:break-word}" +
      "#clubProfileRoot .cv-ul li.off span:first-child{text-decoration:line-through;color:var(--muted)}" +
      "#clubProfileRoot .cv-ol{margin:0;padding-left:20px;font-size:12.5px;line-height:1.7}" +
      "#clubProfileRoot .cv-flag{margin-top:12px;background:var(--warn-bg);border:1px solid var(--warn-ln);color:var(--warn);border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:600}" +
      "#clubProfileRoot .cv-lnk{background:none;border:0;color:var(--navy);text-decoration:underline;font:inherit;font-weight:700;cursor:pointer;padding:0 2px}" +
      "#clubProfileRoot .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
      "@media(max-width:1100px){#clubProfileRoot .cv-grid{grid-template-columns:1fr}#clubProfileRoot .cv-int{position:static;order:-1}}";
    var st = document.createElement("style"); st.id = "cv-style"; st.textContent = css; document.head.appendChild(st);
  }

  NS.renderClubProfile = render;
  NS.openClubView = function (key) { NS._cvPending = key; if (NS.goTab) NS.goTab("clubprofile"); else render(); };
})(window.AC = window.AC || {});
