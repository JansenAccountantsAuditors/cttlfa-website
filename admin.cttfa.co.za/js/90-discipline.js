/* CTTLFA admin — Discipline, Referees & Cards + Club Profile.
   Closure over window.AC. Reads live from the dash.cttlfa.com mirror held
   in the main Supabase (dash_* views), via the admin-guarded RPCs
   dash_discipline_dashboard(), club_profile_index() and club_profile(text).
   Read-only. The mirror is refreshed by the nightly dash fetch; this module
   never writes. Figures follow SA conventions: space thousands, full stop
   decimal, brackets for negatives, en dash for nil. Operational data,
   unaudited — shown for Mancom monitoring, not for the financial statements. */
(function (NS) {
  "use strict";

  /* ---------- formatting (SA conventions) ---------- */
  function grp(s){ return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function num(n, dp){ dp = dp==null?0:dp; if(n==null||n===""||isNaN(n)) return "–";
    var neg=Number(n)<0, v=Math.abs(Number(n)).toFixed(dp), p=v.split(".");
    var s=grp(p[0])+(p[1]?"."+p[1]:""); return neg?"("+s+")":s; }
  function rand(n, dp){ dp = dp==null?0:dp; if(n==null||n===""||isNaN(n)) return "–";
    var neg=Number(n)<0, v=Math.abs(Number(n)).toFixed(dp), p=v.split(".");
    var s="R "+grp(p[0])+(p[1]?"."+p[1]:""); return neg?"("+s+")":s; }
  function esc(s){ return NS.esc ? NS.esc(s) : String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  function dt(s){ if(!s) return "–"; try{ var d=new Date(s); if(isNaN(d)) return esc(String(s).slice(0,10));
    return d.getDate()+" "+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]+" "+d.getFullYear(); }catch(e){ return esc(String(s).slice(0,10)); } }
  function ym(s){ if(!s) return ""; var p=String(s).split("-"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(+p[1])-1]+" "+p[0].slice(2); }

  /* ---------- shared styles (injected once) ---------- */
  function ensureStyle(){
    if(document.getElementById("dscStyle")) return;
    var st=document.createElement("style"); st.id="dscStyle";
    st.textContent =
      ".dsc-prov{display:flex;flex-wrap:wrap;gap:5px 22px;font-size:12px;color:var(--muted);margin-top:8px}.dsc-prov b{color:var(--ink)}.dsc-prov .warn{color:#9A3130;font-weight:700}"+
      ".dsc-kpis{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:14px 0;background:#fff}"+
      ".dsc-kpi{padding:15px 18px;border-right:1px solid var(--line)}.dsc-kpi:last-child{border-right:0}"+
      ".dsc-kpi .k{font-size:12px;font-weight:600;color:var(--muted)}.dsc-kpi .v{font-family:var(--head);font-weight:800;font-size:26px;line-height:1.05;margin-top:3px;font-variant-numeric:tabular-nums}.dsc-kpi .s{font-size:11.5px;margin-top:3px;color:var(--muted)}"+
      "@media(max-width:820px){.dsc-kpis{grid-template-columns:1fr 1fr}.dsc-kpi{border-bottom:1px solid var(--line)}}"+
      ".dsc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.dsc-grid{grid-template-columns:1fr}}"+
      ".dsc-sec{font-family:var(--cond);font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--navy);font-size:13px;margin:2px 0 10px}"+
      ".dsc-bar{display:flex;align-items:center;gap:9px;margin:5px 0;font-size:12.5px}.dsc-bar .lab{flex:0 0 42%;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsc-bar .tr{flex:1;height:9px;background:var(--line2);border-radius:5px;overflow:hidden}.dsc-bar .tr i{display:block;height:100%;background:var(--blue);border-radius:5px}.dsc-bar .vv{flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:700;color:var(--navy);min-width:34px;text-align:right}"+
      ".dsc-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.dsc-tbl th{background:var(--navy);color:#fff;text-align:left;padding:7px 9px;font-size:11px;font-weight:700;white-space:nowrap;position:sticky;top:0}.dsc-tbl th.num,.dsc-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.dsc-tbl td{padding:6px 9px;border-bottom:1px solid var(--line2)}.dsc-tbl tbody tr:hover td{background:#F7F9FD}"+
      ".dsc-tblwrap{overflow:auto;max-height:360px;border:1px solid var(--line);border-radius:10px}"+
      ".dsc-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}.dsc-pill.bad{background:#FBECEA;color:#8a2e26}.dsc-pill.warn{background:#FCF3D8;color:#7a4d10}.dsc-pill.ok{background:#E7F5EC;color:#1c5136}.dsc-pill.mut{background:#EEF2FA;color:#5A667C}"+
      ".dsc-spark{display:flex;align-items:flex-end;gap:3px;height:52px;margin-top:6px}.dsc-spark .b{flex:1;background:var(--blue);border-radius:2px 2px 0 0;min-height:2px}.dsc-spark .b span{display:block}"+
      ".dsc-empty{border:1px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--muted);background:#fff}"+
      ".cpf-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.cpf-controls input{flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px}"+
      ".cpf-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.cpf-two{grid-template-columns:1fr}}"+
      ".cpf-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:13px;margin:8px 0}.cpf-kv span{color:var(--muted)}.cpf-kv b{text-align:right;font-variant-numeric:tabular-nums}";
    document.head.appendChild(st);
  }

  function hbars(rows, labKey, valKey, unit){
    if(!rows || !rows.length) return '<p class="hint" style="margin:4px 0">No data.</p>';
    var max=0; rows.forEach(function(r){ max=Math.max(max, Number(r[valKey])||0); }); if(max<=0) max=1;
    return rows.map(function(r){
      var v=Number(r[valKey])||0, w=Math.round(v/max*100);
      return '<div class="dsc-bar"><span class="lab" title="'+esc(r[labKey])+'">'+esc(r[labKey]||"–")+'</span>'+
        '<span class="tr"><i style="width:'+w+'%"></i></span><span class="vv">'+num(v)+(unit||"")+'</span></div>';
    }).join("");
  }

  /* ==================== DISCIPLINE DASHBOARD ==================== */
  function renderDiscipline(){
    ensureStyle();
    var root = NS.$("disciplineRoot"); if(!root) return;
    root.innerHTML = '<div class="card"><p class="hint">Loading Discipline, Referees &amp; Cards…</p></div>';
    NS.sb.rpc("dash_discipline_dashboard").then(function(r){
      if(r.error) throw r.error;
      drawDiscipline(root, r.data || {});
    }).catch(function(e){
      root.innerHTML = '<div class="card"><h3>Discipline, Referees &amp; Cards</h3><p class="hint">Could not load: '+esc(e.message||e)+'</p></div>';
    });
  }

  function drawDiscipline(root, d){
    var meta=d.meta||{}, cards=d.cards||{}, ru=d.rulings||{}, refs=d.referees||{}, sus=d.suspensions||{};
    var present = meta.present;
    var head =
      '<div class="card">'+
        '<h2 style="font-family:var(--head);color:var(--navy);margin:0 0 2px">Discipline, Referees &amp; Cards</h2>'+
        '<div class="dsc-prov">'+
          '<span>Source: <b>dash.cttlfa.com</b> mirror</span>'+
          '<span>Last sync: <b>'+(meta.last_pull?dt(meta.last_pull):'<span class="warn">not yet synced</span>')+'</b></span>'+
          '<span>Basis: <b>operational, unaudited</b></span>'+
          '<span>Currency: <b>ZAR</b></span>'+
        '</div>'+
      '</div>';

    if(!present){
      root.innerHTML = head +
        '<div class="dsc-empty" style="margin-top:16px"><h3 style="color:var(--navy);margin:0 0 6px">Awaiting the first dash sync</h3>'+
        '<p style="max-width:60ch;margin:0 auto">The disciplinary data model is built and this view is live, but the mirror has not yet been populated. '+
        'Run the dash fetch once (or wait for the nightly 02h00 sync) and this dashboard fills automatically — yellow cards, suspensions, rulings, fines and referee appointments, all read from the database.</p></div>';
      return;
    }

    var kpi =
      '<div class="dsc-kpis">'+
        '<div class="dsc-kpi"><div class="k">Yellow cards (mirror)</div><div class="v">'+num(cards.total)+'</div><div class="s">across '+num((cards.by_division||[]).length)+' divisions</div></div>'+
        '<div class="dsc-kpi"><div class="k">Players at suspension risk</div><div class="v">'+num((sus.at_risk||[]).length)+'</div><div class="s">at or over the card threshold</div></div>'+
        '<div class="dsc-kpi"><div class="k">Fines outstanding</div><div class="v">'+rand(ru.outstanding_amount)+'</div><div class="s">'+num(ru.outstanding_n)+' unpaid of '+num(ru.issued_n)+' issued</div></div>'+
        '<div class="dsc-kpi"><div class="k">Referees active</div><div class="v">'+num(refs.active)+'</div><div class="s">of '+num(refs.total)+' on record</div></div>'+
      '</div>';

    // cards spark by month
    var bm = cards.by_month||[];
    var maxm=0; bm.forEach(function(x){ maxm=Math.max(maxm, x.n||0); }); if(maxm<=0) maxm=1;
    var spark = bm.length ? '<div class="dsc-spark">'+bm.map(function(x){
        return '<div class="b" style="height:'+Math.round((x.n||0)/maxm*100)+'%" title="'+esc(ym(x.ym))+': '+num(x.n)+'"></div>'; }).join("")+'</div>'+
        '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:3px"><span>'+esc(ym(bm[0].ym))+'</span><span>'+esc(ym(bm[bm.length-1].ym))+'</span></div>'
      : '<p class="hint">No dated cards.</p>';

    var cardsBlock =
      '<div class="card"><div class="dsc-sec">Yellow cards by division</div>'+hbars(cards.by_division,"division","n")+'</div>'+
      '<div class="card"><div class="dsc-sec">Cards by month</div>'+spark+'</div>';

    var topPlayers = (cards.top_players||[]).map(function(p){
      return '<tr><td>'+esc(p.player)+'</td><td>'+esc(p.club||"–")+'</td><td class="num">'+num(p.n)+'</td></tr>'; }).join("");
    var byClub = (cards.by_club||[]).map(function(c){
      return '<tr><td>'+esc(c.club)+'</td><td class="num">'+num(c.n)+'</td></tr>'; }).join("");

    var playersBlock =
      '<div class="card"><div class="dsc-sec">Most-carded players</div>'+
        '<div class="dsc-tblwrap"><table class="dsc-tbl"><thead><tr><th>Player</th><th>Club</th><th class="num">Cards</th></tr></thead>'+
        '<tbody>'+(topPlayers||'<tr><td colspan="3" class="hint">No data.</td></tr>')+'</tbody></table></div></div>'+
      '<div class="card"><div class="dsc-sec">Cards by club</div>'+
        '<div class="dsc-tblwrap"><table class="dsc-tbl"><thead><tr><th>Club</th><th class="num">Cards</th></tr></thead>'+
        '<tbody>'+(byClub||'<tr><td colspan="2" class="hint">No data.</td></tr>')+'</tbody></table></div></div>';

    // rulings
    var unpaid = (ru.unpaid||[]).map(function(u){
      return '<tr><td>'+esc(u.case_number||"–")+'</td><td>'+esc(u.club||"–")+'</td><td>'+esc(u.player||"–")+'</td>'+
        '<td>'+esc(u.article||"–")+'</td><td class="num">'+rand(u.fine_amount)+'</td><td>'+esc(u.invoice_number||"–")+'</td><td>'+dt(u.match_date)+'</td></tr>'; }).join("");
    var rulingsBlock =
      '<div class="card">'+
        '<div class="dsc-sec">Administrative rulings &amp; fines</div>'+
        '<div class="cpf-kv">'+
          '<span>Rulings on record</span><b>'+num(ru.total)+'</b>'+
          '<span>Fines issued</span><b>'+num(ru.issued_n)+' &middot; '+rand(ru.issued_amount)+'</b>'+
          '<span>Fines paid</span><b>'+num(ru.paid_n)+' &middot; '+rand(ru.paid_amount)+'</b>'+
          '<span>Outstanding</span><b>'+num(ru.outstanding_n)+' &middot; '+rand(ru.outstanding_amount)+'</b>'+
        '</div>'+
        '<div class="dsc-grid" style="margin-top:8px">'+
          '<div><div class="dsc-sec">By outcome</div>'+hbars(ru.by_outcome,"outcome","n")+'</div>'+
          '<div><div class="dsc-sec">By article</div>'+hbars(ru.by_article,"article","n")+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="card"><div class="dsc-sec">Unpaid fines <span class="dsc-pill bad">'+num(ru.outstanding_n)+' open</span></div>'+
        '<div class="dsc-tblwrap"><table class="dsc-tbl"><thead><tr><th>Case</th><th>Club</th><th>Player</th><th>Article</th><th class="num">Fine</th><th>Invoice</th><th>Match date</th></tr></thead>'+
        '<tbody>'+(unpaid||'<tr><td colspan="7" class="hint">No unpaid fines recorded.</td></tr>')+'</tbody></table></div>'+
        '<p class="hint" style="margin-top:6px">Invoice numbers tie disciplinary fines back to Sage and the debtors ledger. Unaudited operational extract.</p></div>';

    // referees & suspensions
    var topAppt = (refs.top_appointments||[]).map(function(x){
      return '<tr><td>'+esc(x.referee)+'</td><td class="num">'+num(x.appts)+'</td></tr>'; }).join("");
    var atRisk = (sus.at_risk||[]).map(function(x){
      return '<tr><td>'+esc(x.player)+'</td><td>'+esc(x.club||"–")+'</td><td class="num">'+num(x.cards)+'</td></tr>'; }).join("");
    var rules = (sus.rules||[]).map(function(x){
      return '<tr><td class="num">'+num(x.card_count)+'</td><td class="num">'+num(x.suspension_matches)+'</td></tr>'; }).join("");
    var refBlock =
      '<div class="card"><div class="dsc-sec">Referees</div>'+
        '<div class="cpf-kv"><span>On record</span><b>'+num(refs.total)+'</b><span>Active</span><b>'+num(refs.active)+'</b><span>Accreditations</span><b>'+num(refs.accreditations)+'</b></div>'+
        '<div class="dsc-sec" style="margin-top:10px">By level</div>'+hbars(refs.by_level,"level","n")+
        '<div class="dsc-sec" style="margin-top:10px">Most appointments</div>'+
        '<div class="dsc-tblwrap" style="max-height:220px"><table class="dsc-tbl"><thead><tr><th>Referee</th><th class="num">Appts</th></tr></thead><tbody>'+(topAppt||'<tr><td colspan="2" class="hint">No appointments.</td></tr>')+'</tbody></table></div>'+
      '</div>'+
      '<div class="card"><div class="dsc-sec">Suspensions</div>'+
        '<div class="dsc-sec" style="font-size:12px;color:var(--muted)">Accumulation thresholds</div>'+
        '<table class="dsc-tbl" style="margin-bottom:10px"><thead><tr><th class="num">Cards</th><th class="num">Matches suspended</th></tr></thead><tbody>'+(rules||'<tr><td colspan="2" class="hint">No rules.</td></tr>')+'</tbody></table>'+
        '<div class="dsc-sec">Players at risk <span class="dsc-pill warn">'+num((sus.at_risk||[]).length)+'</span></div>'+
        '<div class="dsc-tblwrap" style="max-height:220px"><table class="dsc-tbl"><thead><tr><th>Player</th><th>Club</th><th class="num">Cards</th></tr></thead><tbody>'+(atRisk||'<tr><td colspan="3" class="hint">None at threshold.</td></tr>')+'</tbody></table></div>'+
      '</div>';

    root.innerHTML = head + kpi +
      '<div class="dsc-grid">'+cardsBlock+'</div>'+
      '<div class="dsc-grid" style="margin-top:16px">'+playersBlock+'</div>'+
      '<div style="margin-top:16px">'+rulingsBlock+'</div>'+
      '<div class="dsc-grid" style="margin-top:16px">'+refBlock+'</div>';
  }

  /* ==================== CLUB PROFILE ==================== */
  var _cpfIndex = null;

  function renderClubProfile(){
    ensureStyle();
    var root = NS.$("clubProfileRoot"); if(!root) return;
    root.innerHTML = '<div class="card"><p class="hint">Loading Club Profile…</p></div>';
    NS.sb.rpc("club_profile_index").then(function(r){
      if(r.error) throw r.error;
      _cpfIndex = r.data || {};
      drawClubIndex(root, _cpfIndex);
    }).catch(function(e){
      root.innerHTML = '<div class="card"><h3>Club Profile</h3><p class="hint">Could not load: '+esc(e.message||e)+'</p></div>';
    });
  }

  function drawClubIndex(root, d){
    var meta=d.meta||{}, clubs=(d.clubs||[]).slice();
    var head =
      '<div class="card">'+
        '<h2 style="font-family:var(--head);color:var(--navy);margin:0 0 2px">Club Profile</h2>'+
        '<div style="color:var(--muted);font-size:13.5px;max-width:90ch">One place per club. Registrations and players from the register, the Sage debtor position, and discipline and fines from the disciplinary system — drawn together into a single club two-pager for Mancom. Pick a club to open its profile.</div>'+
        '<div class="dsc-prov"><span>Debtors: <b>'+(meta.debtor_snapshot?'current snapshot':'–')+'</b></span>'+
          '<span>Discipline: <b>'+(meta.dash_present?'from dash mirror':'<span class="warn">awaiting first sync</span>')+'</b></span>'+
          '<span>Basis: <b>operational, unaudited</b></span></div>'+
        '<div class="cpf-controls"><input id="cpfSearch" type="text" placeholder="Search clubs…" autocomplete="off"></div>'+
      '</div>';

    function tbl(list){
      return list.map(function(c){
        var st = c.status || "–";
        var cls = /credit|paid/i.test(st)?"ok":/current|below/i.test(st)?"mut":/reminder/i.test(st)?"warn":st==="–"?"mut":"bad";
        return '<tr data-club="'+esc(c.name)+'" style="cursor:pointer">'+
          '<td><b>'+esc(c.name)+'</b></td>'+
          '<td class="num">'+num(c.players)+'</td>'+
          '<td class="num">'+num(c.seniors)+'</td>'+
          '<td class="num">'+num(c.juniors)+'</td>'+
          '<td class="num">'+(c.bal==null?"–":rand(c.bal))+'</td>'+
          '<td><span class="dsc-pill '+cls+'">'+esc(st)+'</span></td>'+
          '<td class="num">'+num(c.cards)+'</td>'+
          '<td class="num">'+num(c.rulings)+'</td>'+
          '<td class="num">'+(Number(c.fines_outstanding)>0?rand(c.fines_outstanding):"–")+'</td>'+
        '</tr>';
      }).join("");
    }

    var table =
      '<div class="card"><div id="cpfDetail"></div>'+
        '<div class="dsc-tblwrap" style="max-height:520px"><table class="dsc-tbl"><thead><tr>'+
          '<th>Club</th><th class="num">Players</th><th class="num">Snr</th><th class="num">Jnr</th>'+
          '<th class="num">Debtor</th><th>Status</th><th class="num">Cards</th><th class="num">Rulings</th><th class="num">Fines out</th>'+
        '</tr></thead><tbody id="cpfRows">'+(tbl(clubs)||'<tr><td colspan="9" class="hint">No clubs.</td></tr>')+'</tbody></table></div>'+
        '<p class="hint" style="margin-top:6px">Players and categories from the registration master; debtor balances from Sage (brackets denote credits); cards, rulings and fines from the disciplinary system. Operational, unaudited.</p>'+
      '</div>';

    root.innerHTML = head + table;

    var body = NS.$("cpfRows"), search = NS.$("cpfSearch");
    function wire(){
      Array.prototype.forEach.call(body.querySelectorAll("tr[data-club]"), function(tr){
        tr.onclick = function(){ openClub(tr.getAttribute("data-club")); };
      });
    }
    wire();
    if(search){ search.oninput = function(){
      var q=this.value.trim().toLowerCase();
      var list = q ? clubs.filter(function(c){ return c.name.toLowerCase().indexOf(q)>=0; }) : clubs;
      body.innerHTML = tbl(list) || '<tr><td colspan="9" class="hint">No match.</td></tr>'; wire();
    }; }
  }

  function openClub(name){
    var box = NS.$("cpfDetail"); if(!box) return;
    box.innerHTML = '<div class="card" style="background:#F7F9FC;margin-bottom:12px"><p class="hint">Loading '+esc(name)+'…</p></div>';
    try{ box.scrollIntoView({behavior:"smooth",block:"start"}); }catch(e){}
    NS.sb.rpc("club_profile", {p_club:name}).then(function(r){
      if(r.error) throw r.error;
      drawClub(box, r.data||{});
    }).catch(function(e){
      box.innerHTML = '<div class="card" style="margin-bottom:12px"><p class="hint">Could not load '+esc(name)+': '+esc(e.message||e)+'</p></div>';
    });
  }

  function drawClub(box, d){
    if(!d.found){ box.innerHTML='<div class="card" style="margin-bottom:12px"><p class="hint">Club not found.</p></div>'; return; }
    var c=d.club||{}, reg=d.registrations||{}, deb=d.debtors, dis=d.discipline||{}, meta=d.meta||{};
    var byCat=(reg.by_category||[]).map(function(x){ return esc(x.category)+" "+num(x.n); }).join(" &middot; ");
    var debBlock;
    if(deb){
      var st=deb.status||"–";
      var cls=/credit|paid/i.test(st)?"ok":/current|below/i.test(st)?"mut":/reminder/i.test(st)?"warn":"bad";
      debBlock =
        '<div class="cpf-kv">'+
          '<span>Balance</span><b>'+rand(deb.bal)+'</b>'+
          '<span>Status</span><b><span class="dsc-pill '+cls+'">'+esc(st)+'</span></b>'+
          '<span>Current</span><b>'+rand(deb.cur)+'</b>'+
          '<span>30 / 60 / 90 / 120+</span><b>'+rand(deb.b30)+' / '+rand(deb.b60)+' / '+rand(deb.b90)+' / '+rand(deb.b120)+'</b>'+
          '<span>Last receipt</span><b>'+(deb.last_receipt_days==null?"–":num(deb.last_receipt_days)+" days ago")+'</b>'+
        '</div>'+
        (deb.contact ? '<div class="hint" style="margin-top:4px">Contact: '+esc(deb.contact.email||"–")+(deb.contact.phone?" &middot; "+esc(deb.contact.phone):"")+'</div>' : '');
    } else {
      debBlock = '<p class="hint">No Sage debtor account matched to this club in the current snapshot.</p>';
    }

    var unpaid=(dis.unpaid||[]).map(function(u){
      return '<tr><td>'+esc(u.case_number||"–")+'</td><td>'+esc(u.player||"–")+'</td><td>'+esc(u.article||"–")+'</td><td class="num">'+rand(u.fine_amount)+'</td><td>'+esc(u.invoice_number||"–")+'</td></tr>'; }).join("");
    var atRisk=(dis.at_risk||[]).map(function(x){ return esc(x.player)+" ("+num(x.cards)+")"; }).join(", ");
    var topP=(dis.top_players||[]).map(function(x){ return esc(x.player)+" ("+num(x.n)+")"; }).join(", ");

    box.innerHTML =
      '<div class="card" style="margin-bottom:14px;border:1.5px solid var(--blue)">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">'+
          '<div><h2 style="font-family:var(--head);color:var(--navy);margin:0">'+esc(c.name)+'</h2>'+
            '<div class="hint">'+esc(c.type||"club")+(c.active?"":" &middot; inactive")+' &middot; generated '+dt(meta.generated)+'</div></div>'+
          '<button class="btn ghost sm" id="cpfClose">Close</button>'+
        '</div>'+
        '<div class="cpf-two" style="margin-top:12px">'+
          '<div><div class="dsc-sec">Registrations</div>'+
            '<div class="cpf-kv">'+
              '<span>Players</span><b>'+num(reg.players)+'</b>'+
              '<span>Active players</span><b>'+num(reg.active_players)+'</b>'+
              '<span>Referees</span><b>'+num(reg.referees)+'</b>'+
              '<span>Seniors / Juniors</span><b>'+num(reg.seniors)+' / '+num(reg.juniors)+'</b>'+
              '<span>Foreign players</span><b>'+num(reg.foreign_players)+'</b>'+
              '<span>Latest season</span><b>'+esc(reg.latest_season||"–")+'</b>'+
            '</div>'+
            (byCat?'<div class="hint">'+byCat+'</div>':'')+
          '</div>'+
          '<div><div class="dsc-sec">Debtor position (Sage)</div>'+debBlock+'</div>'+
        '</div>'+
        '<div class="dsc-sec" style="margin-top:14px">Discipline</div>'+
        '<div class="cpf-kv">'+
          '<span>Yellow cards</span><b>'+num(dis.cards_total)+'</b>'+
          '<span>Rulings</span><b>'+num(dis.rulings_total)+'</b>'+
          '<span>Fines issued / paid</span><b>'+rand(dis.fines_issued_amount)+' / '+rand(dis.fines_paid_amount)+'</b>'+
          '<span>Fines outstanding</span><b>'+rand(dis.fines_outstanding_amount)+'</b>'+
        '</div>'+
        (topP?'<div class="hint" style="margin-top:4px">Most carded: '+topP+'</div>':'')+
        (atRisk?'<div class="hint" style="margin-top:2px">At suspension risk: '+atRisk+'</div>':'')+
        (unpaid?'<div class="dsc-tblwrap" style="margin-top:8px;max-height:220px"><table class="dsc-tbl"><thead><tr><th>Case</th><th>Player</th><th>Article</th><th class="num">Fine</th><th>Invoice</th></tr></thead><tbody>'+unpaid+'</tbody></table></div>':'')+
        (meta.has_dash?'':'<p class="hint" style="margin-top:8px">Discipline figures await the first dash sync.</p>')+
      '</div>';

    var cl=NS.$("cpfClose"); if(cl) cl.onclick=function(){ box.innerHTML=""; };
  }

  NS.renderDiscipline = renderDiscipline;
  NS.renderClubProfile = renderClubProfile;
})(window.AC);
