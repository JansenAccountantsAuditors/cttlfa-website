/* CTTLFA admin - Data Integrity (merged inputs + platform health).
   One page. It watches the FOUR external inputs the Association depends on
   - Sage (club debtors), LeagueRepublic (fixtures and results), SAFA
   registrations (manual capture) and the dash disciplinary mirror - and
   confirms each is fresh, complete and reconciled. Everything downstream is
   internal mapping that arranges those inputs into their places; that is rolled
   up into a single status with a drill-down. The operational safeguards
   (uptime monitor, backups, portal access, email, correspondence, receipts)
   are kept in a section below the inputs.
   Reads live from data_integrity(), data_integrity_rows(p_check) and sys_health().
   Status is always a word plus a shape, never colour alone.
   Figures follow SA conventions: space thousands, brackets for negatives,
   en dash for nil. Operational data. */
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
  function dday(s){ if(!s) return "–"; try{ var d=new Date(s); if(isNaN(d)) return esc(String(s)); return d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear(); }catch(e){ return esc(String(s)); } }
  function ago(ts){ if(!ts) return ""; var ms=Date.now()-new Date(ts).getTime(); if(isNaN(ms)) return ""; var h=ms/3.6e6; if(h<1) return Math.max(1,Math.round(h*60))+" min ago"; if(h<48) return (Math.round(h*10)/10)+" h ago"; return Math.round(h/24)+" days ago"; }
  function slug(s){ return "cttlfa-"+String(s||"data-integrity").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60); }
  function titleCase(s){ s=String(s||"").replace(/_/g," "); return s.charAt(0).toUpperCase()+s.slice(1); }

  /* ---------- status vocabulary (word + shape + colour; never colour alone) ---------- */
  var ST = {
    green: {word:"Passing", glyph:"●", cls:"ok"},
    amber: {word:"Review",  glyph:"▲", cls:"warn"},
    red:   {word:"Failing", glyph:"■", cls:"bad"}
  };
  var RANK = {green:0, amber:1, red:2};
  function worst(){ var w="green"; for(var i=0;i<arguments.length;i++){ var s=arguments[i]; if(s&&RANK[s]!=null&&RANK[s]>RANK[w]) w=s; } return w; }
  function stPill(s){ var t=ST[s]||ST.amber; return '<span class="ntg-pill '+t.cls+'"><span class="g" aria-hidden="true">'+t.glyph+'</span>'+t.word+'</span>'; }
  function stWord(s){ return (ST[s]||ST.amber).word; }

  /* ---------- styles ---------- */
  function ensureStyle(){
    if(document.getElementById("ntgStyle")) return;
    var st=document.createElement("style"); st.id="ntgStyle";
    st.textContent =
      ".ntg-prov{display:flex;flex-wrap:wrap;gap:5px 20px;font-size:12px;color:var(--muted);margin-top:8px}.ntg-prov b{color:var(--ink)}"+
      ".ntg-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}.ntg-toolbar .sp{flex:1}"+
      ".ntg-band{display:flex;flex-wrap:wrap;align-items:center;gap:14px 22px;border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:14px 0;background:#fff;border-left-width:5px}"+
      ".ntg-band.ok{border-left-color:#1c5136}.ntg-band.warn{border-left-color:#7a4d10}.ntg-band.bad{border-left-color:#8a2e26}"+
      ".ntg-band .head{display:flex;flex-direction:column;gap:3px}.ntg-band .big{font-family:var(--head);font-weight:800;font-size:22px;color:var(--navy);line-height:1.05;display:flex;align-items:center;gap:10px}"+
      ".ntg-band .sub{font-size:12.5px;color:var(--muted)}"+
      ".ntg-tally{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto}"+
      ".ntg-t{border:1px solid var(--line);border-radius:11px;padding:8px 14px;min-width:78px;background:#fff}.ntg-t .l{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}.ntg-t .v{font-family:var(--head);font-weight:800;font-size:21px;font-variant-numeric:tabular-nums;margin-top:1px}"+
      ".ntg-t.ok .v{color:#1c5136}.ntg-t.warn .v{color:#7a4d10}.ntg-t.bad .v{color:#8a2e26}"+
      ".ntg-t.ntg-tclk{cursor:pointer;transition:border-color .12s,background .12s}.ntg-t.ntg-tclk:hover,.ntg-t.ntg-tclk:focus{background:#F3F6FC;border-color:var(--navy);outline:none}"+
      ".ntg-sech{font-family:var(--cond);font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--navy);font-size:13px;margin:18px 0 2px}"+
      ".ntg-sub{font-size:12px;color:var(--muted);margin:0 0 10px}"+
      ".ntg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}"+
      ".ntg-card{border:1px solid var(--line);border-radius:14px;background:#fff;padding:15px 16px;border-top:4px solid var(--line)}"+
      ".ntg-card.ok{border-top-color:#1c5136}.ntg-card.warn{border-top-color:#7a4d10}.ntg-card.bad{border-top-color:#8a2e26}"+
      ".ntg-ch{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:9px}"+
      ".ntg-ct{display:flex;flex-direction:column;gap:1px}.ntg-ct .src{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.ntg-ct h4{margin:0;font-family:var(--head);font-size:16px;color:var(--navy);line-height:1.15}"+
      ".ntg-kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:4px 0;border-bottom:1px solid #EFF1F5}.ntg-kv:last-of-type{border-bottom:0}.ntg-kv .k{color:var(--muted)}.ntg-kv .v{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}"+
      ".ntg-kv .v.ok{color:#1c5136}.ntg-kv .v.warn{color:#7a4d10}.ntg-kv .v.bad{color:#8a2e26}"+
      ".ntg-note{font-size:11.5px;color:var(--muted);margin:9px 0 0;line-height:1.45}"+
      ".ntg-btn{font-size:11.5px;font-weight:700;color:var(--navy);background:#F3F6FC;border:1px solid var(--line);border-radius:8px;padding:5px 11px;cursor:pointer}.ntg-btn:hover{background:#E9EFF9}.ntg-btn:disabled{opacity:.55;cursor:default}"+
      ".ntg-gh{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}"+
      ".ntg-acts{display:flex;gap:5px;flex:0 0 auto}"+
      ".ntg-x{font-size:10.5px;font-weight:700;color:var(--muted);background:#F3F6FC;border:1px solid var(--line);border-radius:7px;padding:3px 8px;cursor:pointer;letter-spacing:.02em}.ntg-x:hover{background:#E9EFF9;color:var(--navy)}"+
      ".ntg-tbl{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}"+
      ".ntg-tbl col.c-check{width:26%}.ntg-tbl col.c-stat{width:14%}.ntg-tbl col.c-val{width:16%}.ntg-tbl col.c-mean{width:44%}"+
      ".ntg-tbl th{background:var(--navy);color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:700}"+
      ".ntg-tbl th.num,.ntg-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}"+
      ".ntg-tbl td{padding:8px 10px;border-bottom:1px solid var(--line2);vertical-align:top;overflow-wrap:break-word;word-break:normal}"+
      ".ntg-tbl tbody tr.clk{cursor:pointer}.ntg-tbl tbody tr.clk:hover td{background:#F5F8FD}"+
      ".ntg-tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}"+
      ".ntg-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}.ntg-pill .g{font-size:9px;line-height:1}"+
      ".ntg-pill.bad{background:#FBECEA;color:#8a2e26}.ntg-pill.warn{background:#FCF3D8;color:#7a4d10}.ntg-pill.ok{background:#E7F5EC;color:#1c5136}"+
      ".ntg-more{font-size:10.5px;font-weight:700;color:var(--blue);background:#EEF3FD;border:1px solid var(--line);border-radius:7px;padding:2px 8px;cursor:pointer}.ntg-more:hover{background:#E1EAFB}"+
      ".ntg-map{border:1px solid var(--line);border-radius:14px;background:#fff;padding:15px 16px;border-left:5px solid var(--line)}"+
      ".ntg-map.ok{border-left-color:#1c5136}.ntg-map.warn{border-left-color:#7a4d10}.ntg-map.bad{border-left-color:#8a2e26}"+
      ".ntg-maptoggle{font-size:11.5px;font-weight:700;color:var(--blue);background:transparent;border:0;cursor:pointer;padding:0;margin-top:8px}"+
      ".ntg-legend{font-size:11.5px;color:var(--muted);margin-top:12px;display:flex;flex-wrap:wrap;gap:5px 16px}"+
      ".ntg-run{font-size:11px;color:var(--muted);margin-left:8px}"+
      ".ntg-scrim{position:fixed;inset:0;background:rgba(7,20,55,.42);opacity:0;pointer-events:none;transition:opacity .18s;z-index:998}.ntg-scrim.on{opacity:1;pointer-events:auto}"+
      ".ntg-drawer{position:fixed;top:0;right:0;height:100vh;width:min(760px,97vw);background:#fff;box-shadow:-16px 0 44px rgba(7,20,55,.24);transform:translateX(100%);transition:transform .2s;z-index:999;display:flex;flex-direction:column}.ntg-drawer.on{transform:none}"+
      ".ntg-dh{background:var(--navy);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.ntg-dh h3{color:#fff;margin:0;font-family:var(--head);font-size:17px}.ntg-dh .dsub{color:#C7D2EC;font-size:12px;margin-top:2px}.ntg-dx{background:transparent;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:17px;flex:0 0 auto}"+
      ".ntg-db{padding:14px 18px 30px;overflow:auto;flex:1}"+
      ".ntg-rbk{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}.ntg-rbk col.r-svc{width:26%}.ntg-rbk col.r-own{width:22%}.ntg-rbk col.r-act{width:52%}"+
      ".ntg-rbk th{background:var(--navy);color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:700}.ntg-rbk td{padding:8px 10px;border-bottom:1px solid var(--line2);vertical-align:top;overflow-wrap:break-word}"+
      "@media print{@page{size:A4 portrait;margin:12mm} body *{visibility:hidden!important} #ntgReport,#ntgReport *{visibility:visible!important} #ntgReport{position:absolute;left:0;top:0;width:100%} .noprint{display:none!important} .ntg-tblwrap{overflow:visible!important;border:0!important} .ntg-tbl th,.ntg-rbk th{color:#000!important;background:#fff!important;border-bottom:2px solid #000} .ntg-card,.ntg-band,.ntg-map{border:1px solid #000;break-inside:avoid}}";
    document.head.appendChild(st);
  }

  /* ---------- exports (match the other admin PDFs; CSV with BOM) ---------- */
  function pdfHead(doc, title, subtitle){
    doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.setTextColor(7,26,74);
    doc.text("CTTLFA - "+title, 40, 46);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(90,101,119);
    doc.text(subtitle||"", 40, 62);
  }
  function pdfFoot(doc){
    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();
    doc.setFontSize(8); doc.setTextColor(140,150,165);
    doc.text("CTTLFA Admin Centre - data integrity - operational - generated "+new Date().toLocaleString("en-ZA"), 40, H-20);
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
  function fullReportPDF(d){
    if(!window.jspdf){ alert("PDF library still loading, try again."); return; }
    var doc=new window.jspdf.jsPDF({unit:"pt",format:"a4"});
    var sub="Inputs and internal mapping - overall "+stWord(d.overall)+" - generated "+dtime(d.generated)+" - operational";
    pdfHead(doc, "Data Integrity report", sub);
    var y=84;
    (d.groups||[]).forEach(function(g){
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(7,26,74);
      doc.text((g.group||"")+"  -  "+stWord(g.rag), 40, y);
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
    d.innerHTML='<div class="ntg-dh"><div><h3 id="ntgDT">Detail</h3><div class="dsub" id="ntgDS"></div></div><button class="ntg-dx" id="ntgDXC" aria-label="Close">×</button></div><div class="ntg-db" id="ntgDB"></div>';
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
      NS.$("ntgDB").innerHTML='<div style="border:1px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--muted)">No exceptions - this check is clear.</div>';
      return;
    }
    var keys=[]; rows.forEach(function(o){ Object.keys(o).forEach(function(k){ if(keys.indexOf(k)<0) keys.push(k); }); });
    function isNum(k){ return /balance|records|count|cards|amount|n$/i.test(k); }
    function fmt(k,v){ if(v==null||v==="") return "–"; if(/balance|amount/i.test(k)) return rand(v); if(isNum(k)) return num(v); return String(v); }
    var cols=keys.map(titleCase);
    var head=keys.map(function(k){ return '<th'+(isNum(k)?' class="num"':'')+'>'+esc(titleCase(k))+'</th>'; }).join("");
    var body=rows.map(function(o){ return '<tr>'+keys.map(function(k){ return '<td'+(isNum(k)?' class="num"':'')+'>'+esc(fmt(k,o[k]))+'</td>'; }).join("")+'</tr>'; }).join("");
    var expRows=rows.map(function(o){ return keys.map(function(k){ return fmt(k,o[k]); }); });
    NS.$("ntgDS").textContent=(detail?detail+" · ":"")+num(rows.length)+" record"+(rows.length===1?"":"s");
    NS.$("ntgDB").innerHTML=
      '<div class="ntg-gh"><span class="ntg-sech" style="margin:0">'+esc(title)+'</span>'+
        '<span class="ntg-acts"><button class="ntg-x" id="ntgDPDF">PDF</button><button class="ntg-x" id="ntgDCSV">CSV</button></span></div>'+
      '<div class="ntg-tblwrap" style="max-height:calc(100vh - 160px)"><table class="ntg-tbl" style="table-layout:auto"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
    NS.$("ntgDPDF").onclick=function(){ expPDF(title, detail||"", cols, expRows); };
    NS.$("ntgDCSV").onclick=function(){ expCSV(title, cols, expRows); };
  }

  /* ==================== DATA HELPERS ==================== */
  function indexChecks(d){
    var by={}; (d.groups||[]).forEach(function(g){ (g.checks||[]).forEach(function(c){ by[c.key]=c; }); });
    return by;
  }
  function chk(by,key){ return by[key] || {status:"amber", display:"–", detail:"", n:0, key:key, title:key, drill:false}; }

  /* one key/value row; state colours the value */
  function kv(k,v,state){ return '<div class="ntg-kv"><span class="k">'+esc(k)+'</span><span class="v'+(state?(" "+ST[state].cls):"")+'">'+v+'</span></div>'; }

  function inputCard(src, title, rag, rows, note){
    var t=ST[rag]||ST.amber;
    return '<div class="ntg-card '+t.cls+'">'+
      '<div class="ntg-ch"><div class="ntg-ct"><span class="src">'+esc(src)+'</span><h4>'+esc(title)+'</h4></div>'+stPill(rag)+'</div>'+
      rows.join("")+
      (note?'<p class="ntg-note">'+note+'</p>':"")+
    '</div>';
  }

  /* ==================== PAGE ==================== */
  var _last=null, _sys=null, _season=null, _mapOpen=false, _tallyInputs=[], _tallyMap=[];

  function renderIntegrity(){
    ensureStyle();
    var root=NS.$("integrityRoot"); if(!root) return;
    if(!root.dataset.loaded) root.innerHTML='<div class="card"><p class="hint">Running the integrity checks…</p></div>';
    Promise.all([
      NS.sb.rpc("data_integrity"),
      NS.sb.rpc("sys_health"),
      fetch("https://www.cttfa.co.za/season.json",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
    ]).then(function(res){
      if(res[0].error) throw res[0].error;
      _last=res[0].data||{}; _sys=(res[1]&&!res[1].error)?(res[1].data||{}):{}; _season=res[2];
      root.dataset.loaded="1";
      draw(root, _last, _sys, _season);
    }).catch(function(e){
      root.innerHTML='<div class="card"><h3>Data Integrity</h3><p class="hint" style="color:#9A3130">Could not run the checks: '+esc(e.message||e)+'</p></div>';
    });
  }

  function draw(root, d, sys, season){
    _exp={}; _expN=0;
    var by=indexChecks(d);
    var D=sys.debtors||{}, A=sys.agent||{};

    /* ----- four inputs ----- */
    // 1. Sage
    var sExtract=chk(by,"fresh_sage_extract"), sBasis=chk(by,"fresh_sage_basis");
    var sRecon = D.extracted_at ? (D.reconciled ? "green" : "amber") : "red";
    var sageRag = worst(sExtract.status, sBasis.status, sRecon);
    var sageRows=[
      kv("Last Sage fetch", esc(sExtract.display)+(A.last_finished_at?'<span class="ntg-run">'+ago(A.last_finished_at)+'</span>':''), sExtract.status),
      kv("Balance date", dday(D.as_at), sBasis.status),
      kv("Ledger tie", D.extracted_at?(D.reconciled?("all "+num(D.n_clubs)+" in sync"):(num(D.out_of_sync)+" out of sync")):"no snapshot", sRecon),
      kv("Net balances", D.net_total!=null?rand(D.net_total):"–"),
      kv("Clubs / owing", (D.n_clubs!=null?num(D.n_clubs):"–")+" / "+(D.n_owing!=null?num(D.n_owing):"–"))
    ];
    var sageNote = !D.extracted_at ? "No debtor snapshot yet. Press Fetch from Sage on Club Debtors."
      : (!D.reconciled ? "The itemised ledger does not tie to the ageing for "+num(D.out_of_sync)+" club(s). Run a fresh fetch before sending statements."
      : (sBasis.status!=="green" ? "Balances tie for all "+num(D.n_clubs)+" clubs. The ageing buckets carry Sage’s report date; set the report date to today in Sage to date the ageing to today."
      : "All "+num(D.n_clubs)+" clubs tie to the Sage ledger. Fetch runs on GitHub Actions, nightly and on the button."));

    // 2. LeagueRepublic
    var lFresh=chk(by,"fresh_lr"), lFeed=chk(by,"ref_lr_feed"), lUnm=chk(by,"recon_lr_clubs");
    var upd=season&&season.updated, fxAgeH=upd?(Date.now()-new Date(upd).getTime())/3.6e6:null;
    var lrRag = worst(lFresh.status, lFeed.status, lUnm.status);
    var lrRows=[
      kv("Last mirror", esc(lFresh.display), lFresh.status),
      kv("Fixtures loaded", esc(lFeed.display), lFeed.status),
      kv("Teams unresolved", num(lUnm.n), lUnm.status),
      kv("Public feed", upd?(dtime(upd)):"not reachable", (upd==null)?"amber":(fxAgeH>12?"amber":"green"))
    ];
    var lrNote = (lUnm.n>0? num(lUnm.n)+" LeagueRepublic team name(s) are not matched to a canonical club; the Club Profile fixtures need this. " : "Fixtures and results mirror nightly from the LeagueRepublic API. ")+
      ((upd==null)?"season.json could not be read to confirm the public feed.":(fxAgeH>12?"The public feed has not refreshed in over 12 hours; run the LeagueRepublic refresh in Website Admin.":""));

    // 3. SAFA registrations (manual capture)
    var rFresh=chk(by,"fresh_reg"), rNoSafa=chk(by,"ident_pe_nosafa"), rDup=chk(by,"ident_pe_dup");
    var regRag = worst(rFresh.status, rNoSafa.status, rDup.status);
    var regRows=[
      kv("Last registration captured", esc(rFresh.display), rFresh.status),
      kv("Without a SAFA number", num(rNoSafa.n), rNoSafa.status),
      kv("Duplicate SAFA numbers", num(rDup.n), rDup.status)
    ];
    var regNote = "Player and club registrations captured by hand from the SAFA card cycle. "+
      (rNoSafa.n>0? num(rNoSafa.n)+" registered person(s) have no SAFA number. " : "")+
      "Off-season gaps in new registrations are expected.";

    // 4. Dash disciplinary mirror
    var dFresh=chk(by,"fresh_dash"), dRows=chk(by,"ref_dash_rows");
    var dashRag = worst(dFresh.status, dRows.status);
    var dashRows=[
      kv("Last sync", esc(dFresh.display), dFresh.status),
      kv("Rows reconciled", esc(dRows.display), dRows.status)
    ];
    var dashNote = "Cards, charges and rulings mirror nightly from dash.cttlfa.com, on GitHub Actions and on the Discipline page Fetch now button.";

    var inputRags=[sageRag,lrRag,regRag,dashRag];

    /* ----- internal mapping roll-up ----- */
    var mapChecks=[];
    (d.groups||[]).forEach(function(g){ if(/identity|reconciliation|referential/i.test(g.group)) (g.checks||[]).forEach(function(c){ mapChecks.push(c); }); });
    var mapRed=mapChecks.filter(function(c){return c.status==="red";}).length;
    var mapAmb=mapChecks.filter(function(c){return c.status==="amber";}).length;
    var mapRag=mapRed?"red":(mapAmb?"amber":"green");
    var mapLine = mapRag==="green" ? "Every input maps to its place. Identities, reconciliations and referential checks all tie up."
      : (mapRag==="red" ? mapRed+" mapping check(s) failing and "+mapAmb+" to review — open the detail." 
      : mapAmb+" mapping check(s) to review before the next reporting cycle.");

    var overall=worst.apply(null, inputRags.concat([mapRag]));
    var band=ST[overall]||ST.amber;
    var overallLine = overall==="green" ? "Every input is fresh and reconciled, and the mapping ties up."
      : overall==="red" ? "One or more inputs or mapping checks are failing and need action."
      : "Some inputs or mapping checks need a review before the next reporting cycle.";
    var cRed=inputRags.concat([mapRag]).filter(function(s){return s==="red";}).length;
    var cAmb=inputRags.concat([mapRag]).filter(function(s){return s==="amber";}).length;

    var head =
      '<div class="card noprint">'+
        '<h2 style="font-family:var(--head);color:var(--navy);margin:0 0 2px">Data Integrity</h2>'+
        '<div class="ntg-prov">'+
          '<span>Inputs: <b>Sage, LeagueRepublic, SAFA registrations, dash</b></span>'+
          '<span>Basis: <b>operational</b></span>'+
          '<span>Checked: <b>'+dtime(d.generated)+'</b></span>'+
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
        '<div class="head"><div class="big"><span aria-hidden="true">'+band.glyph+'</span> Overall: '+band.word+'</div><div class="sub">'+esc(overallLine)+'</div></div>'+
        '<div class="ntg-tally">'+
          tally("Failing", cRed, "bad", "red")+
          tally("To review", cAmb, "warn", "amber")+
          tally("Inputs", 4, "", "inputs")+
        '</div>'+
      '</div>'+
      '<div class="ntg-sech">The four inputs</div>'+
      '<p class="ntg-sub">Everything the Association relies on enters here. Each input is checked for freshness, completeness and reconciliation. Everything else is internal mapping that arranges these into their places.</p>'+
      '<div class="ntg-grid">'+
        inputCard("Sage · accounting", "Club debtors ledger", sageRag, sageRows, sageNote)+
        inputCard("LeagueRepublic · API", "Fixtures & results", lrRag, lrRows, lrNote)+
        inputCard("SAFA · manual capture", "Registrations", regRag, regRows, regNote)+
        inputCard("dash.cttlfa.com", "Disciplinary mirror", dashRag, dashRows, dashNote)+
      '</div>'+
      '<div class="ntg-sech">Internal mapping</div>'+
      '<p class="ntg-sub">The inputs above are arranged into clubs, players, referees and accounts. These checks confirm the arranging holds: identities are unique, names reconcile, and no records are orphaned. This is internal, not an input.</p>'+
      '<div class="ntg-map '+(ST[mapRag].cls)+'">'+
        '<div class="ntg-gh" style="margin:0"><span class="ntg-ct" style="flex-direction:row;align-items:center;gap:10px">'+stPill(mapRag)+'<b style="color:var(--navy)">Mapping across the feeds</b></span>'+
          '<span class="ntg-acts noprint"><button class="ntg-x" id="ntgMapPDF">PDF</button><button class="ntg-x" id="ntgMapCSV">CSV</button></span></div>'+
        '<p class="ntg-note" style="margin-top:8px">'+esc(mapLine)+'</p>'+
        '<button class="ntg-maptoggle noprint" id="ntgMapToggle">'+(_mapOpen?"Hide the detail":"Show the "+mapChecks.length+" mapping checks")+'</button>'+
        '<div id="ntgMapDetail" style="'+(_mapOpen?"":"display:none;")+'margin-top:10px">'+mapDetailHtml(d)+'</div>'+
      '</div>'+
      opsSection(sys, season)+
      '<div class="ntg-legend noprint">'+
        '<span>'+stPill("green")+' clear</span>'+
        '<span>'+stPill("amber")+' review before the next reporting cycle</span>'+
        '<span>'+stPill("red")+' failing — act now</span>'+
        '<span>Click any mapping row with a count to see the records behind it.</span>'+
      '</div>'+
      '<p class="hint" style="margin-top:10px">Reviewed by the Treasurer. Operational data from the live Admin Centre feeds. Generated '+dtime(d.generated)+'.</p>'+
      '</div>';

    _tallyInputs = [
      {src:"Sage · accounting", name:"Club debtors ledger", rag:sageRag, note:sageNote},
      {src:"LeagueRepublic · API", name:"Fixtures & results", rag:lrRag, note:lrNote},
      {src:"SAFA · manual capture", name:"Registrations", rag:regRag, note:regNote},
      {src:"dash.cttlfa.com", name:"Disciplinary mirror", rag:dashRag, note:dashNote}
    ];
    _tallyMap = mapChecks;
    root.innerHTML = head + report;
    // stash mapping export for the roll-up buttons
    d.overall = overall;
    wire(root, d, sys);
  }

  function tally(label, v, cls, kind){ var a=kind?(' ntg-tclk" role="button" tabindex="0" data-tally="'+kind+'" title="Click to see what these are and action them"'):'"'; return '<div class="ntg-t '+(cls||"")+a+'><div class="l">'+esc(label)+'</div><div class="v">'+num(v)+'</div></div>'; }

  /* dynamic tally drill: click Failing / To review / Inputs to see exactly what they are */
  function openTallyDrill(kind){
    ensureDrawer();
    NS.$("ntgScrim").classList.add("on"); NS.$("ntgDrawer").classList.add("on");
    NS.$("ntgDT").textContent = kind==="red"?"Failing":kind==="amber"?"To review":"The four inputs";
    var items=[];
    _tallyInputs.forEach(function(ic){ if(kind==="inputs"||ic.rag===kind) items.push({group:ic.src,name:ic.name,status:ic.rag,detail:ic.note}); });
    if(kind!=="inputs"){ (_tallyMap||[]).forEach(function(c){ if(c.status===kind) items.push({group:"Internal mapping",name:c.title,status:c.status,detail:c.detail,key:c.key,n:c.n,drill:c.drill}); }); }
    NS.$("ntgDS").textContent = items.length+" item"+(items.length===1?"":"s");
    if(!items.length){ NS.$("ntgDB").innerHTML='<div style="border:1px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--muted)">Nothing '+(kind==="red"?"failing":"to review")+' — all clear.</div>'; return; }
    var body=items.map(function(it){
      var drill = it.drill && Number(it.n)>0;
      return '<tr'+(drill?' class="clk" data-drill="'+esc(it.key)+'" data-title="'+esc(it.name)+'" data-detail="'+esc(it.detail)+'"':'')+'>'+
        '<td><b>'+esc(it.name)+'</b><div class="hint" style="font-size:11px">'+esc(it.group)+'</div></td>'+
        '<td>'+stPill(it.status)+'</td>'+
        '<td>'+esc(it.detail)+(drill?' <button class="ntg-more" type="button">View '+num(it.n)+'</button>':'')+'</td>'+
      '</tr>';
    }).join("");
    NS.$("ntgDB").innerHTML='<div class="ntg-tblwrap"><table class="ntg-tbl" style="table-layout:auto"><thead><tr><th>Item</th><th>Status</th><th>What it is / what to do</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    Array.prototype.forEach.call(NS.$("ntgDB").querySelectorAll("tr.clk"),function(tr){ tr.onclick=function(){ openDrill(tr.dataset.drill, tr.dataset.title, tr.dataset.detail); }; });
  }

  /* mapping detail: the three internal groups as properly sized tables */
  function mapDetailHtml(d){
    var html="";
    (d.groups||[]).forEach(function(g){
      if(!/identity|reconciliation|referential/i.test(g.group)) return;
      var rows=(g.checks||[]).map(function(c){
        var drill=c.drill && Number(c.n)>0;
        return '<tr'+(drill?' class="clk" data-drill="'+esc(c.key)+'" data-title="'+esc(c.title)+'" data-detail="'+esc(c.detail)+'"':'')+'>'+
          '<td><b>'+esc(c.title)+'</b></td>'+
          '<td>'+stPill(c.status)+'</td>'+
          '<td class="num">'+esc(c.display)+'</td>'+
          '<td>'+esc(c.detail)+(drill?' <button class="ntg-more" type="button">View '+num(c.n)+'</button>':'')+'</td>'+
        '</tr>';
      }).join("");
      html+='<div class="ntg-gh" style="margin:12px 0 6px"><span class="ntg-sech" style="margin:0">'+stPill(g.rag)+' '+esc(g.group)+'</span></div>'+
        '<div class="ntg-tblwrap"><table class="ntg-tbl"><colgroup><col class="c-check"><col class="c-stat"><col class="c-val"><col class="c-mean"></colgroup>'+
        '<thead><tr><th>Check</th><th>Status</th><th class="num">Value</th><th>What it means</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    });
    return html;
  }

  /* ==================== PLATFORM & OPERATIONS (from sys_health) ==================== */
  function opsPill(word,state){ return stPill(state)+' <span style="font-size:12px;font-weight:600;color:var(--muted)">'+esc(word)+'</span>'; }
  function opsTile(title, rag, wordline, rows, note, btnHtml){
    var t=ST[rag]||ST.amber;
    var kvs=rows.map(function(r){ return kv(r[0], r[1], r[2]); }).join("");
    return '<div class="ntg-card '+t.cls+'">'+
      '<div class="ntg-ch"><div class="ntg-ct"><h4 style="font-size:15px">'+esc(title)+'</h4></div>'+stPill(rag)+'</div>'+
      (wordline?'<p class="ntg-note" style="margin:0 0 8px;color:var(--ink);font-weight:600">'+esc(wordline)+'</p>':"")+
      kvs+
      (note?'<p class="ntg-note">'+note+'</p>':"")+
      (btnHtml?'<div style="margin-top:10px">'+btnHtml+'</div>':"")+
    '</div>';
  }
  function opsSection(sys, season){
    if(!sys || !sys.generated_at) return '<div class="ntg-sech">Platform &amp; operations</div><p class="ntg-sub">Could not load the operational monitors.</p>';
    var E=sys.email||{}, C=sys.correspondence||{}, W=sys.watchdog||{}, P=sys.platform||{}, B=sys.backup||{}, X=sys.access||{};
    var role=(NS.session?NS.session().role:null), canRun=(role==="administrator"||role==="staff");

    // platform monitor
    var pState=P.ok?"green":((P.consecutive_fails||0)>=2?"red":"amber");
    var pWord=P.ok?"All healthy":((P.consecutive_fails||0)>=2?"Service down":"Checking");
    var pRows=(P.checks&&P.checks.length)?P.checks.map(function(c){ return [c.name, c.ok?"OK":esc(c.detail||"fail"), c.ok?"green":"red"]; }):[["Status","not yet run",null]];
    var platTile=opsTile("Platform monitor", pState, pWord, pRows,
      "Checked "+dtime(P.last_checked_at)+(P.last_checked_at?(" ("+ago(P.last_checked_at)+")"):"")+". Runs every 30 minutes; emails on a sustained fault and on recovery.",
      canRun?'<button class="ntg-btn" id="shCheckNow" type="button">Check now</button> <span class="hint" id="shCheckMsg" style="font-size:11.5px"></span>':"");

    // backups
    var bAgeH=B.last_at?((Date.now()-new Date(B.last_at).getTime())/3.6e6):null;
    var bState=B.last_at?(bAgeH>36?"amber":"green"):"red";
    var bWord=B.last_at?(bAgeH>36?"Ageing":"Current"):"None yet";
    var bkTile=opsTile("Backups", bState, bWord, [
        ["Last backup", dtime(B.last_at)+(B.last_at?" ("+ago(B.last_at)+")":""), null],
        ["Size", B.last_bytes!=null?(Math.round(B.last_bytes/1024)+" KB"):"–", null],
        ["Snapshots kept", B.count!=null?num(B.count):"–", null]
      ], "Daily snapshot of the config, mapping and governance tables, 30-day retention. The Sage ledger rebuilds from Sage on restore.",
      canRun?'<button class="ntg-btn" id="shBackupNow" type="button">Back up now</button> <span class="hint" id="shBackupMsg" style="font-size:11.5px"></span>':"");

    // portal access
    var xMiss=X.members_without_login;
    var xState=(xMiss==null)?"amber":(xMiss>0?"amber":"green");
    var xWord=(xMiss==null)?"Unknown":(xMiss>0?num(xMiss)+" without a login":"All covered");
    var acTile=opsTile("Portal access", xState, xWord, [
        ["Active logins", X.active!=null?num(X.active):"–", null],
        ["From Sage / manual", (X.sage!=null?num(X.sage):0)+" / "+(X.manual!=null?num(X.manual):0), null],
        ["Members without a login", xMiss!=null?num(xMiss):"–", (xMiss>0?"amber":null)],
        ["Last synced", dtime(X.last_synced_at), null]
      ], "Every full and associate club must have a login. Sync adds Sage contacts and never removes hand-added people.",
      canRun?'<button class="ntg-btn" id="shSyncNow" type="button">Sync from Sage</button> <span class="hint" id="shSyncMsg" style="font-size:11.5px"></span>':"");

    // email delivery
    var emFailed=Number(E.failed||0);
    var emTile=opsTile("Email delivery (30 days)", emFailed>0?"amber":"green", emFailed>0?num(emFailed)+" failed":"None failed", [
        ["Live emails sent", E.total!=null?num(E.total):0, null],
        ["Failed / bounced", num(emFailed), (emFailed>0?"amber":null)],
        ["Last sent", dtime(E.last_sent_at), null],
        ["Test sends (excluded)", (E.test!=null?num(E.test):0), null]
      ], emFailed>0?"Some emails failed or bounced. Check the club contact address on the Correspondence log and re-send that one.":"Live club emails only; test-mode setup sends are excluded. No failures or bounces recorded by Resend in the last 30 days.", "");

    // correspondence
    var coAw=Number(C.awaiting||0), coF=Number(C.failed||0), coSup=Number(C.superseded||0);
    var coState=coF>0?"red":"green";
    var coWord=coF>0?num(coF)+" failed":(coAw>0?num(coAw)+" queued":"Clear");
    var coRows=[["Last run", dtime(C.last_run_at), null],["Queued for the next send", num(coAw), null],["Failed", num(coF), (coF>0?"bad":null)]];
    if(coSup>0) coRows.push(["Superseded (auto-replaced)", num(coSup), null]);
    var coTile=opsTile("Correspondence queue", coState, coWord, coRows,
      (coF>0?"Some letters failed to send — correct the club contact address on the Correspondence log and re-send those.":(coAw>0?(num(coAw)+" letter(s) are queued for the next scheduled send run; this is expected, not a backlog."):"Nothing is queued."))+(coSup>0?(" "+num(coSup)+" earlier draft(s) were superseded by newer statements and need no action."):""), "");

    // receipts watchdog
    var wState=W.alert_active?"amber":"green";
    var wTile=opsTile("Receipts watchdog", wState, W.alert_active?"Alert":"Normal", [
        ["Last receipt", dday(W.last_receipt_date), null],
        ["Receipt age", W.receipt_age_days!=null?(num(W.receipt_age_days)+" days"):"–", null],
        ["Checked", dtime(W.last_checked_at), null]
      ], (W.alert_active?("Watchdog alert: "+esc(W.alert_kind||"see Club Debtors")+". "):"No receipts-processing alert. ")+"Reads the itemised ledger, which can lag the live balances.", "");

    return '<div class="ntg-sech">Platform &amp; operations</div>'+
      '<p class="ntg-sub">Not inputs, but the safeguards that keep the platform running: uptime, backups, portal access, email delivery, correspondence and receipts. Read-only; snapshot '+dtime(sys.generated_at)+'.</p>'+
      '<div class="ntg-grid">'+platTile+bkTile+acTile+emTile+coTile+wTile+'</div>'+
      runbookHtml();
  }
  function runbookHtml(){
    return '<div class="ntg-sech">If something stops - who and what</div>'+
      '<p class="ntg-sub">A short runbook so any authorised officer can act without waiting on one person. Nothing here changes data.</p>'+
      '<div class="ntg-tblwrap"><table class="ntg-rbk"><colgroup><col class="r-svc"><col class="r-own"><col class="r-act"></colgroup>'+
      '<thead><tr><th>Service</th><th>Owner / backup</th><th>If it is down</th></tr></thead><tbody>'+
      '<tr><td><b>Sage fetch</b><br><span class="hint">Club balances from Sage</span></td><td>Treasurer<br><span class="hint">backup: office secretary</span></td><td>Runs on GitHub Actions, nightly and on the Fetch from Sage button. If a run fails, open the run log in the cttlfa-website repository; the office PC is no longer involved.</td></tr>'+
      '<tr><td><b>Disciplinary mirror</b><br><span class="hint">dash.cttlfa.com</span></td><td>Treasurer</td><td>Runs on GitHub Actions, nightly and on the Discipline Fetch now button. If a run fails, open the dash-fetch run log in the repository.</td></tr>'+
      '<tr><td><b>Club debtor emails</b><br><span class="hint">Statements &amp; reminders</span></td><td>Treasurer</td><td>Delivery runs through Resend. If an email fails, correct the club contact address on the Correspondence log and re-send that one; do not resend a whole batch.</td></tr>'+
      '<tr><td><b>League &amp; fixtures feed</b><br><span class="hint">LeagueRepublic API</span></td><td>Treasurer</td><td>Mirrors on a schedule. If it is hours stale, run the LeagueRepublic refresh in Website Admin, then reload.</td></tr>'+
      '<tr><td><b>Websites &amp; portals</b><br><span class="hint">admin / club / vote</span></td><td>Treasurer</td><td>Hosted on Xneelo; GitHub Actions deploys by FTP from the cttlfa-website repository on each push to main. A bad change is undone by reverting the last commit and pushing.</td></tr>'+
      '<tr><td><b>Database</b><br><span class="hint">Supabase - all data</span></td><td>Treasurer</td><td>Supabase project cttlfa-voting. Backups retained by Supabase; access is by invitation only.</td></tr>'+
      '</tbody></table></div>'+
      '<p class="hint" style="margin:10px 0 0">Escalation: the Treasurer holds the master access. Keep this list current as owners change.</p>';
  }
  function shRunFn(btn,msgId,what){
    var m=NS.$(msgId); btn.disabled=true; if(m) m.textContent=(what==="backup"?"Backing up…":"Checking…");
    NS.sb.rpc("sys_run",{p_what:what}).then(function(r){ if(r.error) throw r.error;
      if(m) m.textContent="Running… refreshing shortly"; setTimeout(renderIntegrity, 6000);
    }).catch(function(e){ if(m) m.textContent="Could not start: "+(e.message||String(e)); btn.disabled=false; });
  }
  function shSync(btn){
    var m=NS.$("shSyncMsg"); btn.disabled=true; if(m) m.textContent="Syncing…";
    NS.sb.rpc("portal_access_sync").then(function(r){ if(r.error) throw r.error; var d=r.data||{};
      if(m) m.textContent=(d.added?("Added "+d.added+" login"+(d.added===1?"":"s")):"Up to date"); setTimeout(renderIntegrity, 800);
    }).catch(function(e){ if(m) m.textContent="Could not sync: "+(e.message||String(e)); btn.disabled=false; });
  }

  /* per-group export registry (mapping roll-up) */
  var _exp={}, _expN=0;
  function regExp(title, columns, rows){ var k="e"+(++_expN); _exp[k]={title:"Data integrity - "+title, columns:columns, rows:rows}; return k; }

  function wire(root, d, sys){
    var rl=NS.$("ntgReload"); if(rl) rl.onclick=function(){ var s=NS.$("ntgStat"); if(s)s.textContent="Re-running…"; root.dataset.loaded=""; renderIntegrity(); };
    var pf=NS.$("ntgPDF"); if(pf) pf.onclick=function(){ fullReportPDF(d); };
    // mapping roll-up export
    var mapCols=["Check","Status","Value","What it means"], mapRows=[];
    (d.groups||[]).forEach(function(g){ if(/identity|reconciliation|referential/i.test(g.group)) (g.checks||[]).forEach(function(c){ mapRows.push([c.title, stWord(c.status), c.display, c.detail]); }); });
    var mp=NS.$("ntgMapPDF"); if(mp) mp.onclick=function(){ expPDF("Data integrity - internal mapping","Overall "+stWord(d.overall)+" - generated "+dtime(d.generated), mapCols, mapRows); };
    var mc=NS.$("ntgMapCSV"); if(mc) mc.onclick=function(){ expCSV("Data integrity - internal mapping", mapCols, mapRows); };
    var mt=NS.$("ntgMapToggle"); if(mt) mt.onclick=function(){ _mapOpen=!_mapOpen; var det=NS.$("ntgMapDetail"); if(det){ det.style.display=_mapOpen?"":"none"; } mt.textContent=_mapOpen?"Hide the detail":"Show the mapping checks"; };
    // drill rows in mapping detail
    Array.prototype.forEach.call(root.querySelectorAll("tr.clk"),function(tr){ tr.onclick=function(){ openDrill(tr.dataset.drill, tr.dataset.title, tr.dataset.detail); }; });
    // ops buttons
    var cn=NS.$("shCheckNow"); if(cn) cn.onclick=function(){ shRunFn(cn,"shCheckMsg","check"); };
    var bn=NS.$("shBackupNow"); if(bn) bn.onclick=function(){ shRunFn(bn,"shBackupMsg","backup"); };
    var sn=NS.$("shSyncNow"); if(sn) sn.onclick=function(){ shSync(sn); };
    // dynamic tally tiles (Failing / To review / Inputs)
    Array.prototype.forEach.call(root.querySelectorAll("[data-tally]"),function(el){ el.onclick=function(){ openTallyDrill(el.getAttribute("data-tally")); }; el.onkeydown=function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openTallyDrill(el.getAttribute("data-tally")); } }; });
  }

  NS.renderIntegrity = renderIntegrity;

})(window.AC = window.AC || {});
