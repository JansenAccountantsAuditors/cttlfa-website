/* CTTLFA admin - Award Nominations review (events). Closure over window.AC.
   Reads awards_noms_list; office opens/closes nominations, shortlists and removes.
   Grouped by award for the Mancom review. All access via admin-gated RPCs.
   Shares the "awards" permission module. Tracking only, no money. */
(function(NS){
  "use strict";
  var EVENT = "2026";
  var DATA = null, FILTER = "", OPENAW = {};

  var AWARDS = [
    ["club_of_the_year","Club of the Year"],
    ["community_engagement","Community Engagement Award"],
    ["innovation_coaching","Innovation in Coaching Award"],
    ["youth_development","Youth Development Award"],
    ["fair_play","Fair Play Award"],
    ["player_of_the_year","Player of the Year"],
    ["junior_player","Junior Player of the Year"],
    ["ladies_player","Ladies Player of the Year"]
  ];
  var AWLBL = {}; AWARDS.forEach(function(a){ AWLBL[a[0]]=a[1]; });

  function esc(s){ return NS.esc ? NS.esc(s==null?"":String(s)) : String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  function canWrite(){ try{ return !!(NS.canEdit && NS.canEdit("awards")); }catch(e){ return false; } }
  function fmtDate(iso){ if(!iso) return ""; try{var d=new Date(iso);return d.toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})+" "+d.toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit"});}catch(e){return iso;} }

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
      "#nomsRoot .nm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px}"+
      "#nomsRoot .nm-bar .sp{flex:1}"+
      "#nomsRoot .nm-search{font:inherit;padding:8px 11px;border:1px solid #d3dbde;border-radius:8px;min-width:220px}"+
      "#nomsRoot .nm-aw{background:#fff;border:1px solid #d3dbde;border-radius:12px;margin:0 0 12px;overflow:hidden}"+
      "#nomsRoot .nm-awh{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:#184050;color:#fff}"+
      "#nomsRoot .nm-awh .t{font-weight:700;font-size:14px}"+
      "#nomsRoot .nm-awh .c{margin-left:auto;font-size:12px;font-weight:700;background:rgba(255,255,255,.16);border-radius:999px;padding:2px 10px}"+
      "#nomsRoot .nm-awh .cx{transition:transform .15s}"+
      "#nomsRoot .nm-aw.open .nm-awh .cx{transform:rotate(90deg)}"+
      "#nomsRoot .nm-awb{display:none;padding:8px 12px 12px}"+
      "#nomsRoot .nm-aw.open .nm-awb{display:block}"+
      "#nomsRoot .nm-none{color:#59666b;font-size:13px;padding:8px 2px}"+
      "#nomsRoot .nm-card{border:1px solid #e3e9ee;border-left:4px solid #c9a24b;border-radius:10px;padding:11px 13px;margin:8px 0;background:#fcfbf7}"+
      "#nomsRoot .nm-card.sl{border-left-color:#1E7A46;background:#f2faf5}"+
      "#nomsRoot .nm-card .top{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}"+
      "#nomsRoot .nm-card .nee{font-weight:800;color:#184050;font-size:14px}"+
      "#nomsRoot .nm-card .sub{font-size:12px;color:#59666b;margin-top:1px}"+
      "#nomsRoot .nm-card .act{margin-left:auto;display:flex;gap:4px;align-items:center}"+
      "#nomsRoot .nm-star{background:none;border:1px solid #d9c892;color:#9a7213;cursor:pointer;font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px}"+
      "#nomsRoot .nm-star.on{background:#1E7A46;border-color:#1E7A46;color:#fff}"+
      "#nomsRoot .nm-del{background:none;border:0;color:#9a3130;cursor:pointer;font-size:16px;padding:0 4px;border-radius:6px}"+
      "#nomsRoot .nm-mot{font-size:13px;color:#2b3640;margin:8px 0 0;white-space:pre-wrap;line-height:1.5}"+
      "#nomsRoot .nm-ev{font-size:12px;color:#44586a;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}"+
      "#nomsRoot .nm-ev a{color:#1b6ea5}"+
      "#nomsRoot .nm-meta{font-size:11.5px;color:#8392a0;margin-top:7px}"+
      "#nomsRoot .nm-msg{padding:14px;color:#59666b}";
    var s=document.createElement("style"); s.id="nm-style"; s.textContent=css; document.head.appendChild(s);
  }

  function renderNoms(){
    var root = NS.$("nomsRoot"); if(!root) return;
    if(NS.canSee && !NS.canSee("awards")){
      root.innerHTML='<div class="card"><h3>Award nominations</h3><p class="hint">This area is restricted. Ask an administrator for access.</p></div>';
      return;
    }
    injectStyle();
    root.innerHTML='<div class="card"><p class="hint">Loading nominations&hellip;</p></div>';
    NS.sb.rpc("awards_noms_list",{p_event:EVENT}).then(function(r){
      if(r.error){
        var m=(r.error.message||"");
        root.innerHTML='<div class="card"><h3>Award nominations</h3><p class="hint">'+(m.indexOf("not authorised")>-1?"This area is restricted. Ask an administrator for access.":"Could not load nominations: "+esc(m))+'</p></div>';
        return;
      }
      DATA=r.data; paint(root);
    });
  }

  function paint(root){
    if(!DATA) return;
    var e=DATA.event||{}, noms=DATA.noms||[], byAw=DATA.by_award||{};
    var open = e.noms_open !== false;
    var w = canWrite();
    var total = DATA.total||noms.length;
    var clubsNom = DATA.clubs_nominated||0;
    var shortlisted = noms.filter(function(n){return n.shortlisted;}).length;
    var awardsWith = Object.keys(byAw).length;

    var h='';
    h += '<div class="card">';
    h += '<h3 style="margin:0 0 2px">Award nominations &mdash; '+esc(e.title||("Awards "+EVENT))+'</h3>';
    h += '<div class="nm-evt">'+
      '<span>Nominations from member clubs, grouped by award for Mancom review.</span>'+
      '<span class="nm-pill '+(open?"open":"closed")+'">'+(open?"● Nominations open":"● Nominations closed")+'</span>'+
      '</div>';

    var tiles=[
      ["Nominations", total, ""],
      ["Clubs nominated", clubsNom+" / 50", ""],
      ["Shortlisted", shortlisted, "sl"],
      ["Awards covered", awardsWith+" / 8", ""]
    ];
    h += '<div class="nm-tiles">'+tiles.map(function(t){ return '<div class="nm-tile'+(t[2]==="sl"?" sl":"")+'"><div class="n">'+esc(t[1])+'</div><div class="l">'+esc(t[0])+'</div></div>'; }).join("")+'</div>';

    h += '<div class="nm-bar">'+
      '<input class="nm-search" id="nmSearch" type="search" placeholder="Search nominee, club, nominator, motivation…" aria-label="Search nominations" value="'+esc(FILTER)+'">'+
      '<span class="sp"></span>'+
      '<button class="btn ghost sm" id="nmRefresh" type="button">Refresh</button>'+
      '<button class="btn ghost sm" id="nmCsv" type="button">Export CSV</button>'+
      (w?'<button class="btn sm" id="nmToggle" type="button">'+(open?"Close nominations":"Re-open nominations")+'</button>':'')+
      '</div>';

    h += '<div id="nmGroups"></div>';
    h += '</div>';
    root.innerHTML=h;

    NS.$("nmSearch").addEventListener("input", function(){ FILTER=this.value; groups(w); });
    NS.$("nmRefresh").addEventListener("click", renderNoms);
    NS.$("nmCsv").addEventListener("click", exportCsv);
    if(w){ NS.$("nmToggle").addEventListener("click", function(){ toggleOpen(open); }); }
    groups(w);
  }

  function groups(w){
    var host=NS.$("nmGroups"); if(!host) return;
    var f=FILTER.toLowerCase();
    var all=(DATA.noms||[]);
    var filtered = !f ? all : all.filter(function(n){
      return [n.nominee_name,n.nominee_club,n.nominee_division,n.nominating_club,n.nominator_name,n.nominator_role,n.motivation,n.evidence].join(" ").toLowerCase().indexOf(f)>-1;
    });
    var byKey={}; filtered.forEach(function(n){ (byKey[n.award_key]=byKey[n.award_key]||[]).push(n); });

    var h='';
    AWARDS.forEach(function(a){
      var key=a[0], label=a[1], list=byKey[key]||[];
      var totalForAward=(DATA.noms||[]).filter(function(n){return n.award_key===key;}).length;
      var isOpen = OPENAW[key]!==false && (list.length>0); // open groups that have matches
      if(OPENAW[key]===true) isOpen=true;
      h += '<div class="nm-aw'+(isOpen?" open":"")+'" data-awk="'+esc(key)+'">'+
        '<div class="nm-awh"><span class="cx">&#9656;</span><span class="t">'+esc(label)+'</span><span class="c">'+list.length+(f&&list.length!==totalForAward?(" / "+totalForAward):"")+'</span></div>'+
        '<div class="nm-awb">'+
          (list.length===0 ? '<div class="nm-none">No nominations'+(f?" match your search":" yet")+'.</div>'
            : list.map(function(n){ return card(n,w); }).join(""))+
        '</div>'+
      '</div>';
    });
    host.innerHTML=h;

    Array.prototype.forEach.call(host.querySelectorAll(".nm-awh"), function(hd){
      hd.addEventListener("click", function(){ var box=hd.parentNode; var k=box.getAttribute("data-awk"); var now=box.classList.toggle("open"); OPENAW[k]=now; });
    });
    if(w){
      Array.prototype.forEach.call(host.querySelectorAll(".nm-star"), function(b){ b.addEventListener("click", function(){ shortlist(b.getAttribute("data-id"), b.getAttribute("data-on")!=="1"); }); });
      Array.prototype.forEach.call(host.querySelectorAll(".nm-del"), function(b){ b.addEventListener("click", function(){ del(b.getAttribute("data-id")); }); });
    }
  }

  function linkify(s){
    s=esc(s);
    return s.replace(/((https?:\/\/|www\.)[^\s]+)/gi, function(u){ var href=/^https?:/i.test(u)?u:("https://"+u); return '<a href="'+href+'" target="_blank" rel="noopener">'+u+'</a>'; });
  }

  function card(n,w){
    var sub=[];
    if(n.award_key!=="club_of_the_year" && n.award_key!=="community_engagement" && n.award_key!=="youth_development" && n.award_key!=="fair_play"){
      if(n.nominee_club) sub.push(esc(n.nominee_club));
    }
    if(n.nominee_division) sub.push(esc(n.nominee_division));
    var star = w
      ? '<button class="nm-star'+(n.shortlisted?" on":"")+'" data-id="'+esc(n.id)+'" data-on="'+(n.shortlisted?"1":"0")+'">'+(n.shortlisted?"★ Shortlisted":"☆ Shortlist")+'</button>'
      : (n.shortlisted?'<span class="nm-star on">★ Shortlisted</span>':'');
    var del = w ? '<button class="nm-del" title="Remove this nomination" data-id="'+esc(n.id)+'">&times;</button>' : '';
    var contact = [esc(n.nominator_name||""), (n.nominator_role?("("+esc(n.nominator_role)+")"):"")].filter(Boolean).join(" ");
    return '<div class="nm-card'+(n.shortlisted?" sl":"")+'">'+
      '<div class="top"><div><div class="nee">'+esc(n.nominee_name||"")+'</div>'+(sub.length?'<div class="sub">'+sub.join(" &middot; ")+'</div>':'')+'</div>'+
        '<div class="act">'+star+del+'</div></div>'+
      '<div class="nm-mot">'+esc(n.motivation||"")+'</div>'+
      (n.evidence?'<div class="nm-ev"><b>Supporting:</b> '+linkify(n.evidence)+'</div>':'')+
      '<div class="nm-meta">Nominated by <b>'+esc(n.nominating_club||"")+'</b>'+(contact?(" &mdash; "+contact):"")+(n.nominator_email?(" &middot; "+esc(n.nominator_email)):"")+' &middot; '+fmtDate(n.created_at)+'</div>'+
    '</div>';
  }

  function shortlist(id,on){
    NS.sb.rpc("awards_nom_shortlist",{p_id:id,p_on:on}).then(function(r){
      if(r.error){ window.alert("Could not update: "+r.error.message); return; }
      var n=(DATA.noms||[]).filter(function(x){return x.id===id;})[0]; if(n) n.shortlisted=on;
      groups(canWrite());
    });
  }
  function del(id){
    if(!window.confirm("Remove this nomination? This cannot be undone.")) return;
    NS.sb.rpc("awards_nom_delete",{p_id:id}).then(function(r){
      if(r.error){ window.alert("Could not remove: "+r.error.message); return; }
      renderNoms();
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
    var blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="CTTLFA_Awards_"+EVENT+"_Nominations_"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  NS.renderNoms = renderNoms;
})(window.AC);
