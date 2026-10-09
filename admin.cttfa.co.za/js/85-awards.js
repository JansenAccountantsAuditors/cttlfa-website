/* CTTLFA admin - Awards Evening RSVP tracker (events). Closure over window.AC.
   Reads awards_rsvp_list; office controls open/close, removes a stray reply, and
   after the closing date confirms additional tickets (first come, first served)
   and emails the club. All data access via admin-gated RPCs / edge functions. */
(function(NS){
  "use strict";
  var EVENT = "2026";
  var DATA = null, FILTER = "";

  function esc(s){ return NS.esc ? NS.esc(s==null?"":String(s)) : String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  function canWrite(){ try{ return !!(NS.canEdit && NS.canEdit("awards")); }catch(e){ return false; } }
  function grp(x){ return String(Math.round(Number(x)||0)).replace(/\B(?=(\d{3})+(?!\d))/g," "); }
  function fmtDate(iso){ if(!iso) return ""; try{var d=new Date(iso);return d.toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})+" "+d.toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit"});}catch(e){return iso;} }
  function fmtDay(ymd){ if(!ymd) return "—"; try{var p=String(ymd).split("-");var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));return d.toLocaleDateString("en-ZA",{weekday:"long",day:"numeric",month:"long",year:"numeric"});}catch(e){return ymd;} }

  function injectStyle(){
    if(document.getElementById("aw-style")) return;
    var css = ""+
      "#awardsRoot .aw-evt{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;margin:2px 0 14px;font-size:13px;color:#59666b}"+
      "#awardsRoot .aw-evt b{color:#212d33}"+
      "#awardsRoot .aw-pill{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:12px;padding:3px 10px;border-radius:999px}"+
      "#awardsRoot .aw-pill.open{background:#e3f0e8;color:#296944;border:1px solid #bcd8c7}"+
      "#awardsRoot .aw-pill.closed{background:#f6e4e2;color:#9a3130;border:1px solid #e3b9b4}"+
      "#awardsRoot .aw-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:0 0 14px}"+
      "#awardsRoot .aw-tile{background:#fff;border:1px solid #d3dbde;border-radius:12px;padding:14px 10px;text-align:center}"+
      "#awardsRoot .aw-tile .n{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums;color:#184050;line-height:1}"+
      "#awardsRoot .aw-tile .l{font-size:12px;color:#59666b;margin-top:6px}"+
      "#awardsRoot .aw-tile.ppl .n{color:#9a7213}"+
      "#awardsRoot .aw-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px}"+
      "#awardsRoot .aw-bar .sp{flex:1}"+
      "#awardsRoot .aw-search{font:inherit;padding:8px 11px;border:1px solid #d3dbde;border-radius:8px;min-width:200px}"+
      "#awardsRoot .aw-out{background:#fff;border:1px solid #d3dbde;border-radius:12px;padding:12px 14px;margin:0 0 14px}"+
      "#awardsRoot .aw-out h4{margin:0 0 8px;font-size:14px;color:#184050}"+
      "#awardsRoot .aw-out.none{color:#296944}"+
      "#awardsRoot .aw-chips{display:flex;flex-wrap:wrap;gap:6px}"+
      "#awardsRoot .aw-chip{font-size:12.5px;background:#f2ede1;border:1px solid #e0d4ba;color:#5b4a22;border-radius:999px;padding:3px 10px}"+
      "#awardsRoot .aw-tw{background:#fff;border:1px solid #d3dbde;border-radius:12px;overflow:auto}"+
      "#awardsRoot table.aw{border-collapse:collapse;width:100%;font-size:13px}"+
      "#awardsRoot table.aw caption{text-align:left;padding:10px 12px;font-weight:700;color:#184050;border-bottom:1px solid #e7ecee}"+
      "#awardsRoot table.aw th,#awardsRoot table.aw td{text-align:left;padding:8px 11px;border-bottom:1px solid #eef2f3;vertical-align:top}"+
      "#awardsRoot table.aw th{background:#184050;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;position:sticky;top:0}"+
      "#awardsRoot table.aw tbody tr:nth-child(even){background:#f7fafb}"+
      "#awardsRoot table.aw td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}"+
      "#awardsRoot .aw-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}"+
      "#awardsRoot .aw-tag.club{background:#e7eef2;color:#1b4a5e}"+
      "#awardsRoot .aw-tag.mancom{background:#efe7f2;color:#5a2b6b}"+
      "#awardsRoot .aw-tag.decl{background:#f6e4e2;color:#9a3130}"+
      "#awardsRoot .aw-names{white-space:pre-line;font-size:12px;color:#59666b;max-width:180px}"+
      "#awardsRoot .aw-del{background:none;border:0;color:#9a3130;cursor:pointer;font-size:15px;padding:2px 6px;border-radius:6px}"+
      "#awardsRoot .aw-feeok{color:#296944;font-weight:700}"+
      "#awardsRoot .aw-cinp{width:44px;font:inherit;padding:4px 6px;border:1px solid #b9ac95;border-radius:6px;text-align:center}"+
      "#awardsRoot .aw-cbtn{font:inherit;font-size:12px;font-weight:600;cursor:pointer;background:#184050;color:#fff;border:0;border-radius:6px;padding:5px 9px;margin-left:4px}"+
      "#awardsRoot .aw-sent{font-size:11px;color:#296944;margin-top:3px}"+
      "#awardsRoot .aw-msg{padding:14px;color:#59666b}";
    var s=document.createElement("style"); s.id="aw-style"; s.textContent=css; document.head.appendChild(s);
  }

  function renderAwards(){
    var root = NS.$("awardsRoot"); if(!root) return;
    if(NS.canSee && !NS.canSee("awards")){
      root.innerHTML='<div class="card"><h3>Awards RSVPs</h3><p class="hint">This area is restricted. Ask an administrator for access.</p></div>';
      return;
    }
    injectStyle();
    root.innerHTML='<div class="card"><p class="hint">Loading Awards RSVPs&hellip;</p></div>';
    NS.sb.rpc("awards_rsvp_list",{p_event:EVENT}).then(function(r){
      if(r.error){
        var m=(r.error.message||"");
        root.innerHTML='<div class="card"><h3>Awards RSVPs</h3><p class="hint">'+(m.indexOf("not authorised")>-1?"This area is restricted. Ask an administrator for access.":"Could not load replies: "+esc(m))+'</p></div>';
        return;
      }
      DATA=r.data; paint(root);
    });
  }

  function paint(root){
    if(!DATA) return;
    var e=DATA.event||{}, sm=DATA.summary||{}, out=DATA.outstanding||[], total=DATA.clubs_total||0;
    var open = e.rsvp_open !== false;
    var w = canWrite();
    var incl = Number(e.included_tickets)||2;

    var exReq=0, exConf=0;
    (DATA.replies||[]).forEach(function(r){ if(r.reply_type==="club"){ exReq+=Number(r.extra_requested)||0; if(r.extra_confirmed!=null) exConf+=Number(r.extra_confirmed)||0; } });

    var h = '';
    h += '<div class="card">';
    h += '<h3 style="margin:0 0 2px">Awards Evening &mdash; RSVP tracker</h3>';
    h += '<div class="aw-evt">'+
      '<span><b>'+esc(e.title||("Awards Evening "+EVENT))+'</b></span>'+
      '<span>Event: <b>'+fmtDay(e.event_date)+'</b></span>'+
      '<span>Deadline: <b>'+fmtDay(e.deadline)+'</b></span>'+
      '<span>Tickets: <b>'+incl+' included per club</b></span>'+
      '<span class="aw-pill '+(open?"open":"closed")+'">'+(open?"● RSVPs open":"● RSVPs closed")+'</span>'+
      '</div>';

    var tiles=[
      ["Clubs replied",(sm.clubs_replied||0)+" / "+total,""],
      ["Clubs attending",sm.clubs_attending||0,""],
      ["Clubs declined",sm.clubs_declined||0,""],
      ["Total attending",sm.total_people||0,"ppl"],
      ["Extra requested",exReq,"ppl"],
      ["Extra confirmed",exConf,"ppl"],
      ["Mancom guests",sm.mancom_people||0,"ppl"]
    ];
    h += '<div class="aw-tiles">'+tiles.map(function(t){ return '<div class="aw-tile'+(t[2]==="ppl"?" ppl":"")+'"><div class="n">'+esc(t[1])+'</div><div class="l">'+esc(t[0])+'</div></div>'; }).join("")+'</div>';

    h += '<div class="aw-bar">'+
      '<input class="aw-search" id="awSearch" type="search" placeholder="Search club, name, mobile…" aria-label="Search replies" value="'+esc(FILTER)+'">'+
      '<span class="sp"></span>'+
      '<button class="btn ghost sm" id="awRefresh" type="button">Refresh</button>'+
      '<button class="btn ghost sm" id="awCsv" type="button">Export CSV</button>'+
      (w?'<button class="btn sm" id="awToggle" type="button">'+(open?"Close RSVPs":"Re-open RSVPs")+'</button>':'')+
      '</div>';

    if(w && exReq>0){
      h += '<p class="hint" style="margin:-4px 0 12px;font-size:12px">Additional tickets (over the '+incl+' included) are first come, first served. After the closing date, set how many extras each club has secured and press <b>Send</b> to confirm it to them by email.</p>';
    }

    if(out.length===0){
      h += '<div class="aw-out none"><h4>Outstanding clubs</h4>All member clubs have replied.</div>';
    }else{
      h += '<div class="aw-out"><h4>Outstanding clubs &mdash; '+out.length+' still to reply</h4><div class="aw-chips">'+out.map(function(c){return '<span class="aw-chip">'+esc(c)+'</span>';}).join("")+'</div></div>';
    }

    h += '<div class="aw-tw"><table class="aw"><caption id="awCap">Replies</caption>'+
      '<thead><tr><th>When</th><th>Type</th><th>Club / Guest</th><th>Role / Cap.</th><th>Contact</th><th>Mobile</th><th>Email</th><th>#</th><th>Extra</th><th>Confirm</th><th>Names</th><th>Dietary</th>'+(w?'<th></th>':'')+'</tr></thead>'+
      '<tbody id="awRows"></tbody></table></div>';

    h += '</div>';
    root.innerHTML = h;

    NS.$("awSearch").addEventListener("input", function(){ FILTER=this.value; rows(w); });
    NS.$("awRefresh").addEventListener("click", renderAwards);
    NS.$("awCsv").addEventListener("click", exportCsv);
    if(w){ NS.$("awToggle").addEventListener("click", function(){ toggleOpen(open); }); }
    rows(w);
  }

  function rows(w){
    var tb=NS.$("awRows"); if(!tb) return;
    var ncols = w?13:12;
    var reps=(DATA.replies||[]).slice();
    var f=FILTER.toLowerCase();
    if(f){ reps=reps.filter(function(r){ return [r.club_name,r.contact_name,r.contact_mobile,r.contact_email,r.guest_capacity,r.club_role].join(" ").toLowerCase().indexOf(f)>-1; }); }
    var cap=NS.$("awCap"); if(cap) cap.textContent="Replies ("+reps.length+")";
    if(reps.length===0){ tb.innerHTML='<tr><td colspan="'+ncols+'" class="aw-msg">No replies yet.</td></tr>'; return; }
    tb.innerHTML = reps.map(function(r){
      var tag = r.reply_type==="mancom" ? '<span class="aw-tag mancom">Mancom</span>'
        : (r.num_attending===0 ? '<span class="aw-tag decl">Declined</span>' : '<span class="aw-tag club">Club</span>');
      var who = r.reply_type==="mancom" ? "—" : esc(r.club_name);
      var capv = r.reply_type==="mancom" ? esc(r.guest_capacity||"") : esc(r.club_role||"");
      // Extra requested cell
      var exReq = Number(r.extra_requested)||0;
      var extraCell = (r.reply_type!=="club" || exReq===0) ? "—" : String(exReq);
      // Confirm cell
      var confCell = "—";
      if(r.reply_type==="club" && exReq>0){
        var cur = (r.extra_confirmed!=null) ? r.extra_confirmed : exReq;
        if(w){
          confCell = '<input class="aw-cinp" type="number" min="0" max="'+exReq+'" value="'+cur+'" data-cid="'+esc(r.id)+'">'+
                     '<button class="aw-cbtn" data-cid="'+esc(r.id)+'">Send</button>'+
                     (r.extras_email_sent_at?'<div class="aw-sent">confirmed '+(r.extra_confirmed!=null?r.extra_confirmed:0)+' &bull; '+fmtDate(r.extras_email_sent_at)+'</div>':'');
        }else{
          confCell = (r.extra_confirmed!=null?r.extra_confirmed:"—");
        }
      }
      return '<tr>'+
        '<td>'+fmtDate(r.created_at)+'</td>'+
        '<td>'+tag+'</td>'+
        '<td>'+who+'</td>'+
        '<td>'+capv+'</td>'+
        '<td>'+esc(r.contact_name)+'</td>'+
        '<td>'+esc(r.contact_mobile)+'</td>'+
        '<td>'+esc(r.contact_email||"")+'</td>'+
        '<td class="num">'+(r.num_attending||0)+'</td>'+
        '<td class="num">'+extraCell+'</td>'+
        '<td>'+confCell+'</td>'+
        '<td class="aw-names">'+esc(r.attendee_names||"")+'</td>'+
        '<td>'+esc(r.dietary||"")+'</td>'+
        (w?'<td><button class="aw-del" title="Remove this reply" data-id="'+esc(r.id)+'">&times;</button></td>':'')+
      '</tr>';
    }).join("");
    if(w){
      Array.prototype.forEach.call(tb.querySelectorAll(".aw-del"), function(b){ b.addEventListener("click", function(){ delReply(b.getAttribute("data-id")); }); });
      Array.prototype.forEach.call(tb.querySelectorAll(".aw-cbtn"), function(b){
        b.addEventListener("click", function(){
          var id=b.getAttribute("data-cid");
          var inp=tb.querySelector('.aw-cinp[data-cid="'+id+'"]');
          var val=inp?parseInt(inp.value,10):0; if(isNaN(val)||val<0) val=0;
          confirmExtras(id, val);
        });
      });
    }
  }

  function toggleOpen(open){
    if(!window.confirm(open ? "Close RSVPs? Clubs will no longer be able to reply." : "Re-open RSVPs so clubs can reply again?")) return;
    NS.sb.rpc("awards_set_open",{p_event:EVENT,p_open:!open}).then(function(r){
      if(r.error){ window.alert("Could not update: "+r.error.message); return; }
      renderAwards();
    });
  }
  function delReply(id){
    if(!window.confirm("Remove this reply? This cannot be undone.")) return;
    NS.sb.rpc("awards_delete_reply",{p_id:id}).then(function(r){
      if(r.error){ window.alert("Could not remove: "+r.error.message); return; }
      renderAwards();
    });
  }
  function confirmExtras(id, confirmed){
    if(!window.confirm("Confirm "+confirmed+" additional ticket(s) for this club and email them?")) return;
    NS.sb.functions.invoke("awards-extras-confirm",{body:{id:id,confirmed:confirmed}}).then(function(res){
      if(res.error){ window.alert("Could not send: "+res.error.message); return; }
      var d=res.data;
      if(d && d.ok){ window.alert(d.emailed ? ("Confirmation sent ("+d.extra_confirmed+" additional ticket(s)).") : ("Recorded "+d.extra_confirmed+" additional ticket(s). No email on file for this club.")); renderAwards(); }
      else { window.alert("Could not send"+(d&&d.error?": "+d.error:".")); }
    });
  }
  function exportCsv(){
    var reps=(DATA&&DATA.replies)||[];
    var cols=["reply_type","club_name","club_role","guest_capacity","contact_name","contact_mobile","contact_email","num_attending","extra_requested","extra_confirmed","attendee_names","dietary","created_at"];
    var head=["Type","Club","Role","Capacity","Contact name","Mobile","Email","Attending","Extra requested","Extra confirmed","Attendee names","Dietary","Submitted"];
    function q(v){ v=(v==null?"":String(v)).replace(/"/g,'""'); return '"'+v+'"'; }
    var lines=[head.map(q).join(",")];
    reps.forEach(function(r){ lines.push(cols.map(function(c){ return q(r[c]); }).join(",")); });
    var blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="CTTLFA_Awards_"+EVENT+"_RSVPs_"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  NS.renderAwards = renderAwards;
})(window.AC);
