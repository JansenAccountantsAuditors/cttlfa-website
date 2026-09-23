/* CTTLFA admin — Discipline, Referees & Cards + Club Profile.
   Closure over window.AC. Reads live from the dash.cttlfa.com mirror held
   in the main Supabase (dash_* views), via admin-guarded RPCs
   dash_discipline_dashboard(), dash_discipline_rows(), club_profile_index(),
   club_profile(); "Fetch now" queues dash_request_refresh() and polls
   dash_refresh_state() while a dash agent (dash_fetch.py --agent) services it.
   Read-only reporting for Mancom. Figures follow SA conventions: space
   thousands, full stop decimal, brackets for negatives, en dash for nil.
   Operational data, unaudited. */
(function (NS) {
  "use strict";

  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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
    return d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear(); }catch(e){ return esc(String(s).slice(0,10)); } }
  function pad(x){ return (x<10?"0":"")+x; }
  function dtime(s){ if(!s) return "not yet synced"; try{ var d=new Date(s); if(isNaN(d)) return esc(String(s));
    return d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear()+", "+pad(d.getHours())+":"+pad(d.getMinutes()); }catch(e){ return esc(String(s)); } }
  function ym(s){ if(!s) return ""; var p=String(s).split("-"); return MON[(+p[1])-1]+" "+p[0].slice(2); }
  function slug(s){ return "cttlfa-"+String(s||"discipline").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60); }

  /* ---------- styles ---------- */
  function ensureStyle(){
    if(document.getElementById("dscStyle")) return;
    var st=document.createElement("style"); st.id="dscStyle";
    st.textContent =
      ".dsc-prov{display:flex;flex-wrap:wrap;gap:5px 20px;font-size:12px;color:var(--muted);margin-top:8px}.dsc-prov b{color:var(--ink)}.dsc-prov .warn{color:#9A3130;font-weight:700}"+
      ".dsc-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}"+
      ".dsc-toolbar .sp{flex:1}.dsc-fstat{font-size:11.5px;color:var(--muted)}"+
      ".dsc-link{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:var(--blue);text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:7px 11px;background:#fff}.dsc-link:hover{background:#F7F9FD}"+
      ".dsc-kpis{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:14px 0;background:#fff}"+
      ".dsc-kpi{padding:15px 18px;border-right:1px solid var(--line)}.dsc-kpi:last-child{border-right:0}"+
      ".dsc-kpi .k{font-size:12px;font-weight:600;color:var(--muted)}.dsc-kpi .v{font-family:var(--head);font-weight:800;font-size:26px;line-height:1.05;margin-top:3px;font-variant-numeric:tabular-nums}.dsc-kpi .s{font-size:11.5px;margin-top:3px;color:var(--muted)}"+
      "@media(max-width:820px){.dsc-kpis{grid-template-columns:1fr 1fr}.dsc-kpi{border-bottom:1px solid var(--line)}}"+
      ".dsc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch}@media(max-width:900px){.dsc-grid{grid-template-columns:1fr}}"+
      ".dsc-grid > .card{height:100%;display:flex;flex-direction:column;margin:0}"+
      ".dsc-bh{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}"+
      ".dsc-sec{font-family:var(--cond);font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--navy);font-size:13px}"+
      ".dsc-acts{display:flex;gap:5px;flex:0 0 auto}"+
      ".dsc-x{font-size:10.5px;font-weight:700;color:var(--muted);background:#F3F6FC;border:1px solid var(--line);border-radius:7px;padding:3px 8px;cursor:pointer;letter-spacing:.02em}.dsc-x:hover{background:#E9EFF9;color:var(--navy)}"+
      ".dsc-bars{display:flex;flex-direction:column;gap:5px;overflow:auto;flex:1;min-height:40px}"+
      ".dsc-bar{display:flex;align-items:center;gap:9px;font-size:12.5px;cursor:pointer;border-radius:6px;padding:1px 3px}.dsc-bar:hover{background:#F5F8FD}"+
      ".dsc-bar .lab{flex:0 0 44%;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsc-bar .tr{flex:1;height:9px;background:var(--line2);border-radius:5px;overflow:hidden}.dsc-bar .tr i{display:block;height:100%;background:var(--blue);border-radius:5px}.dsc-bar .vv{flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:700;color:var(--navy);min-width:38px;text-align:right}"+
      ".dsc-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.dsc-tbl th{background:var(--navy);color:#fff;text-align:left;padding:7px 9px;font-size:11px;font-weight:700;white-space:nowrap;position:sticky;top:0;z-index:1}.dsc-tbl th.num,.dsc-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.dsc-tbl td{padding:6px 9px;border-bottom:1px solid var(--line2);vertical-align:top}.dsc-tbl tbody tr.clk{cursor:pointer}.dsc-tbl tbody tr.clk:hover td{background:#F5F8FD}.dsc-tbl td.wrap{white-space:normal;word-break:break-word;max-width:0;width:100%}"+
      ".dsc-tblwrap{overflow:auto;flex:1;min-height:40px;border:1px solid var(--line);border-radius:10px}"+
      ".dsc-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}.dsc-pill.bad{background:#FBECEA;color:#8a2e26}.dsc-pill.warn{background:#FCF3D8;color:#7a4d10}.dsc-pill.ok{background:#E7F5EC;color:#1c5136}.dsc-pill.mut{background:#EEF2FA;color:#5A667C}"+
      ".dsc-chart{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:16px;flex:1}"+
      ".dsc-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;cursor:pointer}"+
      ".dsc-col .bar{width:100%;max-width:38px;background:var(--blue);border-radius:3px 3px 0 0;min-height:2px;position:relative}.dsc-col:hover .bar{background:var(--navy)}"+
      ".dsc-col .cv{font-size:10.5px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;margin-bottom:3px}.dsc-col .cl{font-size:10px;color:var(--muted);margin-top:5px;white-space:nowrap}"+
      ".dsc-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:13px;margin:2px 0 8px}.dsc-kv span{color:var(--muted)}.dsc-kv b{text-align:right;font-variant-numeric:tabular-nums}"+
      ".dsc-empty{border:1px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--muted);background:#fff}"+
      ".dsc-scrim{position:fixed;inset:0;background:rgba(7,20,55,.42);opacity:0;pointer-events:none;transition:opacity .18s;z-index:998}.dsc-scrim.on{opacity:1;pointer-events:auto}"+
      ".dsc-drawer{position:fixed;top:0;right:0;height:100vh;width:min(720px,97vw);background:#fff;box-shadow:-16px 0 44px rgba(7,20,55,.24);transform:translateX(100%);transition:transform .2s;z-index:999;display:flex;flex-direction:column}.dsc-drawer.on{transform:none}"+
      ".dsc-dh{background:var(--navy);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.dsc-dh h3{color:#fff;margin:0;font-family:var(--head);font-size:17px}.dsc-dh .dsub{color:#C7D2EC;font-size:12px;margin-top:2px}.dsc-dx{background:transparent;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:17px;flex:0 0 auto}"+
      ".dsc-db{padding:14px 18px 30px;overflow:auto;flex:1}"+
      ".cpf-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.cpf-controls input{flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px}"+
      ".cpf-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.cpf-two{grid-template-columns:1fr}}";
    document.head.appendChild(st);
  }

  /* ---------- exports (PDF matches the other admin PDFs; CSV with BOM) ---------- */
  function expPDF(title, subtitle, columns, rows){
    if(!window.jspdf){ alert("PDF library still loading, try again."); return; }
    var doc=new window.jspdf.jsPDF({unit:"pt",format:"a4"});
    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();
    doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.setTextColor(7,26,74);
    doc.text("CTTLFA — "+title, 40, 46);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(90,101,119);
    doc.text(subtitle||"", 40, 62);
    doc.autoTable({ startY:78, head:[columns], body:rows,
      styles:{fontSize:8.5,cellPadding:4,overflow:"linebreak",textColor:[20,30,50]},
      headStyles:{fillColor:[7,26,74],textColor:255,fontStyle:"bold"},
      alternateRowStyles:{fillColor:[247,249,253]}, margin:{left:40,right:40},
      didDrawPage:function(){ doc.setFontSize(8); doc.setTextColor(140,150,165);
        doc.text("dash.cttlfa.com mirror · operational, unaudited · generated "+new Date().toLocaleString("en-ZA"), 40, H-20);
        doc.text("Page "+doc.internal.getCurrentPageInfo().pageNumber, W-64, H-20); } });
    doc.save(slug(title)+".pdf");
  }
  function expCSV(title, columns, rows){
    function q(v){ v=(v==null?"":String(v)).replace(/ /g," "); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
    var lines=[columns.map(q).join(",")].concat(rows.map(function(r){ return r.map(q).join(","); }));
    var blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=slug(title)+".csv";
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },0);
  }

  // export registry: buttons carry a key; wired after render
  var _exp={}, _expN=0, _subtitle="";
  function acts(title, columns, rows){ var k="e"+(++_expN); _exp[k]={title:title,columns:columns,rows:rows};
    return '<span class="dsc-acts"><button class="dsc-x" data-pdf="'+k+'">PDF</button><button class="dsc-x" data-csv="'+k+'">CSV</button></span>'; }
  function bhead(title, title2, columns, rows){
    return '<div class="dsc-bh"><span class="dsc-sec">'+esc(title)+'</span>'+acts(title2||title, columns, rows)+'</div>'; }

  /* ---------- drill drawer ---------- */
  function ensureDrawer(){
    if(document.getElementById("dscDrawer")) return;
    var s=document.createElement("div"); s.className="dsc-scrim"; s.id="dscScrim";
    var d=document.createElement("div"); d.className="dsc-drawer"; d.id="dscDrawer";
    d.innerHTML='<div class="dsc-dh"><div><h3 id="dscDT">Detail</h3><div class="dsub" id="dscDS"></div></div><button class="dsc-dx" id="dscDXC">×</button></div><div class="dsc-db" id="dscDB"></div>';
    document.body.appendChild(s); document.body.appendChild(d);
    s.onclick=closeDrill; document.getElementById("dscDXC").onclick=closeDrill;
    document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeDrill(); });
  }
  function closeDrill(){ var s=NS.$("dscScrim"), d=NS.$("dscDrawer"); if(s)s.classList.remove("on"); if(d)d.classList.remove("on"); }
  function openDrill(kind, key, subtitle){
    ensureDrawer();
    NS.$("dscScrim").classList.add("on"); NS.$("dscDrawer").classList.add("on");
    NS.$("dscDT").textContent="Loading…"; NS.$("dscDS").textContent=subtitle||"";
    NS.$("dscDB").innerHTML='<p class="hint">Loading detail…</p>';
    NS.sb.rpc("dash_discipline_rows",{p_kind:kind,p_key:key||null}).then(function(r){
      if(r.error) throw r.error; drawDrill(r.data||{}, subtitle);
    }).catch(function(e){ NS.$("dscDB").innerHTML='<p class="hint">Could not load: '+esc(e.message||e)+'</p>'; });
  }
  function drawDrill(d, subtitle){
    var cols=d.columns||[], rows=d.rows||[], title=d.title||"Detail";
    NS.$("dscDT").textContent=title;
    NS.$("dscDS").textContent=(subtitle?subtitle+" · ":"")+num(d.n)+" record"+(d.n===1?"":"s");
    var head=cols.map(function(c){ var n=/fine|cards|amount/i.test(c); return '<th'+(n?' class="num"':'')+'>'+esc(c)+'</th>'; }).join("");
    var body=rows.map(function(r){ return '<tr>'+r.map(function(v,i){ var n=/fine|cards|amount/i.test(cols[i]||''); return '<td'+(n?' class="num"':'')+'>'+esc(v)+'</td>'; }).join("")+'</tr>'; }).join("");
    NS.$("dscDB").innerHTML=
      '<div class="dsc-bh"><span class="dsc-sec">'+esc(title)+'</span>'+
        '<span class="dsc-acts"><button class="dsc-x" id="dscDPDF">PDF</button><button class="dsc-x" id="dscDCSV">CSV</button></span></div>'+
      '<div class="dsc-tblwrap" style="max-height:calc(100vh - 150px)"><table class="dsc-tbl"><thead><tr>'+head+'</tr></thead><tbody>'+
        (body||'<tr><td colspan="'+cols.length+'" class="hint">No records.</td></tr>')+'</tbody></table></div>';
    NS.$("dscDPDF").onclick=function(){ expPDF(title, _subtitle, cols, rows); };
    NS.$("dscDCSV").onclick=function(){ expCSV(title, cols, rows); };
  }

  /* ---------- bar list with drill ---------- */
  function bars(rows, labKey, valKey, drillKind){
    if(!rows || !rows.length) return '<p class="hint" style="margin:4px 0">No data.</p>';
    var max=0; rows.forEach(function(r){ max=Math.max(max, Number(r[valKey])||0); }); if(max<=0) max=1;
    return '<div class="dsc-bars">'+rows.map(function(r){
      var v=Number(r[valKey])||0, w=Math.round(v/max*100), lab=r[labKey]||"–";
      var d = drillKind ? ' data-drill="'+drillKind+'|'+esc(lab)+'"' : '';
      return '<div class="dsc-bar"'+d+'><span class="lab" title="'+esc(lab)+'">'+esc(lab)+'</span>'+
        '<span class="tr"><i style="width:'+w+'%"></i></span><span class="vv">'+num(v)+'</span></div>';
    }).join("")+'</div>';
  }

  function regTxt(r){ return r?"Registered":"Not in register"; }
  function regPill(r){ return r?'<span class="dsc-pill ok" title="SAFA number found in the registration master">Reg</span>':'<span class="dsc-pill bad" title="This SAFA number is not in the registration master — confirm the player/referee">Not reg</span>'; }

  /* ==================== DISCIPLINE DASHBOARD ==================== */
  function renderDiscipline(){
    ensureStyle();
    var root = NS.$("disciplineRoot"); if(!root) return;
    if(!root.dataset.loaded) root.innerHTML = '<div class="card"><p class="hint">Loading Discipline, Referees &amp; Cards…</p></div>';
    NS.sb.rpc("dash_discipline_dashboard").then(function(r){
      if(r.error) throw r.error;
      root.dataset.loaded="1";
      drawDiscipline(root, r.data || {});
    }).catch(function(e){
      root.innerHTML = '<div class="card"><h3>Discipline, Referees &amp; Cards</h3><p class="hint">Could not load: '+esc(e.message||e)+'</p></div>';
    });
  }

  function drawDiscipline(root, d){
    _exp={}; _expN=0;
    var meta=d.meta||{}, cards=d.cards||{}, ru=d.rulings||{}, refs=d.referees||{}, sus=d.suspensions||{};
    _subtitle = "dash.cttlfa.com mirror · last sync "+dtime(meta.last_pull)+" · operational, unaudited";

    var head =
      '<div class="card">'+
        '<h2 style="font-family:var(--head);color:var(--navy);margin:0 0 2px">Discipline, Referees &amp; Cards</h2>'+
        '<div class="dsc-prov"><span>Source: <b>dash.cttlfa.com</b> mirror</span>'+
          '<span>Last sync: <b>'+dtime(meta.last_pull)+'</b></span></div>'+
        '<div class="dsc-toolbar">'+
          '<button class="btn gold sm" id="dscFetch" title="Pull the latest data from dash.cttlfa.com now">Fetch now</button>'+
          '<button class="btn ghost sm" id="dscReload" title="Reload the latest saved figures — no new fetch">Refresh</button>'+
          '<a class="dsc-link" href="https://dash.cttlfa.com" target="_blank" rel="noopener">Open dash.cttlfa.com ↗</a>'+
          '<span class="sp"></span>'+
          '<span class="dsc-fstat" id="dscFetchStatus"></span>'+
        '</div>'+
      '</div>';

    if(!meta.present){
      root.innerHTML = head +
        '<div class="dsc-empty" style="margin-top:16px"><h3 style="color:var(--navy);margin:0 0 6px">Awaiting the first dash sync</h3>'+
        '<p style="max-width:60ch;margin:0 auto">The disciplinary data model is live but the mirror is empty. Press <b>Fetch now</b> (or wait for the nightly 02h00 sync) and this dashboard fills automatically.</p></div>';
      wireToolbar(); return;
    }

    var kpi =
      '<div class="dsc-kpis">'+
        '<div class="dsc-kpi"><div class="k">Yellow cards</div><div class="v">'+num(cards.total)+'</div><div class="s">across '+num((cards.by_division||[]).length)+' divisions</div></div>'+
        '<div class="dsc-kpi"><div class="k">Players at suspension risk</div><div class="v">'+num((sus.at_risk||[]).length)+'</div><div class="s">at or over the card threshold</div></div>'+
        '<div class="dsc-kpi"><div class="k">Fines outstanding</div><div class="v">'+rand(ru.outstanding_amount)+'</div><div class="s">'+num(ru.outstanding_n)+' unpaid of '+num(ru.issued_n)+' issued</div></div>'+
        '<div class="dsc-kpi"><div class="k">Referees active</div><div class="v">'+num(refs.active)+'</div><div class="s">of '+num(refs.total)+' on record</div></div>'+
      '</div>';

    // Row 1: by division | most-carded players (both tall, balanced)
    var divRows=(cards.by_division||[]).map(function(x){return [x.division,x.n];});
    var divCard='<div class="card">'+bhead("Yellow cards by division","Cards by division",["Division","Cards"],divRows)+
      bars(cards.by_division,"division","n","division")+'</div>';
    var plRows=(cards.top_players||[]).map(function(p){return [p.player,p.safa||"–",regTxt(p.registered),p.club||"–",p.n];});
    var plBody=(cards.top_players||[]).map(function(p){
      return '<tr class="clk" data-drill="psafa|'+esc(p.safa||"")+'"><td>'+esc(p.player)+'</td><td>'+esc(p.safa||"–")+'</td><td>'+regPill(p.registered)+'</td><td>'+esc(p.club||"–")+'</td><td class="num">'+num(p.n)+'</td></tr>'; }).join("");
    var plCard='<div class="card">'+bhead("Most-carded players","Most carded players",["Player","SAFA","Registered","Club","Cards"],plRows)+
      '<div class="dsc-tblwrap"><table class="dsc-tbl"><thead><tr><th>Player</th><th>SAFA</th><th>Reg</th><th>Club</th><th class="num">Cards</th></tr></thead><tbody>'+(plBody||'<tr><td colspan="5" class="hint">No data.</td></tr>')+'</tbody></table></div></div>';

    // Row 2: cards by month (chart) | cards by club (bars)
    var bm=cards.by_month||[];
    var maxm=0; bm.forEach(function(x){ maxm=Math.max(maxm,x.n||0); }); if(maxm<=0) maxm=1;
    var chart=bm.length ? '<div class="dsc-chart">'+bm.map(function(x){
        return '<div class="dsc-col" data-drill="month|'+esc(x.ym)+'" title="'+esc(ym(x.ym))+': '+num(x.n)+' cards">'+
          '<span class="cv">'+num(x.n)+'</span><div class="bar" style="height:'+Math.round((x.n||0)/maxm*100)+'%"></div>'+
          '<span class="cl">'+esc(ym(x.ym))+'</span></div>'; }).join("")+'</div>' : '<p class="hint">No dated cards.</p>';
    var bmRows=bm.map(function(x){return [ym(x.ym),x.n];});
    var monthCard='<div class="card">'+bhead("Cards by month","Cards by month",["Month","Cards"],bmRows)+chart+'</div>';
    var clubRows=(cards.by_club||[]).map(function(x){return [x.club,x.n];});
    var clubCard='<div class="card">'+bhead("Cards by club","Cards by club",["Club","Cards"],clubRows)+
      bars(cards.by_club,"club","n","club")+'</div>';

    // Rulings & fines
    var ocRows=(ru.by_outcome||[]).map(function(x){return [x.outcome,x.n];});
    var ocBody=(ru.by_outcome||[]).map(function(x){
      return '<tr class="clk" data-drill="outcome|'+esc(x.outcome)+'"><td class="wrap">'+esc(x.outcome)+'</td><td class="num">'+num(x.n)+'</td></tr>'; }).join("");
    var arRows=(ru.by_article||[]).map(function(x){return [x.article,x.n];});
    var arBody=(ru.by_article||[]).map(function(x){
      return '<tr class="clk" data-drill="article|'+esc(x.article)+'"><td class="wrap">'+esc(x.article)+'</td><td class="num">'+num(x.n)+'</td></tr>'; }).join("");
    var rulingsBlock =
      '<div class="card">'+
        '<div class="dsc-sec" style="margin-bottom:8px">Administrative rulings &amp; fines</div>'+
        '<div class="dsc-kv">'+
          '<span>Rulings on record</span><b>'+num(ru.total)+'</b>'+
          '<span>Fines issued</span><b>'+num(ru.issued_n)+' &middot; '+rand(ru.issued_amount)+'</b>'+
          '<span>Fines paid</span><b>'+num(ru.paid_n)+' &middot; '+rand(ru.paid_amount)+'</b>'+
          '<span>Outstanding</span><b>'+num(ru.outstanding_n)+' &middot; '+rand(ru.outstanding_amount)+'</b>'+
        '</div>'+
        '<div class="dsc-grid" style="margin-top:10px">'+
          '<div class="card" style="box-shadow:none;border:1px solid var(--line)">'+bhead("By outcome","Rulings by outcome",["Outcome","Count"],ocRows)+
            '<div class="dsc-tblwrap"><table class="dsc-tbl"><thead><tr><th>Outcome</th><th class="num">Count</th></tr></thead><tbody>'+(ocBody||'<tr><td colspan="2" class="hint">No data.</td></tr>')+'</tbody></table></div></div>'+
          '<div class="card" style="box-shadow:none;border:1px solid var(--line)">'+bhead("By article","Rulings by article",["Article","Count"],arRows)+
            '<div class="dsc-tblwrap"><table class="dsc-tbl"><thead><tr><th>Article</th><th class="num">Count</th></tr></thead><tbody>'+(arBody||'<tr><td colspan="2" class="hint">No data.</td></tr>')+'</tbody></table></div></div>'+
        '</div>'+
      '</div>';

    // Unpaid fines (full-width, drillable rows, exportable)
    var upRows=(ru.unpaid||[]).map(function(u){ return [u.case_number||"–",u.player||"–",u.safa||"–",regTxt(u.registered),u.club||"–",u.article||"–",u.fine_amount==null?"–":Number(u.fine_amount).toFixed(2),u.invoice_number||"–",u.match_date?String(u.match_date).slice(0,10):"–"]; });
    var upBody=(ru.unpaid||[]).map(function(u){
      return '<tr class="clk" data-drill="psafa|'+esc(u.safa||"")+'"><td>'+esc(u.case_number||"–")+'</td><td>'+esc(u.player||"–")+'</td><td>'+esc(u.safa||"–")+'</td><td>'+regPill(u.registered)+'</td><td>'+esc(u.club||"–")+'</td><td class="wrap">'+esc(u.article||"–")+'</td><td class="num">'+rand(u.fine_amount)+'</td><td>'+esc(u.invoice_number||"–")+'</td><td>'+dt(u.match_date)+'</td></tr>'; }).join("");
    var unpaidBlock=
      '<div class="card">'+bhead("Unpaid fines","Unpaid fines",["Case","Player","SAFA","Registered","Club","Article","Fine","Invoice","Match date"],upRows)+
        '<div class="dsc-tblwrap" style="max-height:360px"><table class="dsc-tbl"><thead><tr><th>Case</th><th>Player</th><th>SAFA</th><th>Reg</th><th>Club</th><th>Article</th><th class="num">Fine</th><th>Invoice</th><th>Match date</th></tr></thead>'+
        '<tbody>'+(upBody||'<tr><td colspan="9" class="hint">No unpaid fines recorded.</td></tr>')+'</tbody></table></div>'+
        '<p class="hint" style="margin-top:6px">SAFA numbers are confirmed against the registration master (Reg = found). Invoice numbers tie fines to Sage. Click a row for that player&rsquo;s full disciplinary record. Unaudited.</p></div>';

    // Referees | suspensions
    var raRows=(refs.top_appointments||[]).map(function(x){return [x.referee,x.safa||"–",regTxt(x.registered),x.appts];});
    var raBody=(refs.top_appointments||[]).map(function(x){
      var dk = x.safa ? ('rsafa|'+esc(x.safa)) : ('referee|'+esc(x.referee));
      return '<tr class="clk" data-drill="'+dk+'"><td>'+esc(x.referee)+'</td><td>'+esc(x.safa||"–")+'</td><td>'+regPill(x.registered)+'</td><td class="num">'+num(x.appts)+'</td></tr>'; }).join("");
    var refBlock=
      '<div class="card">'+
        '<div class="dsc-bh"><span class="dsc-sec">Referees</span>'+acts("Referees by level",["Level","Count"],(refs.by_level||[]).map(function(x){return [x.level,x.n];}))+'</div>'+
        '<div class="dsc-kv"><span>On record</span><b>'+num(refs.total)+'</b><span>Active</span><b>'+num(refs.active)+'</b><span>Accreditations</span><b>'+num(refs.accreditations)+'</b></div>'+
        '<div class="dsc-sec" style="margin:8px 0 6px;font-size:12px;color:var(--muted)">By level</div>'+bars(refs.by_level,"level","n",null)+
        '<div class="dsc-bh" style="margin-top:10px"><span class="dsc-sec" style="font-size:12px;color:var(--muted)">Most appointments</span>'+acts("Referee appointments",["Referee","SAFA","Registered","Appointments"],raRows)+'</div>'+
        '<div class="dsc-tblwrap" style="max-height:200px"><table class="dsc-tbl"><thead><tr><th>Referee</th><th>SAFA</th><th>Reg</th><th class="num">Appts</th></tr></thead><tbody>'+(raBody||'<tr><td colspan="4" class="hint">None.</td></tr>')+'</tbody></table></div></div>';
    var ruleRows=(sus.rules||[]).map(function(x){return [x.card_count,x.suspension_matches];});
    var atRows=(sus.at_risk||[]).map(function(x){return [x.player,x.safa||"–",regTxt(x.registered),x.club||"–",x.cards];});
    var atBody=(sus.at_risk||[]).map(function(x){
      return '<tr class="clk" data-drill="psafa|'+esc(x.safa||"")+'"><td>'+esc(x.player)+'</td><td>'+esc(x.safa||"–")+'</td><td>'+regPill(x.registered)+'</td><td>'+esc(x.club||"–")+'</td><td class="num">'+num(x.cards)+'</td></tr>'; }).join("");
    var susBlock=
      '<div class="card">'+
        '<div class="dsc-bh"><span class="dsc-sec">Suspensions</span>'+acts("Players at risk",["Player","SAFA","Registered","Club","Cards"],atRows)+'</div>'+
        '<div class="dsc-sec" style="font-size:12px;color:var(--muted);margin-bottom:4px">Accumulation thresholds</div>'+
        '<table class="dsc-tbl" style="margin-bottom:10px"><thead><tr><th class="num">Cards</th><th class="num">Matches suspended</th></tr></thead><tbody>'+((sus.rules||[]).map(function(x){return '<tr><td class="num">'+num(x.card_count)+'</td><td class="num">'+num(x.suspension_matches)+'</td></tr>';}).join(""))+'</tbody></table>'+
        '<div class="dsc-sec" style="font-size:12px;color:var(--muted)">Players at risk <span class="dsc-pill warn">'+num((sus.at_risk||[]).length)+'</span></div>'+
        '<div class="dsc-tblwrap" style="max-height:200px;margin-top:6px"><table class="dsc-tbl"><thead><tr><th>Player</th><th>SAFA</th><th>Reg</th><th>Club</th><th class="num">Cards</th></tr></thead><tbody>'+(atBody||'<tr><td colspan="5" class="hint">None at threshold.</td></tr>')+'</tbody></table></div></div>';

    root.innerHTML = head + kpi +
      '<div class="dsc-grid">'+divCard+plCard+'</div>'+
      '<div class="dsc-grid" style="margin-top:16px">'+monthCard+clubCard+'</div>'+
      '<div style="margin-top:16px">'+rulingsBlock+'</div>'+
      '<div style="margin-top:16px">'+unpaidBlock+'</div>'+
      '<div class="dsc-grid" style="margin-top:16px">'+refBlock+susBlock+'</div>';

    wireToolbar();
    // wire exports
    Array.prototype.forEach.call(root.querySelectorAll("[data-pdf]"),function(b){ b.onclick=function(){ var e=_exp[b.getAttribute("data-pdf")]; if(e) expPDF(e.title,_subtitle,e.columns,e.rows); }; });
    Array.prototype.forEach.call(root.querySelectorAll("[data-csv]"),function(b){ b.onclick=function(){ var e=_exp[b.getAttribute("data-csv")]; if(e) expCSV(e.title,e.columns,e.rows); }; });
    // wire drills
    Array.prototype.forEach.call(root.querySelectorAll("[data-drill]"),function(b){ b.onclick=function(ev){ ev.stopPropagation(); var p=b.getAttribute("data-drill").split("|"); openDrill(p[0],p[1]||"",_subtitle); }; });
  }

  /* ---------- Fetch now (queues dash agent) ---------- */
  var _dscPoll=null;
  function dscFStat(txt,tone){ var el=NS.$("dscFetchStatus"); if(!el) return; el.textContent=txt||""; el.style.color=(tone==="bad")?"#9A3130":(tone==="ok")?"#1c5136":"var(--muted)"; }
  function wireToolbar(){
    var f=NS.$("dscFetch"); if(f) f.onclick=dscFetchNow;
    var rl=NS.$("dscReload"); if(rl) rl.onclick=function(){ renderDiscipline(); };
  }
  function dscFetchNow(){
    var b=NS.$("dscFetch"); if(b) b.disabled=true; dscFStat("Requesting a fetch…","");
    NS.sb.rpc("dash_request_refresh").then(function(r){
      if(r.error){ dscFStat(r.error.message||String(r.error),"bad"); if(b) b.disabled=false; return; }
      dscStartPoll();
    });
  }
  function dscStateText(d){
    var up=d.agent_up, st=d.status||"idle";
    if(st==="queued") return up?["Queued — waiting for the fetch agent…",""]:["Queued — the fetch agent looks offline; it will run on the next agent start or the nightly 02h00 task.","bad"];
    if(st==="running") return ["Fetching from dash…",""];
    if(st==="error") return ["Last fetch failed: "+(d.message||""),"bad"];
    if(st==="done") return ["Done — "+num(d.rows)+" rows synced.","ok"];
    return ["",""];
  }
  function dscStartPoll(){
    if(_dscPoll) clearInterval(_dscPoll); var tries=0;
    _dscPoll=setInterval(function(){ tries++;
      NS.sb.rpc("dash_refresh_state").then(function(r){ if(r.error||!r.data) return; var d=r.data, t=dscStateText(d); dscFStat(t[0],t[1]);
        if(d.status==="done"){ clearInterval(_dscPoll); _dscPoll=null; var b=NS.$("dscFetch"); if(b) b.disabled=false; renderDiscipline(); }
        else if(d.status==="error"){ clearInterval(_dscPoll); _dscPoll=null; var b=NS.$("dscFetch"); if(b) b.disabled=false; }
        else if(!d.agent_up && d.status==="queued" && tries>=3){ clearInterval(_dscPoll); _dscPoll=null; var b=NS.$("dscFetch"); if(b) b.disabled=false; }
      });
    }, 4000);
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
          '<span>Discipline: <b>'+(meta.dash_present?'from dash mirror':'<span class="warn">awaiting first sync</span>')+'</b></span></div>'+
        '<div class="cpf-controls"><input id="cpfSearch" type="text" placeholder="Search clubs…" autocomplete="off"></div>'+
      '</div>';

    function tbl(list){
      return list.map(function(c){
        var st = c.status || "–";
        var cls = /credit|paid/i.test(st)?"ok":/current|below/i.test(st)?"mut":/reminder/i.test(st)?"warn":st==="–"?"mut":"bad";
        return '<tr data-club="'+esc(c.name)+'" class="clk">'+
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
        '<div class="dsc-kv">'+
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
      return '<tr><td>'+esc(u.case_number||"–")+'</td><td>'+esc(u.player||"–")+'</td><td class="wrap">'+esc(u.article||"–")+'</td><td class="num">'+rand(u.fine_amount)+'</td><td>'+esc(u.invoice_number||"–")+'</td></tr>'; }).join("");
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
            '<div class="dsc-kv">'+
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
        '<div class="dsc-kv">'+
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
