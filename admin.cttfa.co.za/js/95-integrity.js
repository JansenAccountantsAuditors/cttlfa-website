/* CTTLFA admin — Data Integrity control layer.
   Closure over window.AC. Reads live from admin-guarded RPCs
   data_integrity() and data_integrity_rows(p_check). One page that watches
   every feed (Sage debtors, registrations, LeagueRepublic, the disciplinary
   mirror) and the identity spine that ties them together, grouped into
   Freshness, Identity, Reconciliation and Referential integrity, each with a
   RAG status, a value and a drill-down of the exceptions behind it.
   Status is always carried by a word and a shape, never by colour alone.
   Figures follow SA conventions: space thousands, en dash for nil.
   Operational data, unaudited. */
(function (NS) {
  "use strict";

  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  /* ---------- formatting ---------- */
  function grp(s){ return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function num(n){ if(n==null||n===""||isNaN(n)) return "–"; var neg=Number(n)<0, v=grp(Math.abs(Math.round(Number(n)))); return neg?"("+v+")":v; }
  function rand(n){ if(n==null||n===""||isNaN(n)) return "–"; var neg=Number(n)<0, v="R "+grp(Math.abs(Number(n)).toFixed(2)); return neg?"("+v+")":v; }
  function esc(s){ return NS.esc ? NS.esc(s) : String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  function pad(x){ return (x<10?"0":"")+x; }
  function dtime(s){ if(!s) return "–"; try{ var d=new Date(s); if(isNaN(d)) return esc(String(s));
    return d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear()+", "+pad(d.getHours())+":"+pad(d.getMinutes()); }catch(e){ return esc(String(s)); } }
  function slug(s){ return "cttlfa-"+String(s||"data-integrity").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60); }
  function titleCase(s){ s=String(s||"").replace(/_/g," "); return s.charAt(0).toUpperCase()+s.slice(1); }

  /* ---------- status vocabulary (word + shape + colour; never colour alone) ---------- */
  var ST = {
    green: {word:"Passing", glyph:"●", cls:"ok"},
    amber: {word:"Review",  glyph:"▲", cls:"warn"},
    red:   {word:"Failing", glyph:"■", cls:"bad"}
  };
  function stPill(s){ var t=ST[s]||ST.amber; return '<span class="ntg-pill '+t.cls+'"><span class="g">'+t.glyph+'</span>'+t.word+'</span>'; }
  function stWord(s){ return (ST[s]||ST.amber).word; }

  /* ---------- styles ---------- */
  function ensureStyle(){
    if(document.getElementById("ntgStyle")) return;
    var st=document.createElement("style"); st.id="ntgStyle";
    st.textContent =
      ".ntg-prov{display:flex;flex-wrap:wrap;gap:5px 20px;font-size:12px;color:var(--muted);margin-top:8px}.ntg-prov b{color:var(--ink)}"+
      ".ntg-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}.ntg-toolbar .sp{flex:1}"+
      ".ntg-feeds{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}"+
      ".ntg-feed{font-size:11.5px;border:1px solid var(--line);border-radius:9px;padding:5px 10px;background:#fff;color:var(--ink)}.ntg-feed b{color:var(--navy)}"+
      ".ntg-band{display:flex;flex-wrap:wrap;align-items:center;gap:14px 22px;border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:14px 0;background:#fff;border-left-width:5px}"+
      ".ntg-band.ok{border-left-color:#1c5136}.ntg-band.warn{border-left-color:#7a4d10}.ntg-band.bad{border-left-color:#8a2e26}"+
      ".ntg-band .head{display:flex;flex-direction:column;gap:3px}.ntg-band .big{font-family:var(--head);font-weight:800;font-size:23px;color:var(--navy);line-height:1.05}"+
      ".ntg-band .sub{font-size:12.5px;color:var(--muted)}"+
      ".ntg-tally{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto}"+
      ".ntg-t{border:1px solid var(--line);border-radius:11px;padding:8px 14px;min-width:82px;background:#fff}.ntg-t .l{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}.ntg-t .v{font-family:var(--head);font-weight:800;font-size:22px;font-variant-numeric:tabular-nums;margin-top:1px}"+
      ".ntg-t.ok .v{color:#1c5136}.ntg-t.warn .v{color:#7a4d10}.ntg-t.bad .v{color:#8a2e26}"+
      ".ntg-gh{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}"+
      ".ntg-sec{font-family:var(--cond);font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--navy);font-size:14px;display:flex;align-items:center;gap:9px}"+
      ".ntg-acts{display:flex;gap:5px;flex:0 0 auto}"+
      ".ntg-x{font-size:10.5px;font-weight:700;color:var(--muted);background:#F3F6FC;border:1px solid var(--line);border-radius:7px;padding:3px 8px;cursor:pointer;letter-spacing:.02em}.ntg-x:hover{background:#E9EFF9;color:var(--navy)}"+
      ".ntg-tbl{width:100%;border-collapse:collapse;font-size:12.5px}"+
      ".ntg-tbl th{background:var(--navy);color:#fff;text-align:left;padding:7px 9px;font-size:11px;font-weight:700;white-space:nowrap}"+
      ".ntg-tbl th.num,.ntg-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}"+
      ".ntg-tbl td{padding:7px 9px;border-bottom:1px solid var(--line2);vertical-align:top}"+
      ".ntg-tbl td.wrap{white-space:normal;word-break:break-word}"+
      ".ntg-tbl tbody tr.clk{cursor:pointer}.ntg-tbl tbody tr.clk:hover td{background:#F5F8FD}"+
      ".ntg-tblwrap{overflow:auto;border:1px solid var(--line);border-radius:10px}"+
      ".ntg-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}.ntg-pill .g{font-size:9px;line-height:1}"+
      ".ntg-pill.bad{background:#FBECEA;color:#8a2e26}.ntg-pill.warn{background:#FCF3D8;color:#7a4d10}.ntg-pill.ok{background:#E7F5EC;color:#1c5136}"+
      ".ntg-more{font-size:10.5px;font-weight:700;color:var(--blue);background:#EEF3FD;border:1px solid var(--line);border-radius:7px;padding:2px 8px;cursor:pointer}.ntg-more:hover{background:#E1EAFB}"+
      ".ntg-legend{font-size:11.5px;color:var(--muted);margin-top:10px;display:flex;flex-wrap:wrap;gap:5px 16px}"+
      ".ntg-scrim{position:fixed;inset:0;background:rgba(7,20,55,.42);opacity:0;pointer-events:none;transition:opacity .18s;z-index:998}.ntg-scrim.on{opacity:1;pointer-events:auto}"+
      ".ntg-drawer{position:fixed;top:0;right:0;height:100vh;width:min(760px,97vw);background:#fff;box-shadow:-16px 0 44px rgba(7,20,55,.24);transform:translateX(100%);transition:transform .2s;z-index:999;display:flex;flex-direction:column}.ntg-drawer.on{transform:none}"+
      ".ntg-dh{background:var(--navy);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.ntg-dh h3{color:#fff;margin:0;font-family:var(--head);font-size:17px}.ntg-dh .dsub{color:#C7D2EC;font-size:12px;margin-top:2px}.ntg-dx{background:transparent;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:17px;flex:0 0 auto}"+
      ".ntg-db{padding:14px 18px 30px;overflow:auto;flex:1}"+
      "@media print{@page{size:A4 portrait;margin:12mm} body *{visibility:hidden!important} #ntgReport,#ntgReport *{visibility:visible!important} #ntgReport{position:absolute;left:0;top:0;width:100%} .noprint{display:none!important} .ntg-tblwrap{overflow:visible!important;border:0!important} .ntg-tbl th{color:#000!important;background:#fff!important;border-bottom:2px solid #000} .ntg-band{border:1px solid #000}}";
    document.head.appendChild(st);
  }

  /* ---------- exports (match the other admin PDFs; CSV with BOM) ---------- */
  function pdfHead(doc, title, subtitle){
    var W=doc.internal.pageSize.getWidth();
    doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.setTextColor(7,26,74);
    doc.text("CTTLFA — "+title, 40, 46);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(90,101,119);
    doc.text(subtitle||"", 40, 62);
  }
  function pdfFoot(doc){
    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();
    doc.setFontSize(8); doc.setTextColor(140,150,165);
    doc.text("CTTLFA Admin Centre · data integrity · operational, unaudited · generated "+new Date().toLocaleString("en-ZA"), 40, H-20);
    doc.text("Page "+doc.internal.getCurrentPageInfo().pageNumber, W-64, H-20);
  }
  function expPDF(title, subtitle, columns, rows){
    if(!window.jspdf){ alert("PDF library still loading, try again."); return; }
    var doc=new window.jspdf.jsPDF({unit:"pt",format:"a4"});
    pdfHead(doc, title, subtitle);
    doc.autoTable({ startY:78, head:[columns], body:rows,
      styles:{fontSize:8.5,cellPadding:4,overflow:"linebreak",textColor:[20,30,50]},
      headStyles:{fillColor:[7,26,74],textColor:255,fontStyle:"bold"},
      alternateRowStyles:{fillColor:[247,249,253]}, margin:{left:40,right:40},
      didDrawPage:function(){ pdfFoot(doc); } });
    doc.save(slug(title)+".pdf");
  }
  function expCSV(title, columns, rows){
    function q(v){ v=(v==null?"":String(v)).replace(/ /g," "); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
    var lines=[columns.map(q).join(",")].concat(rows.map(function(r){ return r.map(q).join(","); }));
    var blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=slug(title)+".csv";
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },0);
  }
  // full report: one PDF, all groups
  function fullReportPDF(d){
    if(!window.jspdf){ alert("PDF library still loading, try again."); return; }
    var doc=new window.jspdf.jsPDF({unit:"pt",format:"a4"});
    var sub="Data integrity across all feeds · overall "+stWord(d.overall)+" · generated "+dtime(d.generated)+" · operational, unaudited";
    pdfHead(doc, "Data Integrity report", sub);
    var y=84;
    (d.groups||[]).forEach(function(g){
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(7,26,74);
      doc.text((g.group||"")+"  —  "+stWord(g.rag), 40, y);
      doc.autoTable({ startY:y+6,
        head:[["Check","Status","Value","What it means"]],
        body:(g.checks||[]).map(function(c){ return [c.title, stWord(c.status), c.display, c.detail]; }),
        styles:{fontSize:8.3,cellPadding:4,overflow:"linebreak",textColor:[20,30,50]},
        headStyles:{fillColor:[7,26,74],textColor:255,fontStyle:"bold"},
        alternateRowStyles:{fillColor:[247,249,253]},
        columnStyles:{0:{cellWidth:150},1:{cellWidth:60},2:{cellWidth:80}},
        margin:{left:40,right:40}, didDrawPage:function(){ pdfFoot(doc); } });
      y=doc.lastAutoTable.finalY+22;
      if(y>720){ doc.addPage(); y=60; }
    });
    doc.save(slug("data integrity report")+".pdf");
  }

  /* ---------- drill drawer ---------- */
  function ensureDrawer(){
    if(document.getElementById("ntgDrawer")) return;
    var s=document.createElement("div"); s.className="ntg-scrim"; s.id="ntgScrim";
    var d=document.createElement("div"); d.className="ntg-drawer"; d.id="ntgDrawer";
    d.innerHTML='<div class="ntg-dh"><div><h3 id="ntgDT">Detail</h3><div class="dsub" id="ntgDS"></div></div><button class="ntg-dx" id="ntgDXC">×</button></div><div class="ntg-db" id="ntgDB"></div>';
    document.body.appendChild(s); document.body.appendChild(d);
    s.onclick=closeDrill; document.getElementById("ntgDXC").onclick=closeDrill;
    document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeDrill(); });
  }
  function closeDrill(){ var s=NS.$("ntgScrim"), d=NS.$("ntgDrawer"); if(s)s.classList.remove("on"); if(d)d.classList.remove("on"); }
  function openDrill(key, title, detail){
    ensureDrawer();
    NS.$("ntgScrim").classList.add("on"); NS.$("ntgDrawer").classList.add("on");
    NS.$("ntgDT").textContent=title||"Detail"; NS.$("ntgDS").textContent=detail||"";
    NS.$("ntgDB").innerHTML='<p class="hint">Loading detail…</p>';
    NS.sb.rpc("data_integrity_rows",{p_check:key}).then(function(r){
      if(r.error) throw r.error; drawDrill(title, detail, r.data||[]);
    }).catch(function(e){ NS.$("ntgDB").innerHTML='<p class="hint">Could not load: '+esc(e.message||e)+'</p>'; });
  }
  function drawDrill(title, detail, rows){
    if(!rows || !rows.length){
      NS.$("ntgDB").innerHTML='<div class="ntg-empty" style="border:1px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--muted)">No exceptions — this check is clear.</div>';
      return;
    }
    var keys=[]; rows.forEach(function(o){ Object.keys(o).forEach(function(k){ if(keys.indexOf(k)<0) keys.push(k); }); });
    function isNum(k){ return /balance|records|count|cards|amount|n$/i.test(k); }
    function fmt(k,v){ if(v==null||v==="") return "–"; if(/balance|amount/i.test(k)) return rand(v); if(isNum(k)) return num(v); return String(v); }
    var cols=keys.map(titleCase);
    var head=keys.map(function(k){ return '<th'+(isNum(k)?' class="num"':'')+'>'+esc(titleCase(k))+'</th>'; }).join("");
    var body=rows.map(function(o){ return '<tr>'+keys.map(function(k){ return '<td'+(isNum(k)?' class="num"':' class="wrap"')+'>'+esc(fmt(k,o[k]))+'</td>'; }).join("")+'</tr>'; }).join("");
    var expRows=rows.map(function(o){ return keys.map(function(k){ return fmt(k,o[k]); }); });
    NS.$("ntgDS").textContent=(detail?detail+" · ":"")+num(rows.length)+" record"+(rows.length===1?"":"s");
    NS.$("ntgDB").innerHTML=
      '<div class="ntg-gh"><span class="ntg-sec">'+esc(title)+'</span>'+
        '<span class="ntg-acts"><button class="ntg-x" id="ntgDPDF">PDF</button><button class="ntg-x" id="ntgDCSV">CSV</button></span></div>'+
      '<div class="ntg-tblwrap" style="max-height:calc(100vh - 160px)"><table class="ntg-tbl"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
    NS.$("ntgDPDF").onclick=function(){ expPDF(title, detail||"", cols, expRows); };
    NS.$("ntgDCSV").onclick=function(){ expCSV(title, cols, expRows); };
  }

  /* ==================== PAGE ==================== */
  var _last=null;
  function renderIntegrity(){
    ensureStyle();
    var root=NS.$("integrityRoot"); if(!root) return;
    if(!root.dataset.loaded) root.innerHTML='<div class="card"><p class="hint">Running the data integrity checks…</p></div>';
    NS.sb.rpc("data_integrity").then(function(r){
      if(r.error) throw r.error;
      root.dataset.loaded="1"; _last=r.data||{};
      draw(root, _last);
    }).catch(function(e){
      root.innerHTML='<div class="card"><h3>Data Integrity</h3><p class="hint">Could not run the checks: '+esc(e.message||e)+'</p></div>';
    });
  }

  function draw(root, d){
    _exp={}; _expN=0;
    var overall=d.overall||"amber", c=d.counts||{}, feeds=d.feeds||{}, groups=d.groups||[];
    var band=ST[overall]||ST.amber;
    var overallLine = overall==="green" ? "Everything ties up across the feeds."
      : overall==="red" ? "One or more checks are failing and need action."
      : "Some checks need a review before the next reporting cycle.";

    var head =
      '<div class="card noprint">'+
        '<h2 style="font-family:var(--head);color:var(--navy);margin:0 0 2px">Data Integrity</h2>'+
        '<div class="ntg-prov">'+
          '<span>Scope: <b>Sage debtors, registrations, LeagueRepublic, disciplinary</b></span>'+
          '<span>Basis: <b>operational, unaudited</b></span>'+
          '<span>Checked: <b>'+dtime(d.generated)+'</b></span>'+
        '</div>'+
        '<div class="ntg-feeds">'+
          feedChip("Disciplinary mirror", feeds.dash)+
          feedChip("Sage ledger", feeds.sage)+
          feedChip("Website content", feeds.website)+
          feedChip("Registrations", feeds.registrations)+
        '</div>'+
        '<div class="ntg-toolbar">'+
          '<button class="btn ghost sm" id="ntgReload" title="Re-run every check now">Re-run checks</button>'+
          '<button class="btn gold sm" id="ntgPDF" title="Download the full integrity report as a PDF">Full report (PDF)</button>'+
          '<span class="sp"></span>'+
          '<span class="hint" id="ntgStat"></span>'+
        '</div>'+
      '</div>';

    var report =
      '<div id="ntgReport">'+
      '<div class="ntg-band '+band.cls+'">'+
        '<div class="head"><div class="big">'+band.glyph+' Overall: '+band.word+'</div><div class="sub">'+esc(overallLine)+'</div></div>'+
        '<div class="ntg-tally">'+
          tally("Failing", c.red, "bad")+
          tally("To review", c.amber, "warn")+
          tally("Passing", c.green, "ok")+
          tally("Checks", c.total, "")+
        '</div>'+
      '</div>';

    groups.forEach(function(g){ report += groupCard(g); });

    report +=
      '<div class="ntg-legend">'+
        '<span>'+stPill("green")+' clear</span>'+
        '<span>'+stPill("amber")+' review before the next reporting cycle</span>'+
        '<span>'+stPill("red")+' failing — act now</span>'+
        '<span>Click any row with a count to see the records behind it.</span>'+
      '</div>'+
      '<p class="hint" style="margin-top:10px">Reviewed by the Treasurer. Operational data from the live Admin Centre feeds, unaudited. Generated '+dtime(d.generated)+'.</p>'+
      '</div>';

    root.innerHTML = head + report;
    wire(root, d);
  }

  function feedChip(label, val){ return '<span class="ntg-feed">'+esc(label)+': <b>'+esc(val||"–")+'</b></span>'; }
  function tally(label, v, cls){ return '<div class="ntg-t '+(cls||"")+'"><div class="l">'+esc(label)+'</div><div class="v">'+num(v)+'</div></div>'; }

  function groupCard(g){
    var checks=g.checks||[];
    var rows='';
    checks.forEach(function(c){
      var drill = c.drill && Number(c.n)>0;
      rows += '<tr'+(drill?' class="clk" data-drill="'+esc(c.key)+'" data-title="'+esc(c.title)+'" data-detail="'+esc(c.detail)+'"':'')+'>'+
        '<td class="wrap"><b>'+esc(c.title)+'</b></td>'+
        '<td>'+stPill(c.status)+'</td>'+
        '<td class="num">'+esc(c.display)+'</td>'+
        '<td class="wrap">'+esc(c.detail)+(drill?' <button class="ntg-more" type="button">View '+num(c.n)+'</button>':'')+'</td>'+
      '</tr>';
    });
    // export rows for this group
    var expCols=["Check","Status","Value","What it means"];
    var expRows=checks.map(function(c){ return [c.title, stWord(c.status), c.display, c.detail]; });
    var k=regExp(g.group, expCols, expRows);
    return '<div class="card">'+
      '<div class="ntg-gh"><span class="ntg-sec">'+stPill(g.rag)+esc(g.group)+'</span>'+
        '<span class="ntg-acts"><button class="ntg-x" data-pdf="'+k+'">PDF</button><button class="ntg-x" data-csv="'+k+'">CSV</button></span></div>'+
      '<div class="ntg-tblwrap"><table class="ntg-tbl"><thead><tr>'+
        '<th>Check</th><th>Status</th><th class="num">Value</th><th>What it means</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '</div>';
  }

  // per-group export registry
  var _exp={}, _expN=0;
  function regExp(title, columns, rows){ var k="e"+(++_expN); _exp[k]={title:"Data integrity — "+title, columns:columns, rows:rows}; return k; }

  function wire(root, d){
    var rl=NS.$("ntgReload"); if(rl) rl.onclick=function(){ var s=NS.$("ntgStat"); if(s)s.textContent="Re-running…"; root.dataset.loaded=""; renderIntegrity(); };
    var pf=NS.$("ntgPDF"); if(pf) pf.onclick=function(){ fullReportPDF(d); };
    Array.prototype.forEach.call(root.querySelectorAll("[data-pdf]"),function(b){ b.onclick=function(e){ e.stopPropagation(); var x=_exp[b.dataset.pdf]; if(x) expPDF(x.title,"Overall "+stWord(d.overall)+" · generated "+dtime(d.generated),x.columns,x.rows); }; });
    Array.prototype.forEach.call(root.querySelectorAll("[data-csv]"),function(b){ b.onclick=function(e){ e.stopPropagation(); var x=_exp[b.dataset.csv]; if(x) expCSV(x.title,x.columns,x.rows); }; });
    Array.prototype.forEach.call(root.querySelectorAll("tr.clk"),function(tr){ tr.onclick=function(){ openDrill(tr.dataset.drill, tr.dataset.title, tr.dataset.detail); }; });
  }

  NS.renderIntegrity = renderIntegrity;

})(window.AC = window.AC || {});
