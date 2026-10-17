/* CTTLFA admin - Awards deliberation console (events). Closure over window.AC.
   The full award framework for the Awards Evening: the 8 club-nominated awards
   (live nominations) plus the Mancom/committee and results-based awards, each with
   its criteria, deep links to the supporting Admin Centre data, a compact scan view
   of nominees, and a winner/decision recorder. Admin-gated RPCs. Tracking only. */
(function(NS){
  "use strict";
  var EVENT = "2026";
  var DATA = null, CAND = null, FILTER = "", GROUP = "all", COMPACT = true, OPENCAT = {}, EXP = {};

  // kind drives nominee labels; ev = supporting Admin Centre tabs [label, data-tab]
  var EV = {
    referees:["Referees — cards & activity","referees"],
    discipline:["Discipline / DC","discipline"],
    fixtures:["Fixtures & results","fixtures"],
    registrations:["Registrations","registrations"],
    debtors:["Club compliance","debtors"],
    clubdb:["Club database","clubdb"],
    clubprofile:["Club profiles","clubprofile"]
  };
  function ev(){ var a=[]; for(var i=0;i<arguments.length;i++){ if(EV[arguments[i]]) a.push(EV[arguments[i]]); } return a; }

  var FW = [
    // ---- Group 1: open to club nominations (the 8) ----
    {k:"club_of_the_year",l:"Club of the Year",grp:"club",kind:"club",
      look:"The overall standout club this season, on and off the field.",
      crit:["Performance across age groups and divisions","Administration, compliance and good standing","Membership growth and contribution to the Association"],
      ev:ev("fixtures","registrations","debtors","discipline")},
    {k:"community_engagement",l:"Community Engagement Award",grp:"club",kind:"club",
      look:"A club that used football to make a real difference in its community.",
      crit:["Outreach or projects with tangible impact","Members actively involved","Social responsibility"],ev:ev("clubprofile")},
    {k:"innovation_coaching",l:"Innovation in Coaching Award",grp:"club",kind:"coach",
      look:"A coach who brought something new that measurably improved players.",
      crit:["Innovative methods or programmes","Sharing knowledge with the community","Leadership and mentoring"],ev:ev()},
    {k:"youth_development",l:"Youth Development Award",grp:"club",kind:"club",
      look:"A club with an outstanding junior pathway.",
      crit:["Progression from mini and junior to senior","Youth league and tournament success","Player health, education and welfare"],
      ev:ev("registrations","fixtures")},
    {k:"fair_play",l:"Fair Play Award",grp:"club",kind:"club",
      look:"The standard-setter for sportsmanship and conduct.",
      crit:["Sportsmanship across teams, coaches and supporters","A clean disciplinary record","Respect for opponents and officials"],
      ev:ev("discipline","referees"),data:"fairplay"},
    {k:"player_of_the_year",l:"Player of the Year",grp:"club",kind:"player",
      look:"The season's standout senior player.",
      crit:["Skill and consistency across the season","A major contribution to the team's success","Leadership and conduct on and off the field"],ev:ev("fixtures")},
    {k:"junior_player",l:"Junior Player of the Year",grp:"club",kind:"player",
      look:"The outstanding junior player, Under 18 and younger.",
      crit:["Talent, commitment and improvement","A pivotal role in the team","Maturity and a role-model attitude"],ev:ev("fixtures")},
    {k:"ladies_player",l:"Ladies Player of the Year",grp:"club",kind:"player",
      look:"The standout player in the women's game.",
      crit:["Performance and dedication in the women's division","Contribution and leadership","Promoting women's participation"],ev:ev("fixtures")},
    // ---- Group 2: Mancom & committee awards (not club-nominated) ----
    {k:"senior_team",l:"Senior Team of the Year",grp:"mancom",kind:"team",refcls:"senior",
      look:"The best senior team of the season.",crit:["League and knockout success","Consistency across the season"],ev:ev("fixtures")},
    {k:"senior_coach",l:"Senior Coach of the Year",grp:"mancom",kind:"coach",
      look:"The best senior coach.",crit:["Team results and improvement","Player development and leadership"],ev:ev("fixtures")},
    {k:"junior_team",l:"Junior Team of the Year",grp:"mancom",kind:"team",refcls:"junior",
      look:"The best junior team.",crit:["Junior league and knockout success"],ev:ev("fixtures")},
    {k:"junior_club",l:"Junior Club of the Year",grp:"mancom",kind:"club",
      look:"The strongest junior club overall.",crit:["Strength across junior age groups","Junior participation and results"],ev:ev("fixtures","registrations")},
    {k:"junior_coach",l:"Junior Coach of the Year",grp:"mancom",kind:"coach",
      look:"The best junior coach.",crit:["Junior team results and player development"],ev:ev("fixtures")},
    {k:"womens_team",l:"Women's Team of the Year",grp:"mancom",kind:"team",refcls:"women",
      look:"The best women's team.",crit:["Women's league and knockout success"],ev:ev("fixtures")},
    {k:"girls_player",l:"Girls Player of the Year",grp:"mancom",kind:"player",
      look:"The best girls player.",crit:["Talent and improvement in girls football","A role-model attitude"],ev:ev("fixtures")},
    {k:"referee_of_year",l:"Referee of the Year",grp:"mancom",kind:"official",
      look:"The top match official (Referees Committee).",crit:["Match performance and consistency","Activity and conduct","Development"],ev:ev("referees","discipline")},
    {k:"secretarial",l:"Secretarial / Administrator Award",grp:"mancom",kind:"person",
      look:"An outstanding club administrator or secretary.",crit:["Administration quality and responsiveness","Compliance and good standing","Service to the Association"],ev:ev("debtors","registrations","clubdb")},
    {k:"presidents",l:"President's Award",grp:"mancom",kind:"person",
      look:"The President's discretionary award.",crit:["Exceptional service or contribution, at the President's discretion"],ev:ev()},
    // ---- Group 3: results / knockout (from the competitions) ----
    {k:"coke_cup_seniors",l:"Coke Cup — Seniors",grp:"results",kind:"team",refall:"cups",
      look:"Senior knockout cup winner.",crit:["Winner of the senior knockout competition"],ev:ev("fixtures")},
    {k:"coke_cup_womens",l:"Coke Cup — Women's",grp:"results",kind:"team",refall:"cups",
      look:"Women's knockout cup winner.",crit:["Winner of the women's knockout competition"],ev:ev("fixtures")},
    {k:"coke_cup_u18",l:"Coke Cup — Under 18",grp:"results",kind:"team",refall:"cups",
      look:"Under-18 knockout cup winner.",crit:["Winner of the U18 knockout competition"],ev:ev("fixtures")}
  ];
  var FWMAP = {}; FW.forEach(function(a){ FWMAP[a.k]=a; });
  var GRPLBL = {club:"Open to club nominations",mancom:"Mancom & committee awards",results:"Results / knockout winners"};
  var CLUBKEYS = FW.filter(function(a){return a.grp==="club";}).map(function(a){return a.k;});

  function esc(s){ return NS.esc ? NS.esc(s==null?"":String(s)) : String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  function canWrite(){ try{ return !!(NS.canEdit && NS.canEdit("awards")); }catch(e){ return false; } }
  function fmtDate(iso){ if(!iso) return ""; try{var d=new Date(iso);return d.toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})+" "+d.toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit"});}catch(e){return iso;} }
  function fmtDay(ymd){ if(!ymd) return "—"; try{var p=String(ymd).split("-");var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));return d.toLocaleDateString("en-ZA",{weekday:"long",day:"numeric",month:"long",year:"numeric"});}catch(e){return ymd;} }
  function gotoTab(tab){ try{ var b=document.querySelector('#sideNav .snav[data-tab="'+tab+'"]'); if(b){ b.click(); window.scrollTo({top:0,behavior:"smooth"}); } }catch(e){} }

  function injectStyle(){
    if(document.getElementById("nm-style")) return;
    var css = ""+
      "#nomsRoot .nm-evt{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;margin:2px 0 14px;font-size:13px;color:#59666b}"+
      "#nomsRoot .nm-evt b{color:#212d33}"+
      "#nomsRoot .nm-pill{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:12px;padding:3px 10px;border-radius:999px}"+
      "#nomsRoot .nm-pill.open{background:#e3f0e8;color:#296944;border:1px solid #bcd8c7}"+
      "#nomsRoot .nm-pill.closed{background:#f6e4e2;color:#9a3130;border:1px solid #e3b9b4}"+
      "#nomsRoot .nm-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0 0 14px}"+
      "#nomsRoot .nm-tile{background:#fff;border:1px solid #d3dbde;border-radius:12px;padding:14px 10px;text-align:center}"+
      "#nomsRoot .nm-tile .n{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums;color:#184050;line-height:1}"+
      "#nomsRoot .nm-tile .l{font-size:12px;color:#59666b;margin-top:6px}"+
      "#nomsRoot .nm-tile.sl .n{color:#9a7213}"+
      "#nomsRoot .nm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}"+
      "#nomsRoot .nm-bar .sp{flex:1}"+
      "#nomsRoot .nm-search{font:inherit;padding:8px 11px;border:1px solid #d3dbde;border-radius:8px;min-width:200px}"+
      "#nomsRoot .nm-seg{display:inline-flex;border:1px solid #d3dbde;border-radius:8px;overflow:hidden}"+
      "#nomsRoot .nm-seg button{font:inherit;font-size:12.5px;font-weight:600;border:0;background:#fff;color:#44566a;padding:7px 11px;cursor:pointer;border-right:1px solid #e7ecee}"+
      "#nomsRoot .nm-seg button:last-child{border-right:0}"+
      "#nomsRoot .nm-seg button.on{background:#184050;color:#fff}"+
      "#nomsRoot .nm-grphd{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a6a3a;font-weight:800;margin:16px 2px 8px;border-bottom:1px solid #e7dcc0;padding-bottom:4px}"+
      "#nomsRoot .nm-cat{background:#fff;border:1px solid #d3dbde;border-radius:12px;margin:0 0 10px;overflow:hidden}"+
      "#nomsRoot .nm-cat.won{border-color:#bcd8c7}"+
      "#nomsRoot .nm-cath{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:#184050;color:#fff;flex-wrap:wrap}"+
      "#nomsRoot .nm-cat.grp-mancom .nm-cath{background:#3a3661}"+
      "#nomsRoot .nm-cat.grp-results .nm-cath{background:#4a5560}"+
      "#nomsRoot .nm-cath .cx{transition:transform .15s}#nomsRoot .nm-cat.open .nm-cath .cx{transform:rotate(90deg)}"+
      "#nomsRoot .nm-cath .t{font-weight:700;font-size:14px}"+
      "#nomsRoot .nm-cath .c{font-size:11.5px;font-weight:700;background:rgba(255,255,255,.16);border-radius:999px;padding:2px 9px}"+
      "#nomsRoot .nm-cath .won-chip{margin-left:auto;font-size:11.5px;font-weight:700;background:#1E7A46;border-radius:999px;padding:2px 11px}"+
      "#nomsRoot .nm-cath .sp{margin-left:auto}"+
      "#nomsRoot .nm-catb{display:none;padding:12px 14px}#nomsRoot .nm-cat.open .nm-catb{display:block}"+
      "#nomsRoot .nm-crit{background:#f7f5ee;border:1px solid #e7dcc0;border-radius:9px;padding:9px 12px;margin:0 0 10px}"+
      "#nomsRoot .nm-crit .look{font-size:12.5px;color:#5b4a22;font-style:italic;margin-bottom:4px}"+
      "#nomsRoot .nm-crit ul{margin:0;padding-left:17px}#nomsRoot .nm-crit li{font-size:12.5px;color:#4a4330;margin:2px 0}"+
      "#nomsRoot .nm-evrow{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}"+
      "#nomsRoot .nm-evb{font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;background:#eef2f6;border:1px solid #cfdbe3;color:#1b4a5e;border-radius:999px;padding:4px 11px}"+
      "#nomsRoot .nm-evb:hover{background:#e2ebf1}"+
      "#nomsRoot .nm-evlbl{font-size:11px;color:#8392a0;align-self:center;margin-right:2px}"+
      "#nomsRoot .nm-none{color:#59666b;font-size:12.5px;padding:2px 0 6px}"+
      "#nomsRoot .nm-row{border-bottom:1px solid #eef2f3;padding:7px 2px;cursor:pointer;display:flex;gap:8px;align-items:flex-start}"+
      "#nomsRoot .nm-row:hover{background:#f7fafb}"+
      "#nomsRoot .nm-row .mn{flex:1;min-width:0}"+
      "#nomsRoot .nm-row .nee{font-weight:700;color:#184050;font-size:13px}"+
      "#nomsRoot .nm-row .nee .by{font-weight:400;color:#7a8794;font-size:11.5px}"+
      "#nomsRoot .nm-row .snip{font-size:12px;color:#59666b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
      "#nomsRoot .nm-row.open .snip{white-space:normal}"+
      "#nomsRoot .nm-full{font-size:12.8px;color:#2b3640;white-space:pre-wrap;line-height:1.5;margin:6px 0 2px;display:none}"+
      "#nomsRoot .nm-row.open .nm-full{display:block}"+
      "#nomsRoot .nm-full .ev{font-size:11.5px;color:#44586a;margin-top:5px}#nomsRoot .nm-full .ev a{color:#1b6ea5}"+
      "#nomsRoot .nm-full .mt{font-size:11px;color:#8392a0;margin-top:5px}"+
      "#nomsRoot .nm-star{background:none;border:1px solid #d9c892;color:#9a7213;cursor:pointer;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 9px;flex:none}"+
      "#nomsRoot .nm-star.on{background:#1E7A46;border-color:#1E7A46;color:#fff}"+
      "#nomsRoot .nm-del{background:none;border:0;color:#9a3130;cursor:pointer;font-size:15px;padding:0 2px;flex:none}"+
      "#nomsRoot .nm-dec{background:#f3f7f4;border:1px solid #cfe0d6;border-radius:9px;padding:10px 12px;margin:10px 0 0}"+
      "#nomsRoot .nm-dec h5{margin:0 0 7px;font-size:12px;color:#1c5136;text-transform:uppercase;letter-spacing:.05em}"+
      "#nomsRoot .nm-dec label{display:block;font-size:11.5px;font-weight:600;color:#44566a;margin:6px 0 3px}"+
      "#nomsRoot .nm-dec input,#nomsRoot .nm-dec textarea{width:100%;font:inherit;font-size:13px;border:1px solid #c3d3c9;border-radius:7px;padding:7px 9px;background:#fff}"+
      "#nomsRoot .nm-dec textarea{min-height:46px;resize:vertical}"+
      "#nomsRoot .nm-dec .win input{border-color:#1E7A46;font-weight:700;color:#14562f}"+
      "#nomsRoot .nm-dec .sv{margin-top:8px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;background:#1E7A46;color:#fff;border:0;border-radius:7px;padding:7px 14px}"+
      "#nomsRoot .nm-dec .svn{font-size:11px;color:#296944;margin-left:9px}"+
      "#nomsRoot .nm-decwin{font-size:12px;color:#14562f;margin-left:auto}"+
      "#nomsRoot .nm-msg{padding:10px 2px;color:#59666b;font-size:12.5px}"+
      "#nomsRoot .nm-dat{background:#eef3f5;border:1px solid #cddbe1;border-radius:9px;padding:9px 12px;margin:0 0 10px}"+
      "#nomsRoot .nm-dat h6{margin:0 0 2px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#1b4a5e;font-weight:800}"+
      "#nomsRoot .nm-dat h6 .asof{font-weight:600;color:#6a7d86;text-transform:none;letter-spacing:0}"+
      "#nomsRoot .nm-dat .hl{font-size:12px;font-weight:600;color:#1b4a5e;margin:4px 0 5px}"+
      "#nomsRoot .nm-cand{padding:5px 0;border-top:1px dashed #d5e1e6}#nomsRoot .nm-cand.first{border-top:0}"+
      "#nomsRoot .nm-cand .cn{font-weight:700;color:#184050;font-size:12.8px}"+
      "#nomsRoot .nm-cand .cm{display:inline-block;font-size:11px;font-weight:700;background:#f3ead2;color:#7a5e12;border:1px solid #e4d3a6;border-radius:999px;padding:1px 8px;margin-left:6px;font-variant-numeric:tabular-nums}"+
      "#nomsRoot .nm-cand .cw{font-size:12px;color:#44555f;margin-top:1px;line-height:1.45}"+
      "#nomsRoot .nm-dat .note{font-size:11.5px;color:#5b6b73;margin-top:8px;font-style:italic;line-height:1.45}"+
      "#nomsRoot .nm-dat details{margin-top:8px}#nomsRoot .nm-dat summary{cursor:pointer;font-size:11.5px;font-weight:700;color:#1b4a5e}"+
      "#nomsRoot .nm-reftab{width:100%;border-collapse:collapse;margin-top:6px;font-size:11.5px}"+
      "#nomsRoot .nm-reftab th{text-align:left;padding:3px 6px;border-bottom:1px solid #cddbe1;color:#59666b;font-weight:700}"+
      "#nomsRoot .nm-reftab td{text-align:left;padding:3px 6px;border-bottom:1px solid #e9eff1}"+
      "#nomsRoot .nm-reftab td.n{font-variant-numeric:tabular-nums;text-align:right}"+
      "#nomsRoot .nm-nodata{font-size:11.5px;color:#6a5a2a;background:#faf7ef;border:1px dashed #e0d4b2;border-radius:8px;padding:7px 10px;margin:0 0 10px;line-height:1.45}";
    var s=document.createElement("style"); s.id="nm-style"; s.textContent=css; document.head.appendChild(s);
  }

  function renderNoms(){
    var root = NS.$("nomsRoot"); if(!root) return;
    if(NS.canSee && !NS.canSee("awards")){
      root.innerHTML='<div class="card"><h3>Award nominations</h3><p class="hint">This area is restricted. Ask an administrator for access.</p></div>';
      return;
    }
    injectStyle();
    root.innerHTML='<div class="card"><p class="hint">Loading the awards console&hellip;</p></div>';
    Promise.all([
      NS.sb.rpc("awards_noms_list",{p_event:EVENT}),
      NS.sb.rpc("awards_candidates")
    ]).then(function(res){
      var r=res[0], rc=res[1];
      if(r.error){
        var m=(r.error.message||"");
        root.innerHTML='<div class="card"><h3>Award nominations</h3><p class="hint">'+(m.indexOf("not authorised")>-1?"This area is restricted. Ask an administrator for access.":"Could not load: "+esc(m))+'</p></div>';
        return;
      }
      DATA=r.data;
      CAND=(rc && !rc.error && rc.data) ? rc.data : null;
      paint(root);
    });
  }

  function decFor(k){ return (DATA.decisions||{})[k]||null; }

  function paint(root){
    if(!DATA) return;
    var e=DATA.event||{}, noms=DATA.noms||[];
    var open = e.noms_open !== false;
    var w = canWrite();
    var total = DATA.total||noms.length;
    var clubsNom = DATA.clubs_nominated||0;
    var shortlisted = noms.filter(function(n){return n.shortlisted;}).length;
    var decided = Object.keys(DATA.decisions||{}).filter(function(k){ var d=DATA.decisions[k]; return d && d.winner; }).length;

    var h='';
    h += '<div class="card">';
    h += '<h3 style="margin:0 0 2px">Awards console &mdash; '+esc(e.title||("Awards "+EVENT))+'</h3>';
    h += '<div class="nm-evt">'+
      '<span>Nominations close: <b>'+fmtDay(e.noms_deadline)+'</b></span>'+
      '<span class="nm-pill '+(open?"open":"closed")+'">'+(open?"● Nominations open":"● Nominations closed")+'</span>'+
      '</div>';

    var tiles=[
      ["Nominations", total, ""],
      ["Clubs nominated", clubsNom+" / 50", ""],
      ["Shortlisted", shortlisted, "sl"],
      ["Winners set", decided+" / "+FW.length, ""]
    ];
    h += '<div class="nm-tiles">'+tiles.map(function(t){ return '<div class="nm-tile'+(t[2]==="sl"?" sl":"")+'"><div class="n">'+esc(t[1])+'</div><div class="l">'+esc(t[0])+'</div></div>'; }).join("")+'</div>';

    h += '<div class="nm-bar">'+
      '<input class="nm-search" id="nmSearch" type="search" placeholder="Search nominee, club, nominator, motivation…" value="'+esc(FILTER)+'">'+
      '<div class="nm-seg" id="nmGroupSeg">'+
        '<button data-g="all"'+(GROUP==="all"?' class="on"':'')+'>All awards</button>'+
        '<button data-g="club"'+(GROUP==="club"?' class="on"':'')+'>Club nominations</button>'+
        '<button data-g="mancom"'+(GROUP==="mancom"?' class="on"':'')+'>Mancom &amp; committee</button>'+
        '<button data-g="results"'+(GROUP==="results"?' class="on"':'')+'>Results</button>'+
      '</div>'+
      '<div class="nm-seg" id="nmViewSeg">'+
        '<button data-v="compact"'+(COMPACT?' class="on"':'')+'>Compact</button>'+
        '<button data-v="detailed"'+(!COMPACT?' class="on"':'')+'>Detailed</button>'+
      '</div>'+
      '<span class="sp"></span>'+
      '<button class="btn ghost sm" id="nmRefresh" type="button">Refresh</button>'+
      '<button class="btn ghost sm" id="nmCsv" type="button">Export CSV</button>'+
      (w?'<button class="btn sm" id="nmToggle" type="button">'+(open?"Close nominations":"Re-open nominations")+'</button>':'')+
      '</div>';

    h += '<div id="nmBody"></div>';
    h += '<p class="hint" style="font-size:11.5px;margin:12px 0 0">Each award shows its criteria, the candidates the Admin Centre data points to (with a short motivation against the criteria), and the club nominations. The 8 club awards take nominations; the Mancom, committee and results awards are decided internally. Record the winner in each. Where an award shows no data, it rests on nominations and judgement. “Supporting data” buttons jump to the full tab.</p>';
    h += '</div>';
    root.innerHTML=h;

    NS.$("nmSearch").addEventListener("input", function(){ FILTER=this.value; body(w); });
    Array.prototype.forEach.call(NS.$("nmGroupSeg").querySelectorAll("button"), function(b){ b.addEventListener("click", function(){ GROUP=b.getAttribute("data-g"); paint(root); }); });
    Array.prototype.forEach.call(NS.$("nmViewSeg").querySelectorAll("button"), function(b){ b.addEventListener("click", function(){ COMPACT=(b.getAttribute("data-v")==="compact"); body(w); }); });
    NS.$("nmRefresh").addEventListener("click", renderNoms);
    NS.$("nmCsv").addEventListener("click", exportCsv);
    if(w){ NS.$("nmToggle").addEventListener("click", function(){ toggleOpen(open); }); }
    body(w);
  }

  function body(w){
    var host=NS.$("nmBody"); if(!host) return;
    var f=FILTER.toLowerCase();
    var noms=(DATA.noms||[]);
    var matched = !f ? noms : noms.filter(function(n){
      return [n.nominee_name,n.nominee_club,n.nominee_division,n.nominating_club,n.nominator_name,n.nominator_role,n.motivation,n.evidence].join(" ").toLowerCase().indexOf(f)>-1;
    });
    var byKey={}; matched.forEach(function(n){ (byKey[n.award_key]=byKey[n.award_key]||[]).push(n); });

    var groups = GROUP==="all" ? ["club","mancom","results"] : [GROUP];
    var h='';
    groups.forEach(function(g){
      var cats=FW.filter(function(a){return a.grp===g;});
      h += '<div class="nm-grphd">'+esc(GRPLBL[g])+'</div>';
      cats.forEach(function(a){
        var list=byKey[a.k]||[];
        var totalForAward=(DATA.noms||[]).filter(function(n){return n.award_key===a.k;}).length;
        var d=decFor(a.k);
        var won = d && d.winner;
        var isOpen = (OPENCAT[a.k]===true) || (g==="club" && list.length>0 && OPENCAT[a.k]!==false && !!f);
        if(OPENCAT[a.k]===undefined && g==="club" && !!f && list.length>0) isOpen=true;
        var cnt = g==="club" ? ('<span class="c">'+list.length+(f&&list.length!==totalForAward?(" / "+totalForAward):"")+' nom'+(list.length===1?"":"s")+'</span>') : '';
        h += '<div class="nm-cat grp-'+g+(isOpen?' open':'')+(won?' won':'')+'" data-k="'+esc(a.k)+'">'+
          '<div class="nm-cath"><span class="cx">&#9656;</span><span class="t">'+esc(a.l)+'</span>'+cnt+
            (won?'<span class="won-chip">🏆 '+esc(d.winner)+'</span>':'<span class="sp"></span>')+
          '</div>'+
          '<div class="nm-catb">'+catBody(a,list,w,f)+'</div>'+
        '</div>';
      });
    });
    host.innerHTML=h;

    Array.prototype.forEach.call(host.querySelectorAll(".nm-cath"), function(hd){
      hd.addEventListener("click", function(ev){ if(ev.target.closest("a,button,input,textarea")) return; var box=hd.parentNode; var k=box.getAttribute("data-k"); OPENCAT[k]=box.classList.toggle("open"); });
    });
    Array.prototype.forEach.call(host.querySelectorAll(".nm-evb"), function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); gotoTab(b.getAttribute("data-tab")); }); });
    Array.prototype.forEach.call(host.querySelectorAll(".nm-row"), function(r){ r.addEventListener("click", function(ev){ if(ev.target.closest("button")) return; var id=r.getAttribute("data-id"); EXP[id]=!EXP[id]; r.classList.toggle("open"); }); });
    if(w){
      Array.prototype.forEach.call(host.querySelectorAll(".nm-star"), function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); shortlist(b.getAttribute("data-id"), b.getAttribute("data-on")!=="1"); }); });
      Array.prototype.forEach.call(host.querySelectorAll(".nm-del"), function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); del(b.getAttribute("data-id")); }); });
      Array.prototype.forEach.call(host.querySelectorAll(".nm-dec .sv"), function(b){ b.addEventListener("click", function(){ saveDecision(b.getAttribute("data-k")); }); });
    }
  }

  function catBody(a,list,w,f){
    var h='';
    // criteria
    h += '<div class="nm-crit"><div class="look">'+esc(a.look)+'</div><ul>'+a.crit.map(function(c){return '<li>'+esc(c)+'</li>';}).join('')+'</ul></div>';
    // data-driven candidates brought in from the Admin Centre
    h += candPanel(a);
    // supporting data links
    if(a.ev && a.ev.length){
      h += '<div class="nm-evrow"><span class="nm-evlbl">Supporting data:</span>'+a.ev.map(function(x){return '<button class="nm-evb" data-tab="'+esc(x[1])+'">'+esc(x[0])+' →</button>';}).join('')+'</div>';
    }
    // nominations (club group only)
    if(a.grp==="club"){
      if(list.length===0){ h += '<div class="nm-none">No nominations'+(f?" match your search":" yet")+'.</div>'; }
      else { h += list.map(function(n){ return COMPACT ? rowCompact(n,w) : rowFull(n,w); }).join(""); }
    } else {
      h += '<div class="nm-none">Decided by '+(a.grp==="results"?"the competition results":"the Management Committee / committee")+'. Use the criteria and supporting data above.</div>';
    }
    // decision recorder
    if(w){
      var d=decFor(a.k)||{};
      h += '<div class="nm-dec" data-k="'+esc(a.k)+'"><h5>Mancom decision</h5>'+
        '<label>Shortlist / candidates</label><textarea data-f="shortlist" placeholder="Names under consideration…">'+esc(d.shortlist||"")+'</textarea>'+
        '<label>Winner</label><div class="win"><input type="text" data-f="winner" value="'+esc(d.winner||"")+'" placeholder="Agreed winner"></div>'+
        '<label>Notes</label><textarea data-f="notes" placeholder="Reasoning, runner-up, anything for the record…">'+esc(d.notes||"")+'</textarea>'+
        '<button class="sv" data-k="'+esc(a.k)+'" type="button">Save decision</button>'+(d.saved_at?'<span class="svn">saved '+fmtDate(d.saved_at)+(d.decided_by?(" · "+esc(d.decided_by)):"")+'</span>':'')+
      '</div>';
    } else {
      var dv=decFor(a.k);
      if(dv && (dv.winner||dv.shortlist)){
        h += '<div class="nm-dec"><h5>Mancom decision</h5>'+(dv.winner?('<div><b>Winner:</b> '+esc(dv.winner)+'</div>'):'')+(dv.shortlist?('<div style="margin-top:4px"><b>Shortlist:</b> '+esc(dv.shortlist)+'</div>'):'')+(dv.notes?('<div style="margin-top:4px">'+esc(dv.notes)+'</div>'):'')+'</div>';
      }
    }
    return h;
  }

  function candPanel(a){
    if(!CAND || !CAND.awards){ return ''; }
    var c=CAND.awards[a.k];
    if(!c){ return nodataLine(a); }
    var items=(c.items||[]);
    var h='<div class="nm-dat"><h6>From the Admin Centre data'+(CAND.asof?' <span class="asof">· as at '+esc(CAND.asof)+'</span>':'')+'</h6>';
    if(c.headline){ h+='<div class="hl">'+esc(c.headline)+'</div>'; }
    if(items.length){
      h+=items.map(function(it,i){ return '<div class="nm-cand'+(i===0?" first":"")+'"><span class="cn">'+esc(it.name)+'</span>'+(it.metric?'<span class="cm">'+esc(it.metric)+'</span>':'')+'<div class="cw">'+esc(it.why)+'</div></div>'; }).join('');
    } else {
      h+='<div class="cw" style="font-size:12px;color:#5b6b73">No qualifying candidates in the data yet.</div>';
    }
    h+=refPanel(a);
    if(c.note){ h+='<div class="note">'+esc(c.note)+'</div>'; }
    h+='</div>';
    return h;
  }
  function nodataLine(a){
    if(!CAND){ return ''; }
    return '<div class="nm-nodata">No objective Admin Centre metric feeds this award &mdash; it rests on the '+(a.grp==="club"?"club motivations below":"committee&rsquo;s judgement")+' against the criteria. If that feels thin, the criteria may need sharpening.</div>';
  }
  function refPanel(a){
    if(!CAND || !CAND.ref){ return ''; }
    if(a.refcls){
      var rows=(CAND.ref.league_champions||[]).filter(function(x){return x.cls===a.refcls;});
      if(!rows.length) return '';
      return '<details><summary>All '+rows.length+' '+esc(a.refcls)+' league champions</summary>'+
        '<table class="nm-reftab"><thead><tr><th>Division</th><th>Champion</th><th class="n">Pts</th><th class="n">GD</th></tr></thead><tbody>'+
        rows.map(function(x){return '<tr><td>'+esc(x.division)+'</td><td>'+esc(x.team)+'</td><td class="n">'+esc(x.pts)+'</td><td class="n">'+(x.gd>=0?'+':'')+esc(x.gd)+'</td></tr>';}).join('')+
        '</tbody></table></details>';
    }
    if(a.refall==='cups'){
      var cw=(CAND.ref.cup_winners||[]);
      if(!cw.length) return '';
      return '<details><summary>All '+cw.length+' knockout cup finals</summary>'+
        '<table class="nm-reftab"><thead><tr><th>Competition</th><th>Winner</th><th>Final result</th></tr></thead><tbody>'+
        cw.map(function(x){return '<tr><td>'+esc(x.division)+'</td><td>'+esc(x.winner)+'</td><td>'+esc(x.score)+'</td></tr>';}).join('')+
        '</tbody></table></details>';
    }
    return '';
  }

  function snippet(s){ s=String(s||"").replace(/\s+/g," ").trim(); return s.length>120 ? esc(s.slice(0,120))+"…" : esc(s); }
  function linkify(s){ s=esc(s); return s.replace(/((https?:\/\/|www\.)[^\s]+)/gi, function(u){ var href=/^https?:/i.test(u)?u:("https://"+u); return '<a href="'+href+'" target="_blank" rel="noopener">'+u+'</a>'; }); }

  function rowCompact(n,w){
    var ex=EXP[n.id];
    var sub=[]; if(n.nominee_club && n.nominee_club!==n.nominee_name) sub.push(esc(n.nominee_club)); if(n.nominee_division) sub.push(esc(n.nominee_division));
    var star = w ? '<button class="nm-star'+(n.shortlisted?" on":"")+'" data-id="'+esc(n.id)+'" data-on="'+(n.shortlisted?"1":"0")+'">'+(n.shortlisted?"★":"☆")+'</button>' : (n.shortlisted?'<span class="nm-star on">★</span>':'');
    return '<div class="nm-row'+(ex?" open":"")+'" data-id="'+esc(n.id)+'">'+
      '<div class="mn"><div class="nee">'+esc(n.nominee_name||"")+(sub.length?' <span class="by">'+sub.join(" · ")+'</span>':'')+' <span class="by">— by '+esc(n.nominating_club||"")+'</span></div>'+
        '<div class="snip">'+snippet(n.motivation)+'</div>'+
        '<div class="nm-full">'+esc(n.motivation||"")+
          (n.evidence?'<div class="ev"><b>Supporting:</b> '+linkify(n.evidence)+'</div>':'')+
          '<div class="mt">'+esc(n.nominator_name||"")+(n.nominator_role?(" ("+esc(n.nominator_role)+")"):"")+(n.nominator_email?(" · "+esc(n.nominator_email)):"")+' · '+fmtDate(n.created_at)+(w?' &nbsp; <button class="nm-del" data-id="'+esc(n.id)+'" title="Remove">&times; remove</button>':'')+'</div>'+
        '</div>'+
      '</div>'+star+
    '</div>';
  }
  function rowFull(n,w){ EXP[n.id]=true; return rowCompact(n,w); }

  function shortlist(id,on){
    NS.sb.rpc("awards_nom_shortlist",{p_id:id,p_on:on}).then(function(r){
      if(r.error){ window.alert("Could not update: "+r.error.message); return; }
      var n=(DATA.noms||[]).filter(function(x){return x.id===id;})[0]; if(n) n.shortlisted=on;
      body(canWrite());
    });
  }
  function del(id){
    if(!window.confirm("Remove this nomination? This cannot be undone.")) return;
    NS.sb.rpc("awards_nom_delete",{p_id:id}).then(function(r){
      if(r.error){ window.alert("Could not remove: "+r.error.message); return; }
      renderNoms();
    });
  }
  function saveDecision(k){
    var box=document.querySelector('.nm-dec[data-k="'+k+'"]'); if(!box) return;
    var sl=box.querySelector('[data-f="shortlist"]').value, wn=box.querySelector('[data-f="winner"]').value, nt=box.querySelector('[data-f="notes"]').value;
    var btn=box.querySelector('.sv'); var ot=btn.textContent; btn.disabled=true; btn.textContent="Saving…";
    NS.sb.rpc("awards_decision_set",{p_event:EVENT,p_award:k,p_shortlist:sl,p_winner:wn,p_notes:nt}).then(function(r){
      btn.disabled=false; btn.textContent=ot;
      if(r.error){ window.alert("Could not save: "+r.error.message); return; }
      DATA.decisions=DATA.decisions||{}; DATA.decisions[k]={shortlist:sl,winner:wn,notes:nt,saved_at:new Date().toISOString()};
      OPENCAT[k]=true; paint(NS.$("nomsRoot"));
    });
  }
  function toggleOpen(open){
    if(!window.confirm(open ? "Close nominations? Clubs will no longer be able to submit." : "Re-open nominations so clubs can submit again?")) return;
    NS.sb.rpc("awards_noms_set_open",{p_event:EVENT,p_open:!open}).then(function(r){
      if(r.error){ window.alert("Could not update: "+r.error.message); return; }
      renderNoms();
    });
  }
  function exportCsv(){
    var noms=(DATA&&DATA.noms)||[];
    var cols=["award_label","nominee_name","nominee_club","nominee_division","motivation","evidence","nominating_club","nominator_name","nominator_role","nominator_email","shortlisted","created_at"];
    var head=["Award","Nominee","Nominee club","Division / age","Motivation","Supporting","Nominating club","Nominator","Role","Email","Shortlisted","Submitted"];
    function q(v){ if(v===true)v="yes"; if(v===false)v="no"; v=(v==null?"":String(v)).replace(/"/g,'""'); return '"'+v+'"'; }
    var lines=[head.map(q).join(",")];
    noms.forEach(function(n){ lines.push(cols.map(function(c){ return q(n[c]); }).join(",")); });
    // decisions block
    var decs=DATA.decisions||{};
    lines.push(""); lines.push(['Award','Winner','Shortlist','Notes','Saved by'].map(q).join(","));
    FW.forEach(function(a){ var d=decs[a.k]; if(d){ lines.push([a.l,d.winner,d.shortlist,d.notes,d.decided_by].map(q).join(",")); } });
    var blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    var aEl=document.createElement("a"); aEl.href=URL.createObjectURL(blob);
    aEl.download="CTTLFA_Awards_"+EVENT+"_Nominations_"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(aEl); aEl.click(); document.body.removeChild(aEl);
  }

  NS.renderNoms = renderNoms;
})(window.AC);
