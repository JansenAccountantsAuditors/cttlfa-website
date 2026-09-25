/* CTTLFA admin — Discipline, Referees & Cards + Club Profile.
   Closure over window.AC. Reads live from the dash.cttlfa.com mirror held
   in the main Supabase (dash_* views), via admin-guarded RPCs
   dash_discipline_dashboard(), dash_discipline_rows(), club_profile_index(),
   club_profile(); "Fetch now" queues dash_request_refresh() and polls
   dash_refresh_state() while a dash agent (dash_fetch.py --agent) services it.
   Read-only reporting for Mancom. Figures follow SA conventions: space
   thousands, full stop decimal, brackets for negatives, en dash for nil.
   Operational data. */
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

  /* ---------- LeagueRepublic (live teams & fixtures) ---------- */
  var LR_SEASON = 47708359;           // 2026 season id
  var _lrSeason = null;
  function lrGet(){ if(_lrSeason) return _lrSeason;
    _lrSeason = fetch("https://api.leaguerepublic.com/json/getFixturesForSeason/"+LR_SEASON+".json",{cache:"no-store"})
      .then(function(r){ return r.ok?r.json():[]; }).catch(function(){ return []; });
    return _lrSeason; }
  function lrClean(n){ return String(n||"").replace(/^[A-Za-z0-9]+-\s*\d+\s*-\s*/,"").replace(/\s+/g," ").trim(); }
  function lrClubOf(n){ return lrClean(n).replace(/\s+[A-Z]$/,"").replace(/\s+\d+$/,"").trim(); }
  function lrBye(n){ return /(^|\s)bye\.?$/i.test(lrClean(n)); }
  function nrm(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
  function lrDate(s){ if(!s||String(s).length<8) return null; s=String(s);
    var y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8),hh=s.length>=14?+s.slice(9,11):0,mm=s.length>=14?+s.slice(12,14):0;
    return {t:new Date(y,m-1,d,hh,mm).getTime(), iso:y+"-"+(m<10?"0":"")+m+"-"+(d<10?"0":"")+d, hh:hh, mm:mm}; }
  function clubFixtures(all, aliases, clubName){
    var keys={}; (aliases||[]).concat([clubName]).forEach(function(a){ var k=nrm(lrClubOf(a)); if(k) keys[k]=1; });
    // In LeagueRepublic a club fields a SEPARATE team in each division it enters,
    // and every one of those teams carries the same base club name (Tramway,
    // Tramway B). A team is therefore a (side-name x division) pair, not just a
    // name — a club can even field an A and a B side in one division. Count teams
    // that way so "Teams entered" reconciles with the website and LR (11 for
    // Tramway across 10 divisions), and track distinct divisions on their own.
    var teamMap={}, divSet={}, played=0, toplay=0, mine=[];
    (all||[]).forEach(function(f){
      var hIn=keys[nrm(lrClubOf(f.homeTeamName))], rIn=keys[nrm(lrClubOf(f.roadTeamName))];
      if(!hIn && !rIn) return;
      var hb=lrBye(f.homeTeamName), rb=lrBye(f.roadTeamName), bye=hb||rb;
      var div=lrClean(f.fixtureGroupDesc||"");
      if(hIn && !hb){ var hn=lrClean(f.homeTeamName); teamMap[hn+"||"+div]={name:hn,division:div}; if(div) divSet[div]=1; }
      if(rIn && !rb){ var rn=lrClean(f.roadTeamName); teamMap[rn+"||"+div]={name:rn,division:div}; if(div) divSet[div]=1; }
      if(f.result) played++; else if(!bye) toplay++;
      if(!bye) mine.push(f);
    });
    var teamList=Object.keys(teamMap).sort().map(function(k){ return teamMap[k]; });
    return {teams:teamList, teamCount:teamList.length, divisions:Object.keys(divSet).length,
            played:played, toplay:toplay, fixtures:mine};
  }

  /* ---------- LeagueRepublic standings (season.json — the same published feed the club portal reads) ---------- */
  var SEASON_URL="https://www.cttfa.co.za/season.json";
  var _seasonP=null;
  function seasonGet(){ if(_seasonP) return _seasonP;
    _seasonP=fetch(SEASON_URL,{cache:"no-store"}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; });
    return _seasonP; }
  // A league table row is [name, P, W, D, L, GF, GA, Pts, form]; position is the row order.
  function clubStandings(season, aliases, name){
    if(!season || !season.leagues) return [];
    var keys={}; (aliases||[]).concat([name]).forEach(function(a){ var k=nrm(lrClubOf(a)); if(k) keys[k]=1; });
    var out=[];
    Object.keys(season.leagues).forEach(function(code){
      var lg=season.leagues[code]; if(!lg||!lg.table) return; var tbl=lg.table;
      for(var i=0;i<tbl.length;i++){ var row=tbl[i];
        if(keys[nrm(lrClubOf(row[0]))]){
          out.push({division:lg.name||code, group:lg.group||"", team:lrClean(row[0]), pos:i+1, size:tbl.length,
            P:row[1], W:row[2], D:row[3], L:row[4], gf:row[5], ga:row[6],
            gd:(Number(row[5])||0)-(Number(row[6])||0), pts:row[7], form:row[8]||""});
        }
      }
    });
    out.sort(function(a,b){ if(a.division!==b.division) return a.division<b.division?-1:1; return a.team<b.team?-1:1; });
    return out;
  }
  function ord(n){ n=Number(n)||0; var s=["th","st","nd","rd"], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
  function formHTML(f){ if(!f) return "–"; return '<span class="dsc-form">'+String(f).slice(-6).split("").map(function(c){ return (c==="W"||c==="D"||c==="L")?'<i class="f'+c+'">'+c+'</i>':""; }).join("")+'</span>'; }

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
      ".dsc-kpiclk,.dsc-stclk{cursor:pointer;transition:background .12s}.dsc-kpiclk:hover,.dsc-kpiclk:focus,.dsc-stclk:hover,.dsc-stclk:focus{background:#F5F8FD;outline:none}.dsc-kpiclk:focus-visible,.dsc-stclk:focus-visible{box-shadow:inset 0 0 0 2px var(--blue)}"+
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
      ".dsc-thr{table-layout:fixed;max-width:440px}.dsc-thr td.tc{font-weight:700;color:var(--navy)}"+
      ".dsc-atrisk{table-layout:fixed;min-width:860px}.dsc-atrisk td{vertical-align:middle}.dsc-atrisk td.stnd,.dsc-atrisk td.nxt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsc-atrisk td.stnd .dsc-pill{margin-right:6px}"+
      ".rr-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.rr-filters input,.rr-filters select{padding:8px 11px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:#fff;color:var(--ink)}.rr-filters input{flex:1;min-width:220px}.rr-chip{font-size:12px;font-weight:700;color:var(--navy);background:#fff;border:1px solid var(--line);border-radius:20px;padding:7px 13px;cursor:pointer}.rr-chip.on{background:var(--navy);color:#fff;border-color:var(--navy)}.dsc-openhint{display:inline-flex;align-items:center;gap:5px;font-weight:800;font-size:11.5px;color:var(--gold-d,#9a7213);margin-top:8px}"+
      ".fr-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:4px 0 12px}@media(max-width:820px){.fr-tiles{grid-template-columns:1fr 1fr}}.fr-tile{cursor:pointer;border:1px solid var(--line);border-radius:11px;padding:11px 14px;background:#fff;transition:box-shadow .12s}.fr-tile:hover{background:#F7F9FD}.fr-tile.on{box-shadow:inset 0 0 0 2px var(--navy)}.fr-tile.warn{border-color:#F1D9A8;background:#FDF9EF}.fr-tile.bad{border-color:#F1CFCB;background:#FDF6F5}.fr-tile .l{font-size:11px;color:var(--muted);font-weight:700}.fr-tile .v{font-family:var(--head);font-weight:800;font-size:22px;font-variant-numeric:tabular-nums;margin-top:2px}.fr-tile.warn .v{color:#7a4d10}.fr-tile.bad .v{color:#9A3130}.fr-tile .frsub{font-size:11px;color:var(--muted);margin-top:2px}"+
      ".fr-note{font-size:11.5px;color:var(--muted);line-height:1.5;margin-top:8px}.fr-note b{color:var(--navy)}.fr-mis{background:#FDF9EF;border:1px solid #F1D9A8;border-radius:9px;padding:9px 12px;font-size:11.5px;color:#7a4d10;margin-top:8px}.fr-mis b{color:#5c3a0c}"+
      ".dsc-tblwrap{overflow:auto;flex:1;min-height:40px;border:1px solid var(--line);border-radius:10px}"+
      ".dsc-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}.dsc-pill.bad{background:#FBECEA;color:#8a2e26}.dsc-pill.warn{background:#FCF3D8;color:#7a4d10}.dsc-pill.ok{background:#E7F5EC;color:#1c5136}.dsc-pill.mut{background:#EEF2FA;color:#5A667C}"+
      ".dsc-form{display:inline-flex;gap:2px}.dsc-form i{font-style:normal;font-size:9.5px;font-weight:800;width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;border-radius:3px;color:#fff}.dsc-form .fW{background:#1c7c4a}.dsc-form .fD{background:#9F6621}.dsc-form .fL{background:#9A3130}"+
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
      ".dsc-refkpi{display:flex;flex-wrap:wrap;gap:10px}.dsc-st{flex:1;min-width:112px;border:1px solid var(--line);border-radius:10px;padding:9px 12px;background:#fff}.dsc-st .l{font-size:11px;color:var(--muted);font-weight:600}.dsc-st .v{font-family:var(--head);font-weight:800;font-size:21px;font-variant-numeric:tabular-nums;margin-top:2px}.dsc-st.warn{border-color:#F1CFCB;background:#FDF6F5}.dsc-st.warn .v{color:#9A3130}"+
      ".cpf-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.cpf-two{grid-template-columns:1fr}}"+
      ".cpf-snap{border:1.5px solid var(--blue)}"+
      ".cpf-hd{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;border-bottom:2px solid var(--navy);padding-bottom:12px;margin-bottom:14px}"+
      ".cpf-logo{width:76px;height:76px;object-fit:contain;border-radius:12px;border:1px solid var(--line);background:#fff;flex:0 0 auto}"+
      ".cpf-logoi{display:flex;align-items:center;justify-content:center;font-family:var(--head);font-weight:800;font-size:30px;color:#fff;background:var(--navy)}"+
      ".cpf-hd-main{flex:1;min-width:220px}.cpf-hd-main h2{font-family:var(--head);color:var(--navy);margin:0;font-size:23px}"+
      ".cpf-hd-main .sub{color:var(--muted);font-size:13px;margin-top:3px}.cpf-hd-main .con{font-size:12.5px;margin-top:7px;color:var(--ink);display:flex;flex-wrap:wrap;gap:3px 16px}.cpf-hd-main .con a{color:var(--blue);text-decoration:none}"+
      ".cpf-hd-actions{display:flex;gap:6px;flex:0 0 auto}"+
      ".cpf-snapkpi{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px;background:#fff}@media(max-width:820px){.cpf-snapkpi{grid-template-columns:repeat(3,1fr)}}"+
      ".cpf-snapkpi .kp{padding:11px 13px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.cpf-snapkpi .kp .l{font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.03em}.cpf-snapkpi .kp .v{font-family:var(--head);font-weight:800;font-size:19px;margin-top:2px;font-variant-numeric:tabular-nums}"+
      ".cpf-foot{margin-top:14px;padding-top:10px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}"+
      "@media print{@page{size:A4;margin:11mm} body *{visibility:hidden!important} #cpfPrint,#cpfPrint *{visibility:visible!important} #cpfPrint{position:absolute;left:0;top:0;width:100%;border:0!important;box-shadow:none!important;margin:0!important} .noprint{display:none!important} .dsc-tblwrap{max-height:none!important;overflow:visible!important;border:0!important}}";
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
        doc.text("dash.cttlfa.com mirror · operational · generated "+new Date().toLocaleString("en-ZA"), 40, H-20);
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
  var _exp={}, _expN=0, _subtitle="", _dscData=null;
  function acts(title, columns, rows){ var k="e"+(++_expN); _exp[k]={title:title,columns:columns,rows:rows};
    return '<span class="dsc-acts"><button class="dsc-x" data-pdf="'+k+'">PDF</button><button class="dsc-x" data-csv="'+k+'">CSV</button></span>'; }
  function bhead(title, title2, columns, rows){
    return '<div class="dsc-bh"><span class="dsc-sec">'+esc(title)+'</span>'+acts(title2||title, columns, rows)+'</div>'; }

  /* ---------- suspension standing (yellow-card accumulation, DC Code Art 17.3) ----------
     Cautions accumulate across separate matches. Reaching a threshold carries an
     automatic suspension; the thresholds are cumulative season totals, not resets. */
  function susStand(cards, rules){
    var asc=(rules||[]).slice().sort(function(a,b){ return (a.card_count||0)-(b.card_count||0); });
    var n=Number(cards)||0, reached=null, next=null;
    for(var i=0;i<asc.length;i++){ if(n>=asc[i].card_count){ reached=asc[i]; } else { next=asc[i]; break; } }
    return { reached:reached, next:next, gap: next?(next.card_count-n):0, min: asc.length?asc[0].card_count:0 };
  }
  function susReach(cards, rules){ var s=susStand(cards,rules);
    return s.reached ? (num(s.reached.card_count)+" cards → "+num(s.reached.suspension_matches)+"-match ban")
                     : ("under "+num(s.min)+" cards"); }
  function susNext(cards, rules){ var s=susStand(cards,rules);
    return s.next ? (num(s.gap)+" more → "+num(s.next.suspension_matches)+"-match ban") : "Maximum threshold reached"; }

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
    var _dw=NS.$("dscDrawer"); if(_dw) _dw.style.width="";
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
  function stat(l,v,tone,kpi){ var a=kpi?(' dsc-stclk" data-kpi="'+kpi+'" role="button" tabindex="0" title="Click to list these referees'):''; return '<div class="dsc-st'+(tone==='warn'?' warn':'')+a+'"><div class="l">'+esc(l)+'</div><div class="v">'+v+'</div></div>'; }

  /* ---------- KPI drill (client-side, from the loaded dashboard data) ---------- */
  function showKpiDrawer(title, cols, rows){
    ensureDrawer();
    var _dw=NS.$("dscDrawer"); if(_dw) _dw.style.width="";
    NS.$("dscScrim").classList.add("on"); NS.$("dscDrawer").classList.add("on");
    NS.$("dscDT").textContent=title; NS.$("dscDS").textContent=num(rows.length)+" record"+(rows.length===1?"":"s");
    var head=cols.map(function(c){ var n=/fine|cards|amount|appoint/i.test(c); return '<th'+(n?' class="num"':'')+'>'+esc(c)+'</th>'; }).join("");
    var body=rows.map(function(r){ return '<tr>'+r.map(function(v,i){ var n=/fine|cards|amount|appoint/i.test(cols[i]||''); return '<td'+(n?' class="num"':'')+'>'+esc(v)+'</td>'; }).join("")+'</tr>'; }).join("");
    NS.$("dscDB").innerHTML='<div class="dsc-bh"><span class="dsc-sec">'+esc(title)+'</span><span class="dsc-acts"><button class="dsc-x" id="dscKPDF">PDF</button><button class="dsc-x" id="dscKCSV">CSV</button></span></div><div class="dsc-tblwrap" style="max-height:calc(100vh - 150px)"><table class="dsc-tbl"><thead><tr>'+head+'</tr></thead><tbody>'+(body||'<tr><td colspan="'+cols.length+'" class="hint">No records.</td></tr>')+'</tbody></table></div>';
    NS.$("dscKPDF").onclick=function(){ expPDF(title,_subtitle,cols,rows); };
    NS.$("dscKCSV").onclick=function(){ expCSV(title,cols,rows); };
  }
  function dscRosterDrill(title, filt){
    var refs=(_dscData&&_dscData.referees)||{}, roster=refs.roster||[];
    var rows=roster.filter(filt).map(function(x){ return [x.referee, x.safa||"–", x.registered?"Registered":"Not in register", x.level||"No level", x.appts]; });
    showKpiDrawer(title, ["Referee","SAFA","On register","Level","Appointments"], rows);
  }
  function dscKpiDrill(kind){
    var d=_dscData||{}, cards=d.cards||{}, ru=d.rulings||{}, sus=d.suspensions||{};
    if(kind==="cards"){ showKpiDrawer("Most-carded players", ["Player","SAFA","Register","Club","Cards"], (cards.top_players||[]).map(function(p){ return [p.player, p.safa||"–", p.registered?"Reg":"Not reg", p.club||"–", p.n]; })); }
    else if(kind==="risk"){ showKpiDrawer("Players at suspension risk", ["Player","SAFA","Club","Yellow cards","Standing","To next ban"], (sus.at_risk||[]).map(function(x){ var c=(x.cards!=null?x.cards:(x.n!=null?x.n:0)); return [x.player||x.name||"–", x.safa||"–", x.club||"–", c, susReach(c,sus.rules), susNext(c,sus.rules)]; })); }
    else if(kind==="fines"){ showKpiDrawer("Outstanding fines", ["Case","Player","Article","Fine","Invoice"], (ru.unpaid||[]).map(function(u){ return [u.case_number||"–", u.player||"–", u.article||"–", (u.fine_amount!=null?rand(u.fine_amount):""), u.invoice_number||"–"]; })); }
    else if(kind==="ref:appointed"){ dscRosterDrill("Appointed referees", function(){return true;}); }
    else if(kind==="ref:level"){ dscRosterDrill("Referees with an accreditation level", function(x){return !!x.level;}); }
    else if(kind==="ref:nolevel"){ dscRosterDrill("Referees with no accreditation level", function(x){return !x.level;}); }
    else if(kind==="ref:safa"){ dscRosterDrill("Referees linked to a SAFA number", function(x){return !!(x.safa&&String(x.safa).trim());}); }
    else if(kind==="ref:nosafa"){ dscRosterDrill("Appointed referees with NO SAFA number on the dash", function(x){return !(x.safa&&String(x.safa).trim());}); }
    else if(kind==="ref:reg"){ dscRosterDrill("Referees on the referee register", function(x){return !!x.registered;}); }
  }

  /* ---------- Referee database (full population, filterable + exportable) ---------- */
  var _refReg=null, _rrF={q:"",appointed:false,cttr:false,nosafa:false,active:false,level:""};
  var RR_COLS=["Referee","SAFA","Club","CTTR","On register","Reg type","Level","Accreditations","Appts (season)","Active"];
  function rrHasSafa(r){ return !!(r.safa && String(r.safa).trim()); }
  function rrFiltered(){
    var q=(_rrF.q||"").trim().toLowerCase();
    return (_refReg||[]).filter(function(r){
      if(_rrF.appointed && !r.appointed) return false;
      if(_rrF.cttr && !r.cttr) return false;
      if(_rrF.nosafa && rrHasSafa(r)) return false;
      if(_rrF.active && !r.active) return false;
      if(_rrF.level && (r.level||"")!==_rrF.level) return false;
      if(q){ var hay=((r.referee||"")+" "+(r.safa||"")+" "+(r.club||"")).toLowerCase(); if(hay.indexOf(q)<0) return false; }
      return true;
    });
  }
  function rrRowsArr(list){
    return list.map(function(r){ return [ r.referee||"–", r.safa||"–", r.club||"–", r.cttr?"CTTR":"", r.on_register?"Yes":"No", r.reg_type||"–", r.level||"–", num(r.accreds), r.appointed?num(r.appts):"0", r.active?"Active":"Inactive" ]; });
  }
  function rrRender(){
    var list=rrFiltered();
    var body=list.map(function(r){
      var cttr=r.cttr?'<span class="dsc-pill warn">CTTR</span>':'<span style="color:var(--muted)">–</span>';
      var reg=r.on_register?'<span class="dsc-pill ok">Yes</span>':'<span class="dsc-pill mut">No</span>';
      var act=r.active?'<span class="dsc-pill ok">Active</span>':'<span class="dsc-pill mut">Inactive</span>';
      var ap=r.appointed?('<b>'+num(r.appts)+'</b>'):'<span style="color:var(--muted)">–</span>';
      var dk = rrHasSafa(r) ? ('rsafa|'+esc(String(r.safa))) : ('referee|'+esc(r.referee||""));
      return '<tr class="clk" data-drill="'+dk+'"><td>'+esc(r.referee||"–")+'</td><td>'+esc(r.safa||"–")+'</td><td>'+esc(r.club||"–")+'</td><td>'+cttr+'</td><td>'+reg+'</td><td>'+esc(r.reg_type||"–")+'</td><td>'+esc(r.level||"–")+'</td><td class="num">'+num(r.accreds)+'</td><td class="num">'+ap+'</td><td>'+act+'</td></tr>';
    }).join("");
    var el=NS.$("rrBody"); if(el) el.innerHTML=body||'<tr><td colspan="10" class="hint">No referees match these filters.</td></tr>';
    var c=NS.$("rrCount"); if(c) c.innerHTML='Showing <b>'+num(list.length)+'</b> of '+num((_refReg||[]).length)+' referees'+(list.length!==(_refReg||[]).length?' (filtered)':'');
    Array.prototype.forEach.call(NS.$("dscDB").querySelectorAll("#rrBody [data-drill]"),function(b){ b.onclick=function(ev){ ev.stopPropagation(); var p=b.getAttribute("data-drill").split("|"); openDrill(p[0],p[1]||"",_subtitle); }; });
  }
  function rrDrawBody(){
    var lvlSet={}; (_refReg||[]).forEach(function(r){ if(r.level) lvlSet[r.level]=1; });
    var lvlOpts='<option value="">All levels</option>'+Object.keys(lvlSet).sort().map(function(l){return '<option value="'+esc(l)+'">'+esc(l)+'</option>';}).join("");
    NS.$("dscDB").innerHTML=
      '<div class="dsc-bh"><span class="dsc-sec">Referee database</span><span class="dsc-acts"><button class="dsc-x" id="rrPDF">PDF</button><button class="dsc-x" id="rrCSV">CSV</button></span></div>'+
      '<p class="hint" style="margin:0 0 8px">The full referee database mirrored from dash.cttlfa.com. Filter, then download the current view (PDF/CSV). <b>Club</b> is the referee&rsquo;s affiliation (<b>CTTR</b> = the referee body, not a playing club); <b>Appts</b> = appointments this season (&ldquo;–&rdquo; = not appointed this season). Click a referee for their record.</p>'+
      '<div class="rr-filters">'+
        '<input id="rrSearch" placeholder="Search name, SAFA or club…" value="'+esc(_rrF.q)+'">'+
        '<button class="rr-chip'+(_rrF.appointed?' on':'')+'" data-f="appointed">Appointed this season</button>'+
        '<button class="rr-chip'+(_rrF.cttr?' on':'')+'" data-f="cttr">CTTR</button>'+
        '<button class="rr-chip'+(_rrF.nosafa?' on':'')+'" data-f="nosafa">No SAFA number</button>'+
        '<button class="rr-chip'+(_rrF.active?' on':'')+'" data-f="active">Active only</button>'+
        '<select id="rrLevel">'+lvlOpts+'</select>'+
      '</div>'+
      '<div id="rrCount" class="hint" style="margin-bottom:6px"></div>'+
      '<div class="dsc-tblwrap" style="max-height:calc(100vh - 260px)"><table class="dsc-tbl"><thead><tr><th>Referee</th><th>SAFA</th><th>Club</th><th>CTTR</th><th>On register</th><th>Reg type</th><th>Level</th><th class="num">Accreds</th><th class="num">Appts</th><th>Active</th></tr></thead><tbody id="rrBody"></tbody></table></div>';
    var ls=NS.$("rrLevel"); if(ls){ ls.value=_rrF.level; ls.onchange=function(){ _rrF.level=ls.value; rrRender(); }; }
    var si=NS.$("rrSearch"); if(si) si.oninput=function(){ _rrF.q=si.value; rrRender(); };
    Array.prototype.forEach.call(NS.$("dscDB").querySelectorAll(".rr-chip"),function(b){ b.onclick=function(){ var f=b.getAttribute("data-f"); _rrF[f]=!_rrF[f]; b.classList.toggle("on"); rrRender(); }; });
    NS.$("rrPDF").onclick=function(){ expPDF("Referee database",_subtitle,RR_COLS,rrRowsArr(rrFiltered())); };
    NS.$("rrCSV").onclick=function(){ expCSV("Referee database",RR_COLS,rrRowsArr(rrFiltered())); };
    rrRender();
  }
  function openRefRegister(){
    ensureDrawer();
    var dw=NS.$("dscDrawer"); if(dw) dw.style.width="min(1160px,98vw)";
    NS.$("dscScrim").classList.add("on"); if(dw) dw.classList.add("on");
    NS.$("dscDT").textContent="Referee database"; NS.$("dscDS").textContent=_subtitle||"";
    if(_refReg){ rrDrawBody(); return; }
    NS.$("dscDB").innerHTML='<p class="hint">Loading the referee database…</p>';
    NS.sb.rpc("dash_referee_register").then(function(r){
      if(r.error) throw r.error; _refReg=r.data||[]; rrDrawBody();
    }).catch(function(e){ NS.$("dscDB").innerHTML='<p class="hint">Could not load: '+esc(e.message||e)+'</p>'; });
  }

  /* ---------- Fines: invoicing & payment, reconciled to the Sage ledger ---------- */
  var _fineRec=null, _frF={q:"", status:"action"};
  var FR_COLS=["Case","Player","Club","Article","Fine (R)","Invoice #","Status","Dash flag","Match date"];
  function frLabel(s){ return s==='awaiting_invoice'?'Awaiting invoice':s==='outstanding'?'Outstanding (Sage)':s==='settled'?'Settled (Sage)':s==='not_in_sage'?'Not in Sage':s; }
  function frPill(s){ var c=s==='outstanding'?'bad':s==='awaiting_invoice'?'warn':s==='settled'?'ok':'mut'; return '<span class="dsc-pill '+c+'">'+frLabel(s)+'</span>'; }
  function frFlagTxt(f){ if(f.status==='settled'&&!f.dash_paid) return 'dash: unpaid'; if(f.status==='outstanding'&&f.dash_paid) return 'dash: paid'; return ''; }
  function frMatch(f){
    if(_frF.status==='action') return f.status==='awaiting_invoice'||f.status==='outstanding'||f.status==='not_in_sage';
    if(_frF.status==='mismatch') return (f.status==='settled'&&!f.dash_paid)||(f.status==='outstanding'&&f.dash_paid);
    if(_frF.status!=='all' && f.status!==_frF.status) return false;
    return true;
  }
  function frFiltered(){
    var q=(_frF.q||"").trim().toLowerCase();
    return ((_fineRec&&_fineRec.fines)||[]).filter(function(f){
      if(!frMatch(f)) return false;
      if(q){ var hay=((f.case_number||"")+" "+(f.player||"")+" "+(f.club||"")+" "+(f.invoice||"")+" "+(f.article||"")).toLowerCase(); if(hay.indexOf(q)<0) return false; }
      return true;
    });
  }
  function frRowsArr(list){ return list.map(function(f){ return [ f.case_number||"–", f.player||"–", f.club||"–", f.article||"–", (f.fine_amount!=null?Number(f.fine_amount).toFixed(2):"–"), f.invoice||"–", frLabel(f.status), frFlagTxt(f)||"–", f.match_date||"–" ]; }); }
  function frRender(){
    var list=frFiltered();
    var body=list.map(function(f){
      var flag=frFlagTxt(f); var flagHtml=flag?' <span class="dsc-pill mut" title="Manual dash flag differs from Sage">'+flag+'</span>':'';
      return '<tr><td>'+esc(f.case_number||"–")+'</td><td>'+esc(f.player||"–")+'</td><td>'+esc(f.club||"–")+'</td><td class="wrap">'+esc(f.article||"–")+'</td><td class="num">'+rand(f.fine_amount)+'</td><td>'+esc(f.invoice||"–")+'</td><td style="white-space:nowrap">'+frPill(f.status)+flagHtml+'</td><td>'+dt(f.match_date)+'</td></tr>';
    }).join("");
    var el=NS.$("frBody"); if(el) el.innerHTML=body||'<tr><td colspan="8" class="hint">No fines match this filter.</td></tr>';
    var c=NS.$("frCount"); if(c) c.innerHTML='Showing <b>'+num(list.length)+'</b> fine'+(list.length===1?'':'s');
  }
  function frSetStatus(s){ _frF.status=s; var el=NS.$("fineReconRoot"); if(!el) return;
    Array.prototype.forEach.call(el.querySelectorAll("[data-fr]"),function(b){ b.classList.toggle("on", b.getAttribute("data-fr")===s); });
    Array.prototype.forEach.call(el.querySelectorAll("[data-frtile]"),function(b){ b.classList.toggle("on", b.getAttribute("data-frtile")===s); });
    frRender();
  }
  function frDraw(){
    var s=(_fineRec&&_fineRec.summary)||{}; var el=NS.$("fineReconRoot"); if(!el) return;
    el.innerHTML=
      '<div class="dsc-bh"><span class="dsc-sec">Fines — invoicing &amp; payment (reconciled to Sage)</span><span class="dsc-acts"><button class="dsc-x" id="frPDF">PDF</button><button class="dsc-x" id="frCSV">CSV</button></span></div>'+
      '<p class="hint" style="margin:0 0 10px;max-width:98ch">Every fine the DC has issued, matched to the Sage debtors ledger by invoice number. Payment status is read from <b>Sage</b> (FIFO on each club&rsquo;s account), not the manual dash flag — so &ldquo;Settled&rdquo; means the club&rsquo;s account has cleared that invoice. The fine/invoice is raised to the <b>club</b>, which is jointly liable for its players&rsquo; fines (DC Code Article 15(4)).</p>'+
      '<div class="fr-tiles">'+
        '<div class="fr-tile" data-frtile="all"><div class="l">Fines issued</div><div class="v">'+num(s.issued_n)+'</div><div class="frsub">'+rand(s.issued_amt)+' total</div></div>'+
        '<div class="fr-tile warn" data-frtile="awaiting_invoice"><div class="l">Awaiting invoice</div><div class="v">'+num(s.awaiting_n)+'</div><div class="frsub">'+rand(s.awaiting_amt)+' &middot; finance to raise</div></div>'+
        '<div class="fr-tile bad" data-frtile="outstanding"><div class="l">Outstanding (per Sage)</div><div class="v">'+num(s.outstanding_n)+'</div><div class="frsub">'+rand(s.outstanding_amt)+' &middot; genuinely unpaid</div></div>'+
        '<div class="fr-tile" data-frtile="settled"><div class="l">Settled (per Sage)</div><div class="v">'+num(s.settled_n)+'</div><div class="frsub">invoiced &amp; paid</div></div>'+
      '</div>'+
      ((Number(s.flag_dashunpaid_settled)>0||Number(s.flag_dashpaid_owing)>0||Number(s.not_in_sage_n)>0)?
        '<div class="fr-mis"><b>Dash vs Sage:</b> '+num(s.flag_dashunpaid_settled)+' fine(s) flagged unpaid on the dash are settled in Sage, and '+num(s.flag_dashpaid_owing)+' flagged paid are still owing. '+num(s.not_in_sage_n)+' captured invoice number(s) were not found in Sage. The dash paid/unpaid flag is manual; Sage is authoritative — filter to <b>Dash&harr;Sage mismatch</b> to correct the dash.</div>':'')+
      '<div class="rr-filters">'+
        '<input id="frSearch" placeholder="Search case, player, club or invoice…" value="'+esc(_frF.q)+'">'+
        '<button class="rr-chip" data-fr="action">Action needed</button>'+
        '<button class="rr-chip" data-fr="awaiting_invoice">Awaiting invoice</button>'+
        '<button class="rr-chip" data-fr="outstanding">Outstanding</button>'+
        '<button class="rr-chip" data-fr="settled">Settled</button>'+
        '<button class="rr-chip" data-fr="not_in_sage">Not in Sage</button>'+
        '<button class="rr-chip" data-fr="mismatch">Dash&harr;Sage mismatch</button>'+
        '<button class="rr-chip" data-fr="all">All</button>'+
      '</div>'+
      '<div id="frCount" class="hint" style="margin-bottom:6px"></div>'+
      '<div class="dsc-tblwrap" style="max-height:420px"><table class="dsc-tbl"><thead><tr><th>Case</th><th>Player</th><th>Club</th><th>Article</th><th class="num">Fine</th><th>Invoice #</th><th>Status</th><th>Match date</th></tr></thead><tbody id="frBody"></tbody></table></div>'+
      '<p class="fr-note"><b>When a fine must be paid:</b> within <b>30 days</b> of the invoice / of the club receiving the fine (Rules 10.2.1&ndash;10.2.2 and 10.8). Unpaid past 30 days the club is <b>out of compliance</b> — consequences under Rule 16.4.2.6 (fixture forfeits and a 3-point-per-game deduction) — and the fined player stays <b>ineligible</b> until proof of payment quoting the DC case number reaches the DC Convenor (Rule 10.2.1). A fine under appeal is set aside until the appeal concludes (Rule 10.9). &ldquo;Awaiting invoice&rdquo; = the DC issued the fine but finance has not raised a tax invoice yet.</p>';
    var si=NS.$("frSearch"); if(si) si.oninput=function(){ _frF.q=si.value; frRender(); };
    Array.prototype.forEach.call(el.querySelectorAll("[data-fr]"),function(b){ b.onclick=function(){ frSetStatus(b.getAttribute("data-fr")); }; });
    Array.prototype.forEach.call(el.querySelectorAll("[data-frtile]"),function(b){ b.onclick=function(){ frSetStatus(b.getAttribute("data-frtile")); }; });
    NS.$("frPDF").onclick=function(){ expPDF("Fines — invoicing and payment (Sage-reconciled)",_subtitle,FR_COLS,frRowsArr(frFiltered())); };
    NS.$("frCSV").onclick=function(){ expCSV("Fines — invoicing and payment (Sage-reconciled)",FR_COLS,frRowsArr(frFiltered())); };
    frSetStatus(_frF.status);
  }
  function fineRecLoad(){
    var el=NS.$("fineReconRoot"); if(!el) return;
    NS.sb.rpc("dash_fine_reconciliation").then(function(r){
      if(r.error) throw r.error; _fineRec=r.data||{}; frDraw();
      try{ var s=_fineRec.summary||{}; var k=NS.$("kpiFines"); if(k){ var v=k.querySelector(".v"), sub=k.querySelector(".s");
        if(v) v.innerHTML=rand(s.outstanding_amt); if(sub) sub.innerHTML=num(s.outstanding_n)+' unpaid per Sage · '+rand(s.awaiting_amt)+' awaiting invoice';
        k.setAttribute("title","Invoiced fines unpaid per Sage — click for the full reconciliation");
        k.onclick=function(ev){ ev.stopPropagation(); var t=NS.$("fineReconRoot"); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); };
      } }catch(e){}
    }).catch(function(e){ el.innerHTML='<div class="dsc-bh"><span class="dsc-sec">Fines — invoicing &amp; payment</span></div><p class="hint">Could not load the Sage reconciliation: '+esc(e.message||e)+'</p>'; });
  }

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
    var meta=d.meta||{}, cards=d.cards||{}, ru=d.rulings||{}, refs=d.referees||{}, sus=d.suspensions||{}; _dscData=d;
    var susRules=(sus.rules||[]).slice().sort(function(a,b){ return (a.card_count||0)-(b.card_count||0); });
    var susMin=susRules.length?susRules[0].card_count:4;
    _subtitle = "dash.cttlfa.com mirror · last sync "+dtime(meta.last_pull)+" · operational";

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
        '<div class="dsc-kpi dsc-kpiclk" data-kpi="cards" role="button" tabindex="0" title="Click to list the most-carded players"><div class="k">Yellow cards (cautions)</div><div class="v">'+num(cards.total)+'</div><div class="s">across '+num((cards.by_division||[]).length)+' divisions this season</div></div>'+
        '<div class="dsc-kpi dsc-kpiclk" data-kpi="risk" role="button" tabindex="0" title="Click to list the players at suspension risk"><div class="k">Players at suspension risk</div><div class="v">'+num((sus.at_risk||[]).length)+'</div><div class="s">reached the '+num(susMin)+'-card threshold (Art 17.3)</div></div>'+
        '<div class="dsc-kpi dsc-kpiclk" id="kpiFines" data-kpi="fines" role="button" tabindex="0" title="Click to list the outstanding fines"><div class="k">Fines outstanding</div><div class="v">'+rand(ru.outstanding_amount)+'</div><div class="s">reconciling to Sage…</div></div>'+
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
        '<p class="hint" style="margin-top:6px">SAFA numbers are confirmed against the registration master (Reg = found). Invoice numbers tie fines to Sage. Click a row for that player&rsquo;s full disciplinary record.</p></div>';

    // Referees | suspensions
    var rfRoster=refs.roster||[];
    var refNoSafa=rfRoster.filter(function(x){ return !(x.safa&&String(x.safa).trim()); });
    var raRows=rfRoster.map(function(x){return [x.referee,x.safa||"–",regTxt(x.registered),x.level||"no level",x.appts];});
    var raBody=rfRoster.map(function(x){
      var dk = x.safa ? ('rsafa|'+esc(x.safa)) : ('referee|'+esc(x.referee));
      var lvl = x.level ? esc(x.level) : '<span class="dsc-pill warn">No level</span>';
      return '<tr class="clk" data-drill="'+dk+'"><td>'+esc(x.referee)+'</td><td>'+esc(x.safa||"–")+'</td><td>'+regPill(x.registered)+'</td><td>'+lvl+'</td><td class="num">'+num(x.appts)+'</td></tr>'; }).join("");
    var refBlock=
      '<div class="card">'+
        '<div class="dsc-bh"><span class="dsc-sec">Referees &amp; accreditation</span>'+acts("Referee roster",["Referee","SAFA","Registered","Level","Appointments"],raRows)+'</div>'+
        '<div class="dsc-refkpi">'+
          stat("Appointed this season",num(refs.appointed),"","ref:appointed")+
          stat("With a level",num(refs.with_level),"","ref:level")+
          stat("No level",num(refs.no_level),Number(refs.no_level)>0?"warn":"","ref:nolevel")+
          stat("SAFA linked",num(refs.with_safa),"","ref:safa")+
          stat("No SAFA number",num(refNoSafa.length),refNoSafa.length>0?"warn":"","ref:nosafa")+
          stat("On the referee register",num(refs.cttlfa_registered),"","ref:reg")+
        '</div>'+
        '<p class="hint" style="margin:8px 0 0">These tiles count referees <b>appointed to matches this season</b> ('+num(refs.appointed)+' so far). Every appointed referee should be SAFA-carded — <b>No SAFA number</b> lists the '+num(refNoSafa.length)+' whose dash record has no SAFA number captured; click it to review and download the list to chase with the referee department. The full referee database is summarised below right.</p>'+
        '<div class="dsc-grid" style="margin-top:12px">'+
          '<div class="card" style="box-shadow:none;border:1px solid var(--line)"><div class="dsc-sec" style="font-size:12px;color:var(--muted);margin-bottom:6px">Appointed referees by accreditation level</div>'+bars(refs.by_level,"level","n",null)+'</div>'+
          '<div class="card dsc-stclk" id="refDbCard" role="button" tabindex="0" title="Open the full referee database — searchable, filterable and downloadable" style="box-shadow:none;border:1px solid var(--line)"><div class="dsc-sec" style="font-size:12px;color:var(--muted);margin-bottom:6px">Referee database (all records)</div><div class="dsc-kv"><span>Referees in the database</span><b>'+num(refs.total)+'</b><span>Marked active</span><b>'+num(refs.active)+'</b><span>Accreditation records</span><b>'+num(refs.accreditations)+'</b></div><p class="hint" style="margin-top:6px">The whole referee database on dash.cttlfa.com &mdash; every referee ever registered, not just this season. Of these, <b>'+num(refs.appointed)+'</b> were appointed to CTTLFA matches this season (the tiles above) and <b>'+num(refs.active)+'</b> are marked active. <b>Accreditation records</b> counts accreditations, not referees: a referee can hold more than one over time (re-accreditations or extra codes), so records (<b>'+num(refs.accreditations)+'</b>) exceed referees (<b>'+num(refs.total)+'</b>).</p><span class="dsc-openhint">Open the full register &mdash; search, filter, download <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></div>'+
        '</div>'+
        '<div class="dsc-bh" style="margin-top:12px"><span class="dsc-sec" style="font-size:12px;color:var(--muted)">Appointed referee roster</span></div>'+
        '<div class="dsc-tblwrap" style="max-height:360px"><table class="dsc-tbl"><thead><tr><th>Referee</th><th>SAFA</th><th>Reg</th><th>Level</th><th class="num">Appts</th></tr></thead><tbody>'+(raBody||'<tr><td colspan="5" class="hint">None.</td></tr>')+'</tbody></table></div></div>';
    var ruleRows=susRules.map(function(x){return [x.card_count,x.suspension_matches];});
    var atRows=(sus.at_risk||[]).map(function(x){return [x.player,x.safa||"–",regTxt(x.registered),x.club||"–",x.cards,susReach(x.cards,susRules),susNext(x.cards,susRules)];});
    var atBody=(sus.at_risk||[]).map(function(x){
      var s=susStand(x.cards,susRules);
      var pill = s.reached
        ? '<span class="dsc-pill '+(Number(s.reached.suspension_matches)>=3?"bad":"warn")+'">'+num(s.reached.suspension_matches)+'-match ban</span> <span style="color:var(--muted)">at '+num(s.reached.card_count)+' cards</span>'
        : '<span class="dsc-pill mut">under threshold</span>';
      var nxt = s.next
        ? num(s.gap)+' more <span style="color:var(--muted)">&rarr; '+num(s.next.suspension_matches)+'-match</span>'
        : '<span class="dsc-pill mut">max reached</span>';
      return '<tr class="clk" data-drill="psafa|'+esc(x.safa||"")+'"><td>'+esc(x.player)+'</td><td>'+esc(x.safa||"–")+'</td><td>'+regPill(x.registered)+'</td><td>'+esc(x.club||"–")+'</td><td class="num">'+num(x.cards)+'</td><td class="stnd">'+pill+'</td><td class="nxt">'+nxt+'</td></tr>'; }).join("");
    var thBody=susRules.map(function(x){ var m=Number(x.suspension_matches); return '<tr><td class="tc">'+num(x.card_count)+'</td><td>'+num(x.suspension_matches)+' match'+(m===1?'':'es')+'</td></tr>'; }).join("");
    var susBlock=
      '<div class="card">'+
        '<div class="dsc-bh"><span class="dsc-sec">Suspensions</span>'+acts("Players at risk",["Player","SAFA","Registered","Club","Yellow cards","Standing","To next ban"],atRows)+'</div>'+
        '<p class="hint" style="margin:0 0 14px">Yellow cards (cautions) <b>accumulate across the season</b>. A player cautioned in that many <b>separate matches</b> is automatically suspended for the matches shown — <b>CTTLFA Disciplinary Code, Article 17(3)</b> (accepted 25 February 2026). These are single yellows in different matches, not two yellows in one match (that is an indirect red card and a one-match ban in its own right).</p>'+
        '<div class="dsc-sec" style="font-size:12px;color:var(--muted);margin-bottom:6px">Accumulation thresholds — yellow cards to automatic suspension</div>'+
        '<table class="dsc-tbl dsc-thr"><colgroup><col style="width:58%"><col style="width:42%"></colgroup><thead><tr><th>Yellow cards (separate matches)</th><th>Automatic suspension</th></tr></thead><tbody>'+thBody+'</tbody></table>'+
        '<p class="hint" style="margin:10px 0 16px">Read it as: reach <b>'+num(susMin)+'</b> yellow cards and a suspension applies; each further block of cautions steps it up, as the table shows.</p>'+
        '<div class="dsc-sec" style="font-size:12px;color:var(--muted);margin-bottom:6px">Players at risk <span class="dsc-pill warn">'+num((sus.at_risk||[]).length)+'</span> <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">— each has reached at least '+num(susMin)+' yellow cards; the standing shows the ban their count already carries and how far to the next</span></div>'+
        '<div class="dsc-tblwrap" style="max-height:300px"><table class="dsc-tbl dsc-atrisk"><colgroup><col style="width:19%"><col style="width:10%"><col style="width:8%"><col style="width:18%"><col style="width:9%"><col style="width:22%"><col style="width:14%"></colgroup><thead><tr><th>Player</th><th>SAFA</th><th>Reg</th><th>Club</th><th class="num">Yellow cards</th><th>Standing</th><th>To next ban</th></tr></thead><tbody>'+(atBody||'<tr><td colspan="7" class="hint">No player has reached a threshold.</td></tr>')+'</tbody></table></div>'+
        '<p class="hint" style="margin-top:8px"><b>Standing</b> is the highest threshold the player has reached and the automatic suspension it carries under Article 17(3). <b>To next ban</b> is the further cautions before the next step. Click a player for their full record. Personal data — handle under the Protection of Personal Information Act 4 of 2013.</p>'+
      '</div>';

    root.innerHTML = head + kpi +
      '<div class="dsc-grid">'+divCard+plCard+'</div>'+
      '<div class="dsc-grid" style="margin-top:16px">'+monthCard+clubCard+'</div>'+
      '<div style="margin-top:16px">'+rulingsBlock+'</div>'+
      '<div style="margin-top:16px"><div class="card" id="fineReconRoot"><p class="hint">Loading fines invoicing &amp; payment reconciliation (Sage)…</p></div></div>'+
      '<div style="margin-top:16px">'+refBlock+'</div>'+
      '<div style="margin-top:16px">'+susBlock+'</div>';

    wireToolbar();
    // wire exports
    Array.prototype.forEach.call(root.querySelectorAll("[data-pdf]"),function(b){ b.onclick=function(){ var e=_exp[b.getAttribute("data-pdf")]; if(e) expPDF(e.title,_subtitle,e.columns,e.rows); }; });
    Array.prototype.forEach.call(root.querySelectorAll("[data-csv]"),function(b){ b.onclick=function(){ var e=_exp[b.getAttribute("data-csv")]; if(e) expCSV(e.title,e.columns,e.rows); }; });
    // wire drills
    Array.prototype.forEach.call(root.querySelectorAll("[data-drill]"),function(b){ b.onclick=function(ev){ ev.stopPropagation(); var p=b.getAttribute("data-drill").split("|"); openDrill(p[0],p[1]||"",_subtitle); }; });
    // wire KPI tiles (client-side drill from the loaded dashboard data)
    Array.prototype.forEach.call(root.querySelectorAll("[data-kpi]"),function(b){ var go=function(){ dscKpiDrill(b.getAttribute("data-kpi")); }; b.onclick=function(ev){ ev.stopPropagation(); go(); }; b.onkeydown=function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }; });
    // wire the referee-database card (full, filterable register)
    var _rdb=root.querySelector("#refDbCard"); if(_rdb){ _rdb.onclick=openRefRegister; _rdb.onkeydown=function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openRefRegister(); } }; }
    // load the fines invoicing & payment reconciliation (second RPC, marries fines to the Sage ledger)
    fineRecLoad();
  }

  /* ---------- Fetch now (dispatches the GitHub Actions dash fetch) ---------- */
  var _dscPoll=null;
  function dscFStat(txt,tone){ var el=NS.$("dscFetchStatus"); if(!el) return; el.textContent=txt||""; el.style.color=(tone==="bad")?"#9A3130":(tone==="ok")?"#1c5136":"var(--muted)"; }
  function wireToolbar(){
    var f=NS.$("dscFetch"); if(f) f.onclick=dscFetchNow;
    var rl=NS.$("dscReload"); if(rl) rl.onclick=function(){ renderDiscipline(); };
  }
  function dscFetchNow(){
    var b=NS.$("dscFetch"); if(b) b.disabled=true; dscFStat("Starting the fetch on GitHub...","");
    NS.sb.functions.invoke("dash-refresh",{body:{}}).then(function(r){
      var d=(r&&r.data)||{};
      if((r&&r.error)||d.configured===false||d.ok===false){
        dscFStat((d&&(d.hint||d.detail))||(r&&r.error&&r.error.message)||"Could not start the fetch.","bad");
        if(b) b.disabled=false; return;
      }
      dscStartPoll();
    }).catch(function(e){ dscFStat(e.message||String(e),"bad"); if(b) b.disabled=false; });
  }
  function dscStateText(d){
    var st=d.status||"idle";
    if(st==="queued") return ["Queued - starting the fetch on GitHub...",""];
    if(st==="running") return ["Fetching from dash..."+(d.message?(" ("+d.message+")"):""),""];
    if(st==="error") return ["Last fetch failed: "+(d.message||"see the GitHub Actions run."),"bad"];
    if(st==="done") return ["Done - "+num(d.rows)+" rows synced.","ok"];
    return ["",""];
  }
  function dscStartPoll(){
    if(_dscPoll) clearInterval(_dscPoll); var tries=0;
    _dscPoll=setInterval(function(){ tries++;
      NS.sb.rpc("dash_refresh_state").then(function(r){ if(r.error||!r.data) return; var d=r.data, t=dscStateText(d); dscFStat(t[0],t[1]);
        if(d.status==="done"){ clearInterval(_dscPoll); _dscPoll=null; var b=NS.$("dscFetch"); if(b) b.disabled=false; renderDiscipline(); }
        else if(d.status==="error"){ clearInterval(_dscPoll); _dscPoll=null; var b=NS.$("dscFetch"); if(b) b.disabled=false; }
      });
      if(tries>150){ clearInterval(_dscPoll); _dscPoll=null; var b=NS.$("dscFetch"); if(b) b.disabled=false; }
    }, 4000);
  }

  /* ==================== CLUB PROFILE ==================== */
  var _cpfIndex = null;
  var _cpfData=null, _cpfWeb=null, _cpfFx=null, _cpfPos=null;   // stashed for the PDF export

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
        '<p class="hint" style="margin-top:6px">Players and categories from the registration master; debtor balances from Sage (brackets denote credits); cards, rulings and fines from the disciplinary system. Operational.</p>'+
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
    var c=d.club||{}, reg=d.registrations||{}, deb=d.debtors, dis=d.discipline||{}, meta=d.meta||{}, web=d.web||{};
    _cpfData=d; _cpfWeb=web; _cpfFx=null; _cpfPos=null;   // stash for the PDF; fixtures & positions fill in below
    var byCat=(reg.by_category||[]).map(function(x){ return esc(x.category)+" "+num(x.n); }).join(" &middot; ");

    // ---- header: logo, identity, ground/address, Sage contact, links ----
    var logoUrl = web && web.logo ? ("https://www.cttfa.co.za/wp-content/uploads/"+web.logo) : "";
    var logoHtml = logoUrl
      ? '<img class="cpf-logo" src="'+esc(logoUrl)+'" alt="'+esc(c.name)+' crest" onerror="this.style.visibility=\'hidden\'">'
      : '<div class="cpf-logo cpf-logoi">'+esc((c.name||"?").slice(0,1).toUpperCase())+'</div>';
    var loc = [web.ground, web.suburb].filter(Boolean).join(", ");
    var contact = deb && deb.contact ? deb.contact : {};
    var conBits = [];
    if(contact.email) conBits.push('✉ <a href="mailto:'+esc(contact.email)+'">'+esc(contact.email)+'</a>');
    if(contact.phone) conBits.push('☎ '+esc(contact.phone));
    if(web.address) conBits.push('\u{1F4CD} '+esc(web.address));
    if(web.facebook) conBits.push('<a href="'+esc(web.facebook)+'" target="_blank" rel="noopener">Facebook</a>');
    if(web.website) conBits.push('<a href="'+esc(web.website)+'" target="_blank" rel="noopener">Website</a>');

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
        '</div>';
    } else { debBlock = '<p class="hint">No Sage debtor account matched to this club in the current snapshot.</p>'; }

    var unpaid=(dis.unpaid||[]).map(function(u){
      return '<tr><td>'+esc(u.case_number||"–")+'</td><td>'+esc(u.player||"–")+'</td><td class="wrap">'+esc(u.article||"–")+'</td><td class="num">'+rand(u.fine_amount)+'</td><td>'+esc(u.invoice_number||"–")+'</td></tr>'; }).join("");
    var topP=(dis.top_players||[]).map(function(x){ return esc(x.player)+" ("+num(x.n)+")"; }).join(", ");
    var teams2026 = web && web.teams2026!=null ? web.teams2026 : null;

    box.innerHTML =
      '<div class="card cpf-snap" id="cpfPrint" style="margin-bottom:14px">'+
        '<div class="cpf-hd">'+ logoHtml +
          '<div class="cpf-hd-main"><h2>'+esc(c.name)+'</h2>'+
            '<div class="sub">'+esc(c.type||"club")+(c.active?"":" &middot; inactive")+(loc?" &middot; "+esc(loc):"")+(web.founded?" &middot; est. "+esc(web.founded):"")+'</div>'+
            (conBits.length?'<div class="con">'+conBits.join("")+'</div>':'')+
          '</div>'+
          '<div class="cpf-hd-actions noprint"><button class="btn gold sm" id="cpfPrintBtn">Download PDF</button><button class="btn ghost sm" id="cpfClose">Close</button></div>'+
        '</div>'+
        '<div class="cpf-snapkpi">'+
          '<div class="kp"><div class="l">Players</div><div class="v">'+num(reg.players)+'</div></div>'+
          '<div class="kp"><div class="l">Teams 2026</div><div class="v" id="cpfTeamsKpi">'+(teams2026==null?"–":num(teams2026))+'</div></div>'+
          '<div class="kp"><div class="l">Yellow cards</div><div class="v">'+num(dis.cards_total)+'</div></div>'+
          '<div class="kp"><div class="l">Rulings</div><div class="v">'+num(dis.rulings_total)+'</div></div>'+
          '<div class="kp"><div class="l">Fines out</div><div class="v">'+(Number(dis.fines_outstanding_amount)>0?rand(dis.fines_outstanding_amount):"–")+'</div></div>'+
          '<div class="kp"><div class="l">Debtor</div><div class="v">'+(deb?rand(deb.bal):"–")+'</div></div>'+
        '</div>'+
        '<div class="cpf-two">'+
          '<div><div class="dsc-sec">Registrations</div>'+
            '<div class="dsc-kv">'+
              '<span>Players</span><b>'+num(reg.players)+'</b>'+
              '<span>Active players</span><b>'+num(reg.active_players)+'</b>'+
              '<span>Referees</span><b>'+num(reg.referees)+'</b>'+
              '<span>Seniors / Juniors</span><b>'+num(reg.seniors)+' / '+num(reg.juniors)+'</b>'+
              '<span>Foreign players</span><b>'+num(reg.foreign_players)+'</b>'+
              '<span>Latest season</span><b>'+esc(reg.latest_season||"–")+'</b>'+
            '</div>'+(byCat?'<div class="hint">'+byCat+'</div>':'')+
          '</div>'+
          '<div><div class="dsc-sec">Debtor position (Sage)</div>'+debBlock+'</div>'+
        '</div>'+
        '<div style="margin-top:14px"><div class="dsc-sec">Teams &amp; fixtures (LeagueRepublic, 2026)</div><div id="cpfFx"><p class="hint">Loading teams &amp; fixtures…</p></div></div>'+
        '<div class="dsc-sec" style="margin-top:14px">Discipline</div>'+
        '<div class="dsc-kv">'+
          '<span>Yellow cards</span><b>'+num(dis.cards_total)+'</b>'+
          '<span>Rulings</span><b>'+num(dis.rulings_total)+'</b>'+
          '<span>Fines issued / paid</span><b>'+rand(dis.fines_issued_amount)+' / '+rand(dis.fines_paid_amount)+'</b>'+
          '<span>Fines outstanding</span><b>'+rand(dis.fines_outstanding_amount)+'</b>'+
        '</div>'+
        (topP?'<div class="hint" style="margin-top:4px">Most carded: '+topP+'</div>':'')+
        (unpaid?'<div class="dsc-tblwrap" style="margin-top:8px;max-height:220px"><table class="dsc-tbl"><thead><tr><th>Case</th><th>Player</th><th>Article</th><th class="num">Fine</th><th>Invoice</th></tr></thead><tbody>'+unpaid+'</tbody></table></div>':'')+
        (meta.has_dash?'':'<p class="hint" style="margin-top:8px">Discipline figures await the first dash sync.</p>')+
        '<div class="cpf-foot">Generated '+dt(meta.generated)+'. Sources: registration master, Sage debtors (current snapshot), dash.cttlfa.com disciplinary mirror, LeagueRepublic (live), and the association website. Operational.</div>'+
      '</div>';

    var cl=NS.$("cpfClose"); if(cl) cl.onclick=function(){ box.innerHTML=""; };
    var pb=NS.$("cpfPrintBtn"); if(pb) pb.onclick=function(){ cpfPDF(); };
    fillClubFixtures(web, c.name);
  }

  function lrKeys(aliases, name){
    var keys={}; (aliases||[]).concat([name]).forEach(function(a){ var k=nrm(lrClubOf(a)); if(k) keys[k]=1; });
    return Object.keys(keys);
  }
  function fillClubFixtures(web, name){
    var el=NS.$("cpfFx"); if(!el) return;
    var aliases=(web&&web.lr_aliases)||[];
    // Read the LeagueRepublic mirror in the database first; fall back to the live API.
    var keys=lrKeys(aliases, name);
    NS.sb.rpc("lr_club_fixtures",{p_keys:keys}).then(function(r){
      if(r.error) throw r.error;
      var rows=r.data||[];
      if(!rows.length){ return lrGet().then(render); }
      render(rows);
    }).catch(function(){ lrGet().then(render).catch(function(){ el.innerHTML='<p class="hint">Could not load LeagueRepublic fixtures right now.</p>'; }); });

    function render(all){
      var cf=clubFixtures(all, aliases, name);
      if(!cf.teams.length && !cf.fixtures.length){
        el.innerHTML='<p class="hint">No LeagueRepublic fixtures matched this club for the 2026 season.</p>'; return; }
      var results=cf.fixtures.filter(function(f){return f.result;}).sort(function(a,b){ var da=lrDate(a.fixtureDate),db=lrDate(b.fixtureDate); return (db?db.t:0)-(da?da.t:0); }).slice(0,6);
      var upcoming=cf.fixtures.filter(function(f){return !f.result;}).sort(function(a,b){ var da=lrDate(a.fixtureDate),db=lrDate(b.fixtureDate); return (da?da.t:0)-(db?db.t:0); }).slice(0,6);
      function score(f){ var h=f.homeScore,r=f.roadScore; return (h!=null&&r!=null&&h!==""&&r!=="")?(esc(h)+"–"+esc(r)):esc(f.fixtureStatusDesc||"Result"); }
      function fdate(f){ var dd=lrDate(f.fixtureDate); return dd?dt(dd.iso):"TBC"; }
      var baseKey=nrm(name);
      var teamChips=cf.teams.map(function(t){
        // Label each team by its division. Where the side name differs from the
        // base club name (a B/C side), show that name too so every team is distinct.
        var lab = (nrm(t.name)===baseKey) ? (t.division||t.name) : (t.name+(t.division?" · "+t.division:""));
        return '<span class="dsc-pill mut" style="margin:2px 3px 2px 0" title="'+esc(t.name+(t.division?" — "+t.division:""))+'">'+esc(lab)+'</span>'; }).join("");
      var resBody=results.map(function(f){ return '<tr><td>'+fdate(f)+'</td><td class="wrap">'+esc(f.fixtureGroupDesc||"")+'</td><td>'+esc(lrClean(f.homeTeamName))+'</td><td>'+esc(lrClean(f.roadTeamName))+'</td><td class="num">'+score(f)+'</td></tr>'; }).join("");
      var upBody=upcoming.map(function(f){ return '<tr><td>'+fdate(f)+'</td><td class="wrap">'+esc(f.fixtureGroupDesc||"")+'</td><td>'+esc(lrClean(f.homeTeamName))+'</td><td>'+esc(lrClean(f.roadTeamName))+'</td><td class="wrap">'+esc(f.venueAndSubVenueDesc||"–")+'</td></tr>'; }).join("");
      el.innerHTML =
        '<div class="cpf-snapkpi" style="grid-template-columns:repeat(4,1fr);margin:4px 0 12px">'+
          '<div class="kp"><div class="l">Teams entered</div><div class="v">'+num(cf.teamCount)+'</div></div>'+
          '<div class="kp"><div class="l">Divisions</div><div class="v">'+num(cf.divisions)+'</div></div>'+
          '<div class="kp"><div class="l">Fixtures played</div><div class="v">'+num(cf.played)+'</div></div>'+
          '<div class="kp"><div class="l">Still to play</div><div class="v">'+num(cf.toplay)+'</div></div>'+
        '</div>'+
        (teamChips?'<div style="margin-bottom:10px">'+teamChips+'</div>':'')+
        '<div id="cpfPos" style="margin-bottom:12px"></div>'+
        '<div class="cpf-two">'+
          '<div><div class="dsc-sec" style="font-size:12px;color:var(--muted)">Recent results</div>'+
            '<div class="dsc-tblwrap" style="max-height:230px"><table class="dsc-tbl"><thead><tr><th>Date</th><th>Comp</th><th>Home</th><th>Away</th><th class="num">Score</th></tr></thead><tbody>'+(resBody||'<tr><td colspan="5" class="hint">None yet.</td></tr>')+'</tbody></table></div></div>'+
          '<div><div class="dsc-sec" style="font-size:12px;color:var(--muted)">Upcoming fixtures</div>'+
            '<div class="dsc-tblwrap" style="max-height:230px"><table class="dsc-tbl"><thead><tr><th>Date</th><th>Comp</th><th>Home</th><th>Away</th><th>Venue</th></tr></thead><tbody>'+(upBody||'<tr><td colspan="5" class="hint">None scheduled.</td></tr>')+'</tbody></table></div></div>'+
        '</div>';
      // Reconcile the header "Teams 2026" tile to the LeagueRepublic count so the
      // header, this block and the website all agree on one number.
      var tk=NS.$("cpfTeamsKpi"); if(tk && cf.teamCount) tk.textContent=num(cf.teamCount);
      // Stash for the PDF export.
      _cpfFx={teams:cf.teams, teamCount:cf.teamCount, divisions:cf.divisions, played:cf.played, toplay:cf.toplay,
              results:results, upcoming:upcoming, baseKey:baseKey};
      fillPositions(aliases, name);
    }
  }

  /* ---------- league (log) positions, from the published season feed ---------- */
  function fillPositions(aliases, name){
    var host=NS.$("cpfPos"); if(!host) return;
    host.innerHTML='<div class="dsc-sec" style="font-size:12px;color:var(--muted);margin:2px 0 6px">League positions</div><p class="hint" style="margin:0">Loading league positions…</p>';
    seasonGet().then(function(season){
      var st=clubStandings(season, aliases, name); _cpfPos=st;
      if(!st.length){ host.innerHTML='<div class="dsc-sec" style="font-size:12px;color:var(--muted);margin:2px 0 6px">League positions</div><p class="hint" style="margin:0">No published league standings matched this club for the 2026 season.</p>'; return; }
      var body=st.map(function(s){
        return '<tr><td class="wrap">'+esc(s.division)+'</td><td>'+esc(s.team)+'</td><td class="num">'+ord(s.pos)+' / '+num(s.size)+'</td><td class="num">'+num(s.P)+'</td><td class="num">'+num(s.W)+'</td><td class="num">'+num(s.D)+'</td><td class="num">'+num(s.L)+'</td><td class="num">'+(s.gd>0?"+":"")+num(s.gd)+'</td><td class="num">'+num(s.pts)+'</td><td>'+formHTML(s.form)+'</td></tr>'; }).join("");
      host.innerHTML='<div class="dsc-sec" style="font-size:12px;color:var(--muted);margin:2px 0 6px">League positions</div>'+
        '<div class="dsc-tblwrap" style="max-height:320px"><table class="dsc-tbl"><thead><tr><th>Division</th><th>Team</th><th class="num">Pos</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GD</th><th class="num">Pts</th><th>Form</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
        '<p class="hint" style="margin:6px 0 0">Positions from the published LeagueRepublic season feed, the same source as the website. Form shows the last six results.</p>';
    }).catch(function(){ host.innerHTML=''; _cpfPos=[]; });
  }

  /* ---------- Club Profile PDF (house download format; club crest lead, CTTLFA mark) ---------- */
  // The club crests live on the public website without CORS headers, so a browser
  // cannot embed them into a canvas/PDF directly. The club-crest edge function
  // fetches the image server-side and returns it as a data URL we can drop in.
  function cpfCrest(logo){
    return new Promise(function(res){
      if(!logo || !NS.sb || !NS.sb.functions){ res(null); return; }
      var done=false, to=setTimeout(function(){ if(!done){ done=true; res(null); } }, 6500);
      NS.sb.functions.invoke("club-crest",{body:{logo:logo}}).then(function(r){
        if(done) return; done=true; clearTimeout(to);
        var j=r&&r.data, du=j&&j.dataUrl;
        if(!du){ res(null); return; }
        var fmt=(j.contentType&&/png/i.test(j.contentType))?"PNG":(j.contentType&&/webp/i.test(j.contentType))?"WEBP":"JPEG";
        var img=new Image();
        img.onload=function(){ res({data:du, w:img.naturalWidth||120, h:img.naturalHeight||120, fmt:fmt}); };
        img.onerror=function(){ res({data:du, w:120, h:120, fmt:fmt}); };
        img.src=du;
      }).catch(function(){ if(!done){ done=true; clearTimeout(to); res(null); } });
    });
  }
  function cpfPDF(){
    if(!window.jspdf){ alert("PDF library still loading, try again."); return; }
    var d=_cpfData; if(!d||!d.found) return;
    var web=_cpfWeb||{};
    var btn=NS.$("cpfPrintBtn"); if(btn){ btn.disabled=true; btn.textContent="Preparing…"; }
    cpfCrest(web.logo).then(function(crest){
      try{ buildCpfPDF(crest); } catch(e){ alert("Could not build the PDF: "+(e.message||e)); }
      finally{ if(btn){ btn.disabled=false; btn.textContent="Download PDF"; } }
    });
  }
  function buildCpfPDF(crest){
    var d=_cpfData, c=d.club||{}, reg=d.registrations||{}, deb=d.debtors, dis=d.discipline||{},
        meta=d.meta||{}, web=_cpfWeb||{}, fx=_cpfFx, pos=_cpfPos;
    var doc=new window.jspdf.jsPDF({unit:"pt",format:"a4"});
    var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight(), M=40;
    var NAVY=[7,26,74], INK=[20,30,50], MUT=[90,101,119], LINE=[230,234,243], ZEBRA=[247,249,253];
    var half=(W-2*M-16)/2, y=0;
    function need(h){ if(y+h > H-46){ doc.addPage(); y=54; } }
    function secHead(title){ need(30); doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(7,26,74);
      doc.text(title, M, y); doc.setDrawColor(230,234,243); doc.setLineWidth(0.8); doc.line(M,y+4,W-M,y+4); y+=16; }
    function afterTable(){ y=doc.lastAutoTable.finalY+16; }
    function kv(rows, x, w){ doc.autoTable({ startY:y, body:rows, theme:"plain",
        styles:{fontSize:9,cellPadding:{top:2,bottom:2,left:0,right:0},textColor:INK},
        columnStyles:{0:{textColor:MUT,cellWidth:(w||(W-2*M))*0.6},1:{halign:"right",fontStyle:"bold"}},
        margin:{left:(x||M),right:(x?W-(x+(w||0)):M)}, tableWidth:(w||(W-2*M)) }); }
    function tiles(items, ty){
      var cols=items.length, gap=8, tw=(W-2*M-gap*(cols-1))/cols, th=46;
      items.forEach(function(it,i){ var x=M+i*(tw+gap);
        doc.setDrawColor(230,234,243); doc.setLineWidth(0.8); doc.roundedRect(x,ty,tw,th,5,5,"S");
        doc.setFont("helvetica","normal"); doc.setFontSize(6.8); doc.setTextColor(90,101,119);
        doc.text(String(it.l).toUpperCase(), x+7, ty+15);
        doc.setFont("helvetica","bold"); doc.setFontSize(12.5); doc.setTextColor(7,26,74);
        doc.text(String(it.v), x+7, ty+34);
      });
      return ty+th;
    }
    function fxDate(f){ var dd=lrDate(f.fixtureDate); return dd?dt(dd.iso):"TBC"; }
    function fxScore(f){ var h=f.homeScore,r=f.roadScore; return (h!=null&&r!=null&&h!==""&&r!=="")?(h+"–"+r):(f.fixtureStatusDesc||"Result"); }

    // ---- header: club crest lead, CTTLFA mark small top-right ----
    var boxSz=58, hx=M, hy=18, drew=false;
    if(crest && crest.data){
      var s=Math.min(boxSz/crest.w, boxSz/crest.h), dw=crest.w*s, dh=crest.h*s;
      try{ doc.addImage(crest.data,(crest.fmt||"JPEG"), hx+(boxSz-dw)/2, hy+(boxSz-dh)/2, dw, dh); drew=true; }catch(e){ drew=false; }
    }
    if(!drew){ doc.setFillColor(7,26,74); doc.roundedRect(hx,hy,boxSz,boxSz,8,8,"F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(24);
      doc.text(String((c.name||"?").slice(0,1)).toUpperCase(), hx+boxSz/2, hy+boxSz/2+8, {align:"center"}); }
    var tx=M+boxSz+14;
    doc.setTextColor(7,26,74); doc.setFont("helvetica","bold"); doc.setFontSize(20);
    doc.text(String(c.name||"Club"), tx, 40);
    var subBits=[c.type||"club"]; if(!c.active) subBits.push("inactive");
    var loc=[web.ground, web.suburb].filter(Boolean).join(", "); if(loc) subBits.push(loc);
    if(web.founded) subBits.push("est. "+web.founded);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(90,101,119);
    doc.text(subBits.join("   ·   "), tx, 55);
    var contact=(deb&&deb.contact)?deb.contact:{}, conBits=[];
    if(contact.email) conBits.push(contact.email); if(contact.phone) conBits.push(contact.phone);
    if(conBits.length){ doc.setFontSize(8.5); doc.setTextColor(120,130,145); doc.text(conBits.join("   ·   "), tx, 68); }
    var lw=30;
    try{ if(window.LOGO_URI){ doc.addImage(window.LOGO_URI,"JPEG", W-M-lw, 16, lw, lw); } }catch(e){}
    doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(120,130,145);
    doc.text("CTTLFA", W-M-lw/2, 16+lw+7, {align:"center"});
    doc.setDrawColor(7,26,74); doc.setLineWidth(1.2); doc.line(M,86,W-M,86);

    // ---- provenance ----
    y=100; doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(90,101,119);
    var prov="Club two-pager for Mancom · 2026 season · figures in Rand · sources: registration master, Sage debtors (current snapshot), dash.cttlfa.com disciplinary mirror, LeagueRepublic (live) and the association website · generated "+new Date().toLocaleString("en-ZA")+" · operational management information.";
    var pl=doc.splitTextToSize(prov, W-2*M); doc.text(pl, M, y); y+= pl.length*10 + 8;

    // ---- KPI tiles ----
    var teams = fx?fx.teamCount:(web&&web.teams2026!=null?web.teams2026:null);
    need(52);
    y=tiles([
      {l:"Players",v:num(reg.players)},
      {l:"Teams 2026",v:(teams==null?"–":num(teams))},
      {l:"Yellow cards",v:num(dis.cards_total)},
      {l:"Rulings",v:num(dis.rulings_total)},
      {l:"Fines out",v:(Number(dis.fines_outstanding_amount)>0?rand(dis.fines_outstanding_amount):"–")},
      {l:"Debtor",v:(deb?rand(deb.bal):"–")}
    ], y)+16;

    // ---- registrations | debtor (two columns) ----
    need(30);
    doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.setTextColor(7,26,74);
    var rightX=M+half+16;
    doc.text("Registrations", M, y); doc.text("Debtor position (Sage)", rightX, y);
    doc.setDrawColor(230,234,243); doc.setLineWidth(0.8);
    doc.line(M,y+4,M+half,y+4); doc.line(rightX,y+4,rightX+half,y+4);
    var ty=y+12; y=ty;
    kv([["Players",num(reg.players)],["Active players",num(reg.active_players)],["Referees",num(reg.referees)],
        ["Seniors / Juniors",num(reg.seniors)+" / "+num(reg.juniors)],["Foreign players",num(reg.foreign_players)],
        ["Latest season",String(reg.latest_season||"–")]], M, half);
    var le=doc.lastAutoTable.finalY;
    var debRows = deb ? [["Balance",rand(deb.bal)],["Status",String(deb.status||"–")],["Current",rand(deb.cur)],
        ["30 / 60 / 90 / 120+",rand(deb.b30)+" / "+rand(deb.b60)+" / "+rand(deb.b90)+" / "+rand(deb.b120)],
        ["Last receipt",(deb.last_receipt_days==null?"–":num(deb.last_receipt_days)+" days ago")]]
      : [["","No Sage debtor account matched in the current snapshot."]];
    doc.autoTable({ startY:ty, body:debRows, theme:"plain",
      styles:{fontSize:9,cellPadding:{top:2,bottom:2,left:0,right:0},textColor:INK},
      columnStyles:{0:{textColor:MUT,cellWidth:half*0.52},1:{halign:"right",fontStyle:"bold"}},
      margin:{left:rightX,right:M}, tableWidth:half });
    var re=doc.lastAutoTable.finalY;
    y=Math.max(le,re)+16;

    // ---- league (log) positions ----
    if(pos && pos.length){
      secHead("League positions");
      need(40); doc.autoTable({ startY:y, head:[["Division","Team","Pos","P","W","D","L","GD","Pts","Form"]],
        body:pos.map(function(p){ return [p.division, p.team, ord(p.pos)+" / "+p.size, p.P, p.W, p.D, p.L, (p.gd>0?"+":"")+p.gd, p.pts, String(p.form||"").slice(-6)]; }),
        styles:{fontSize:8,cellPadding:3,textColor:INK,lineColor:LINE,overflow:"linebreak"},
        headStyles:{fillColor:NAVY,textColor:255,fontStyle:"bold",fontSize:7.5},
        columnStyles:{2:{halign:"right"},3:{halign:"right"},4:{halign:"right"},5:{halign:"right"},6:{halign:"right"},7:{halign:"right"},8:{halign:"right"}},
        alternateRowStyles:{fillColor:ZEBRA}, margin:{left:M,right:M} });
      afterTable();
    }

    // ---- teams & fixtures ----
    secHead("Teams & fixtures (LeagueRepublic, 2026)");
    if(fx){
      need(52);
      y=tiles([{l:"Teams entered",v:num(fx.teamCount)},{l:"Divisions",v:num(fx.divisions)},
               {l:"Fixtures played",v:num(fx.played)},{l:"Still to play",v:num(fx.toplay)}], y)+14;
      if(fx.teams && fx.teams.length){
        var teamRows=fx.teams.map(function(t){ return [ (nrm(t.name)===fx.baseKey?(c.name||t.name):t.name), (t.division||"–") ]; });
        need(40); doc.autoTable({ startY:y, head:[["Team","Division"]], body:teamRows,
          styles:{fontSize:8.5,cellPadding:3,textColor:INK,lineColor:LINE},
          headStyles:{fillColor:NAVY,textColor:255,fontStyle:"bold",fontSize:8}, alternateRowStyles:{fillColor:ZEBRA}, margin:{left:M,right:M} });
        afterTable();
      }
      if(fx.results && fx.results.length){
        need(40); doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(90,101,119); doc.text("Recent results", M, y); y+=6;
        doc.autoTable({ startY:y, head:[["Date","Comp","Home","Away","Score"]],
          body:fx.results.map(function(f){ return [fxDate(f), lrClean(f.fixtureGroupDesc||""), lrClean(f.homeTeamName), lrClean(f.roadTeamName), fxScore(f)]; }),
          styles:{fontSize:8.5,cellPadding:3,textColor:INK,lineColor:LINE},
          headStyles:{fillColor:NAVY,textColor:255,fontStyle:"bold",fontSize:8}, columnStyles:{4:{halign:"right"}}, alternateRowStyles:{fillColor:ZEBRA}, margin:{left:M,right:M} });
        afterTable();
      }
      if(fx.upcoming && fx.upcoming.length){
        need(40); doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(90,101,119); doc.text("Upcoming fixtures", M, y); y+=6;
        doc.autoTable({ startY:y, head:[["Date","Comp","Home","Away","Venue"]],
          body:fx.upcoming.map(function(f){ return [fxDate(f), lrClean(f.fixtureGroupDesc||""), lrClean(f.homeTeamName), lrClean(f.roadTeamName), (f.venueAndSubVenueDesc||"–")]; }),
          styles:{fontSize:8.5,cellPadding:3,textColor:INK,lineColor:LINE},
          headStyles:{fillColor:NAVY,textColor:255,fontStyle:"bold",fontSize:8}, alternateRowStyles:{fillColor:ZEBRA}, margin:{left:M,right:M} });
        afterTable();
      }
    } else {
      doc.setFont("helvetica","italic"); doc.setFontSize(9); doc.setTextColor(90,101,119);
      doc.text("LeagueRepublic teams and fixtures were still loading. Open the profile, let it load, then download again.", M, y); y+=18;
    }

    // ---- discipline ----
    secHead("Discipline");
    kv([["Yellow cards",num(dis.cards_total)],["Rulings",num(dis.rulings_total)],
        ["Fines issued / paid",rand(dis.fines_issued_amount)+" / "+rand(dis.fines_paid_amount)],
        ["Fines outstanding",rand(dis.fines_outstanding_amount)]]);
    afterTable();
    var unpaid=(dis.unpaid||[]);
    if(unpaid.length){
      need(40); doc.autoTable({ startY:y, head:[["Case","Player","Article","Fine","Invoice"]],
        body:unpaid.map(function(u){ return [ (u.case_number||"–"), (u.player||"–"), (u.article||"–"), rand(u.fine_amount), (u.invoice_number||"–") ]; }),
        styles:{fontSize:8.5,cellPadding:3,textColor:INK,lineColor:LINE,overflow:"linebreak"},
        headStyles:{fillColor:NAVY,textColor:255,fontStyle:"bold",fontSize:8},
        columnStyles:{2:{cellWidth:200},3:{halign:"right"}}, alternateRowStyles:{fillColor:ZEBRA}, margin:{left:M,right:M} });
      afterTable();
    }

    // ---- footer on every page ----
    var pc=doc.internal.getNumberOfPages();
    for(var i=1;i<=pc;i++){ doc.setPage(i);
      doc.setDrawColor(230,234,243); doc.setLineWidth(0.8); doc.line(M,H-30,W-M,H-30);
      doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(140,150,165);
      doc.text("CTTLFA · "+String(c.name||"")+" · operational management information · generated "+new Date().toLocaleDateString("en-ZA"), M, H-18);
      doc.text("Page "+i+" of "+pc, W-M-44, H-18);
    }
    doc.save(slug(c.name||"club")+"-profile.pdf");
  }

  NS.renderDiscipline = renderDiscipline;
  NS.renderClubProfile = renderClubProfile;
})(window.AC);
