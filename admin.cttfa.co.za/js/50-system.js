/* CTTLFA admin - System Health module (T05). Closure over window.AC. */
(function(A){
  "use strict";

  async function renderSysHealth(){
    var root=A.$("sysHealthRoot"); if(!root) return;
    root.innerHTML='<div class="card"><p class="hint">Loading system health&hellip;</p></div>';
    var data={}, season=null;
    try{
      var pr=await Promise.all([
        A.sb.rpc('sys_health'),
        fetch('https://www.cttfa.co.za/season.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
      ]);
      if(pr[0].error) throw pr[0].error;
      data=pr[0].data||{}; season=pr[1];
    }catch(e){
      root.innerHTML='<div class="card"><h3>System health</h3><p class="hint" style="color:#9A3130">Could not load system health: '+A.esc(e.message||String(e))+'</p></div>';
      return;
    }
    root.innerHTML=sysHealthHtml(data, season);
    var rb=A.$("shRefresh"); if(rb) rb.onclick=function(){ renderSysHealth(); };
  }
  function shDT(ts){ if(!ts) return '&mdash;'; try{ return new Date(ts).toLocaleString('en-ZA',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return A.esc(String(ts)); } }
  function shDate(d){ if(!d) return '&mdash;'; try{ return new Date(d).toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return A.esc(String(d)); } }
  function shAgo(ts){ if(!ts) return ''; var ms=Date.now()-new Date(ts).getTime(); if(isNaN(ms)) return ''; var h=ms/3.6e6; if(h<1) return Math.max(1,Math.round(h*60))+' min ago'; if(h<48) return (Math.round(h*10)/10)+' h ago'; return Math.round(h/24)+' days ago'; }
  function shPill(word,state){ var c={ok:['#E3F0E7','#1f7a4d'],warn:['#FBF1E2','#9F6621'],bad:['#FBECEB','#9A3130']}[state]||['#EFF4F7','#59666B']; return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:'+c[0]+';color:'+c[1]+'"><span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:'+c[1]+'"></span>'+A.esc(word)+'</span>'; }
  function shTile(title,pill,rows,note){
    var kv=rows.map(function(r){ return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;border-bottom:1px solid #EFF1F5"><span style="color:#59666B">'+A.esc(r[0])+'</span><b style="font-variant-numeric:tabular-nums;text-align:right">'+r[1]+'</b></div>'; }).join('');
    return '<div class="card" style="margin:0"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h3 style="margin:0;font-size:15px">'+A.esc(title)+'</h3>'+pill+'</div>'+kv+(note?'<p class="hint" style="margin:8px 0 0">'+note+'</p>':'')+'</div>';
  }
  function sysHealthHtml(data,season){
    var A=data.agent||{}, D=data.debtors||{}, E=data.email||{}, C=data.correspondence||{}, W=data.watchdog||{};
    var agState=A.online?{w:'Online',c:'ok'}:{w:'Offline',c:'bad'};
    var agTile=shTile('Sage fetch agent',shPill(agState.w,agState.c),[
        ['Status',A.esc(A.status||'unknown')],
        ['Agent heartbeat',A.heartbeat_min_ago!=null?(A.heartbeat_min_ago+' min ago'):'&mdash;'],
        ['Last fetch finished',shDT(A.last_finished_at)],
        ['Last result',A.esc(A.last_result||'&mdash;')]
      ],A.online?'The office PC fetch agent is running.':'The office PC is not reporting in. Start it, run the CTTLFA Sage fetch agent, then press Fetch on Club Debtors.');
    var dbState=D.extracted_at?(D.reconciled?{w:'Reconciled',c:'ok'}:{w:'Not reconciled',c:'warn'}):{w:'No snapshot',c:'bad'};
    var dbTile=shTile('Club debtor data',shPill(dbState.w,dbState.c),[
        ['As at',shDate(D.as_at)],
        ['Fetched',shDT(D.extracted_at)+(D.extracted_at?(' ('+shAgo(D.extracted_at)+')'):'')],
        ['Clubs / owing',(D.n_clubs!=null?D.n_clubs:'&mdash;')+' / '+(D.n_owing!=null?D.n_owing:'&mdash;')],
        ['Net debtors',D.net_total!=null?A.dR(D.net_total):'&mdash;']
      ],D.reconciled?'The itemised ledger reconciles to the ageing.':'The ledger does not currently tie to the ageing; a fresh fetch is recommended before sending statements.');
    var emFailed=Number(E.failed||0);
    var emTile=shTile('Email delivery (30 days)',shPill(emFailed>0?(emFailed+' failed'):'All delivered',emFailed>0?'warn':'ok'),[
        ['Sent',(E.total!=null?E.total:0)],
        ['Live / test',(E.live!=null?E.live:0)+' / '+(E.test!=null?E.test:0)],
        ['Failed / bounced',emFailed],
        ['Last sent',shDT(E.last_sent_at)]
      ],emFailed>0?'Some emails did not deliver. Check the club contact address on the Correspondence log and re-send that one.':'No delivery failures recorded in the last 30 days.');
    var coAw=Number(C.awaiting||0), coF=Number(C.failed||0);
    var coState=coF>0?{w:coF+' failed',c:'bad'}:(coAw>0?{w:coAw+' awaiting',c:'warn'}:{w:'Clear',c:'ok'});
    var coTile=shTile('Correspondence queue',shPill(coState.w,coState.c),[
        ['Last run',shDT(C.last_run_at)],
        ['Awaiting decision or send',coAw],
        ['Failed',coF]
      ],coAw>0?'Items are waiting in the correspondence queue on Club Debtors.':'Nothing is waiting in the correspondence queue.');
    var upd=season&&season.updated;
    var fxAgeH=upd?(Date.now()-new Date(upd).getTime())/3.6e6:null;
    var fxState=(upd==null)?{w:'Not reachable',c:'warn'}:(fxAgeH>12?{w:'Ageing',c:'warn'}:{w:'Fresh',c:'ok'});
    var fxTile=shTile('League &amp; fixtures feed',shPill(fxState.w,fxState.c),[
        ['Feed updated',upd?(shDT(upd)+' ('+shAgo(upd)+')'):'could not load season.json'],
        ['Season',(season&&season.label)?A.esc(season.label):'&mdash;']
      ],(upd&&fxAgeH>12)?'The public league feed has not refreshed in over 12 hours; run the LeagueRepublic refresh in Website Admin.':'The public league and fixtures feed is current.');
    var wdTile=shTile('Receipts watchdog',shPill(W.alert_active?'Alert':'Normal',W.alert_active?'warn':'ok'),[
        ['Last receipt',shDate(W.last_receipt_date)],
        ['Receipt age',W.receipt_age_days!=null?(W.receipt_age_days+' days'):'&mdash;'],
        ['Checked',shDT(W.last_checked_at)]
      ],W.alert_active?('Watchdog alert: '+A.esc(W.alert_kind||'see Club Debtors')):'No receipts-processing alert.');
    var h='';
    h+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">System health</h3><p class="hint" style="margin:2px 0 0">Live status of the feeds and services behind the Admin Centre. Read-only. Snapshot taken '+shDT(data.generated_at)+'.</p></div><button class="btn ghost sm" id="shRefresh">Refresh</button></div></div>';
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px">'+agTile+dbTile+emTile+coTile+fxTile+wdTile+'</div>';
    h+=sysRunbookHtml();
    return h;
  }
  function sysRunbookHtml(){
    return '<div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">If something stops &mdash; who and what</h3>'
      +'<p class="hint" style="margin:0 0 10px">A short runbook so any authorised officer can act without waiting on one person. Nothing here changes data.</p>'
      +'<div style="overflow-x:auto"><table class="deb-table" style="min-width:560px"><thead><tr><th>Service</th><th>Owner / backup</th><th>If it is down</th></tr></thead><tbody>'
      +'<tr><td><b>Sage fetch agent</b><br><span class="hint">Pulls club balances from Sage</span></td><td>Treasurer<br><span class="hint">backup: office secretary</span></td><td>Start the office PC and run the CTTLFA Sage fetch agent. If it asks to sign in, sign in once, then press <b>Fetch from Sage</b> on Club Debtors.</td></tr>'
      +'<tr><td><b>Club debtor emails</b><br><span class="hint">Statements &amp; reminders</span></td><td>Treasurer</td><td>Delivery runs through Resend. If an email fails, correct the club contact address on the Correspondence log and re-send that one; do not resend a whole batch.</td></tr>'
      +'<tr><td><b>League &amp; fixtures feed</b><br><span class="hint">season.json from LeagueRepublic</span></td><td>Treasurer</td><td>The feed refreshes on a schedule. If it is hours stale, run the LeagueRepublic refresh in Website Admin, then reload.</td></tr>'
      +'<tr><td><b>Websites &amp; portals</b><br><span class="hint">admin / club / vote</span></td><td>Treasurer</td><td>Hosted on Netlify from the cttlfa-website repository. A bad change is undone by reverting the last commit; the site redeploys on its own.</td></tr>'
      +'<tr><td><b>Database</b><br><span class="hint">Supabase &mdash; all data</span></td><td>Treasurer</td><td>Supabase project cttlfa-voting. Backups are retained by Supabase; access is by invitation only.</td></tr>'
      +'</tbody></table></div>'
      +'<p class="hint" style="margin:10px 0 0">Escalation: the Treasurer holds the master access. Keep this list current as owners change.</p></div>';
  }
  A.renderSysHealth = renderSysHealth;
})(window.AC);
