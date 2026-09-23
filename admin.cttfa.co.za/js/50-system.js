/* CTTLFA admin - System Health module (T05). Closure over window.AC. */
(function(NS){
  "use strict";

  async function renderSysHealth(){
    var root=NS.$("sysHealthRoot"); if(!root) return;
    root.innerHTML='<div class="card"><p class="hint">Loading system health&hellip;</p></div>';
    var data={}, season=null;
    try{
      var pr=await Promise.all([
        NS.sb.rpc('sys_health'),
        fetch('https://www.cttfa.co.za/season.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
      ]);
      if(pr[0].error) throw pr[0].error;
      data=pr[0].data||{}; season=pr[1];
    }catch(e){
      root.innerHTML='<div class="card"><h3>System health</h3><p class="hint" style="color:#9A3130">Could not load system health: '+NS.esc(e.message||String(e))+'</p></div>';
      return;
    }
    root.innerHTML=sysHealthHtml(data, season);
    var rb=NS.$("shRefresh"); if(rb) rb.onclick=function(){ renderSysHealth(); };
    var cn=NS.$("shCheckNow"); if(cn) cn.onclick=function(){ shRunFn(cn,'shCheckMsg','check'); };
    var bn=NS.$("shBackupNow"); if(bn) bn.onclick=function(){ shRunFn(bn,'shBackupMsg','backup'); };
    var sn=NS.$("shSyncNow"); if(sn) sn.onclick=async function(){
      var m=NS.$("shSyncMsg"); sn.disabled=true; if(m) m.textContent='Syncing…';
      try{ var r=await NS.sb.rpc('portal_access_sync'); if(r.error) throw r.error; var d=r.data||{};
        if(m) m.textContent=(d.added?('Added '+d.added+' login'+(d.added===1?'':'s')):'Up to date'); setTimeout(renderSysHealth, 800);
      }catch(e){ if(m) m.textContent='Could not sync: '+(e.message||String(e)); sn.disabled=false; }
    };
  }
  function shDT(ts){ if(!ts) return '&mdash;'; try{ return new Date(ts).toLocaleString('en-ZA',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return NS.esc(String(ts)); } }
  function shDate(d){ if(!d) return '&mdash;'; try{ return new Date(d).toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return NS.esc(String(d)); } }
  function shAgo(ts){ if(!ts) return ''; var ms=Date.now()-new Date(ts).getTime(); if(isNaN(ms)) return ''; var h=ms/3.6e6; if(h<1) return Math.max(1,Math.round(h*60))+' min ago'; if(h<48) return (Math.round(h*10)/10)+' h ago'; return Math.round(h/24)+' days ago'; }
  function shPill(word,state){ var c={ok:['#E3F0E7','#1f7a4d'],warn:['#FBF1E2','#9F6621'],bad:['#FBECEB','#9A3130']}[state]||['#EFF4F7','#59666B']; return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:'+c[0]+';color:'+c[1]+'"><span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:'+c[1]+'"></span>'+NS.esc(word)+'</span>'; }
  function shTile(title,pill,rows,note){
    var kv=rows.map(function(r){ return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;border-bottom:1px solid #EFF1F5"><span style="color:#59666B">'+NS.esc(r[0])+'</span><b style="font-variant-numeric:tabular-nums;text-align:right">'+r[1]+'</b></div>'; }).join('');
    return '<div class="card" style="margin:0"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h3 style="margin:0;font-size:15px">'+NS.esc(title)+'</h3>'+pill+'</div>'+kv+(note?'<p class="hint" style="margin:8px 0 0">'+note+'</p>':'')+'</div>';
  }
  function shTileBtn(title,pill,rows,note,btnHtml){
    var kv=rows.map(function(r){ return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;border-bottom:1px solid #EFF1F5;align-items:center"><span style="color:#59666B">'+NS.esc(r[0])+'</span><b style="font-variant-numeric:tabular-nums;text-align:right">'+r[1]+'</b></div>'; }).join('');
    return '<div class="card" style="margin:0"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h3 style="margin:0;font-size:15px">'+NS.esc(title)+'</h3>'+pill+'</div>'+kv+(note?'<p class="hint" style="margin:8px 0 0">'+note+'</p>':'')+(btnHtml?'<div style="margin-top:10px">'+btnHtml+'</div>':'')+'</div>';
  }
  async function shRunFn(btn,msgId,what){
    var m=NS.$(msgId); btn.disabled=true; if(m) m.textContent=(what==='backup'?'Backing up…':'Checking…');
    try{ var r=await NS.sb.rpc('sys_run',{p_what:what}); if(r.error) throw r.error;
      if(m) m.textContent='Running… refreshing shortly'; setTimeout(renderSysHealth, 6000);
    }catch(e){ if(m) m.textContent='Could not start: '+(e.message||String(e)); btn.disabled=false; }
  }
  function sysHealthHtml(data,season){
    var A=data.agent||{}, D=data.debtors||{}, E=data.email||{}, C=data.correspondence||{}, W=data.watchdog||{};
    var agState=A.online?{w:'Online',c:'ok'}:{w:'Offline',c:'bad'};
    var agTile=shTile('Sage fetch agent',shPill(agState.w,agState.c),[
        ['Status',NS.esc(A.status||'unknown')],
        ['Agent heartbeat',A.heartbeat_min_ago!=null?(A.heartbeat_min_ago+' min ago'):'&mdash;'],
        ['Last fetch finished',shDT(A.last_finished_at)],
        ['Last result',NS.esc(A.last_result||'&mdash;')]
      ],A.online?'The office PC fetch agent is running.':'The office PC is not reporting in. Start it, run the CTTLFA Sage fetch agent, then press Fetch on Club Debtors.');
    // Club debtor data: separate three distinct things — the ledger tie (reconciled),
    // the balance currency (live to the fetch) and the ageing bucket date (Sage report
    // date, which can lag). The Club Debtors "In sync" badge uses the same tie.
    var dbLag=Number(D.ageing_lag_days||0), dbStale=dbLag>2;
    var dbState = !D.extracted_at ? {w:'No snapshot',c:'bad'}
                : (!D.reconciled ? {w:(D.out_of_sync||0)+' out of sync',c:'warn'}
                : (dbStale ? {w:'Ageing '+dbLag+'d old',c:'warn'} : {w:'Reconciled',c:'ok'}));
    var dbNote;
    if(!D.extracted_at){ dbNote='No debtor snapshot yet. Run Fetch from Sage on Club Debtors.'; }
    else if(!D.reconciled){ dbNote='The itemised ledger does not tie to the ageing for '+(D.out_of_sync||0)+' club'+((D.out_of_sync||0)===1?'':'s')+'. Run a fresh fetch before sending statements.'; }
    else if(dbStale){ dbNote='Net debtors ('+(D.net_total!=null?NS.dR(D.net_total):'&mdash;')+') are current to the last fetch and all '+(D.n_clubs||0)+' clubs tie to the ledger. The ageing buckets are dated '+shDate(D.as_at)+' because Sage&rsquo;s aged-balances report carries that date; set the report date to today in Sage to date the ageing to today.'; }
    else { dbNote='All '+(D.n_clubs||0)+' clubs tie to the Sage ledger.'+(D.recon_note?' '+NS.esc(D.recon_note):''); }
    var dbTile=shTile('Club debtor data',shPill(dbState.w,dbState.c),[
        ['Balances (net)',D.net_total!=null?NS.dR(D.net_total):'&mdash;'],
        ['Current to',shDT(D.extracted_at)+(D.extracted_at?(' ('+shAgo(D.extracted_at)+')'):'')],
        ['Ageing dated',shDate(D.as_at)+(dbStale?(' &middot; '+dbLag+'d back'):'')],
        ['Clubs / owing',(D.n_clubs!=null?D.n_clubs:'&mdash;')+' / '+(D.n_owing!=null?D.n_owing:'&mdash;')],
        ['Ledger tie',D.reconciled?('all '+(D.n_clubs||0)+' in sync'):((D.out_of_sync||0)+' out of sync')]
      ],dbNote+' Per-club status is on the &ldquo;In sync with Sage&rdquo; badge on Club Debtors.');
    var emFailed=Number(E.failed||0);
    var emTile=shTile('Email delivery (30 days)',shPill(emFailed>0?(emFailed+' failed'):'None failed',emFailed>0?'warn':'ok'),[
        ['Sent',(E.total!=null?E.total:0)],
        ['Live / test',(E.live!=null?E.live:0)+' / '+(E.test!=null?E.test:0)],
        ['Failed / bounced',emFailed],
        ['Last sent',shDT(E.last_sent_at)]
      ],emFailed>0?'Some emails failed or bounced. Check the club contact address on the Correspondence log and re-send that one.':'No send failures or bounces recorded by Resend in the last 30 days. This tracks acceptance and bounces, not whether the recipient opened it.');
    // Correspondence: "awaiting" counts only items that genuinely need a decision or send —
    // it excludes superseded drafts (auto-replaced by a newer statement), the same rule the
    // home action queue uses. Superseded are shown separately so the number is explained.
    var coAw=Number(C.awaiting||0), coF=Number(C.failed||0), coSup=Number(C.superseded||0);
    var coState=coF>0?{w:coF+' failed',c:'bad'}:(coAw>0?{w:coAw+' awaiting',c:'warn'}:{w:'Clear',c:'ok'});
    var coRows=[
        ['Last run',shDT(C.last_run_at)],
        ['Awaiting decision or send',coAw],
        ['Failed',coF]
      ];
    if(coSup>0) coRows.push(['Superseded (auto-replaced)',coSup]);
    var coTile=shTile('Correspondence queue',shPill(coState.w,coState.c),coRows,
      coAw>0?'Items are waiting in the correspondence queue on Club Debtors.'
            :('Nothing is awaiting a decision or send.'+(coSup>0?(' '+coSup+' earlier draft'+(coSup===1?'':'s')+' were superseded by newer statements and need no action.'):'')));
    var upd=season&&season.updated;
    var fxAgeH=upd?(Date.now()-new Date(upd).getTime())/3.6e6:null;
    var fxState=(upd==null)?{w:'Not reachable',c:'warn'}:(fxAgeH>12?{w:'Ageing',c:'warn'}:{w:'Fresh',c:'ok'});
    var fxTile=shTile('League & fixtures feed',shPill(fxState.w,fxState.c),[
        ['Feed updated',upd?(shDT(upd)+' ('+shAgo(upd)+')'):'could not load season.json'],
        ['Season',(season&&season.label)?NS.esc(season.label):'&mdash;']
      ],(upd==null)?'Could not read season.json, so feed freshness cannot be confirmed. Check the LeagueRepublic refresh in Website Admin.':(fxAgeH>12?'The public league feed has not refreshed in over 12 hours; run the LeagueRepublic refresh in Website Admin.':'The public league and fixtures feed is current.'));
    var wdTile=shTile('Receipts watchdog',shPill(W.alert_active?'Alert':'Normal',W.alert_active?'warn':'ok'),[
        ['Last receipt',shDate(W.last_receipt_date)],
        ['Receipt age',W.receipt_age_days!=null?(W.receipt_age_days+' days'):'&mdash;'],
        ['Checked',shDT(W.last_checked_at)]
      ],(W.alert_active?('Watchdog alert: '+NS.esc(W.alert_kind||'see Club Debtors')+'. '):'No receipts-processing alert. ')+'This reads the itemised ledger, which is rebuilt from the periodic Sage catch-up and can lag the live balances, so the last receipt may be older than a receipt already posted in Sage.');
    // ----- operations: monitoring, backups, access sync -----
    var P=data.platform||{}, B=data.backup||{}, X=data.access||{};
    var role=(NS.session?NS.session().role:null), canRun=(role==='administrator'||role==='staff');
    var pChecks=P.checks||[];
    var pRows=pChecks.length?pChecks.map(function(c){ return [c.name, c.ok?shPill('OK','ok'):shPill(NS.esc(c.detail||'fail'),'bad')]; }):[['Status','not yet run']];
    var pState=P.ok?{w:'All healthy',c:'ok'}:((P.consecutive_fails||0)>=2?{w:'Service down',c:'bad'}:{w:'Checking',c:'warn'});
    var platTile=shTileBtn('Platform monitor',shPill(pState.w,pState.c),pRows,
      'Checked '+shDT(P.last_checked_at)+(P.last_checked_at?(' ('+shAgo(P.last_checked_at)+')'):'')+'. Runs every 30 minutes; emails the Treasurer and Justin Asher on a sustained fault, and again on recovery.',
      canRun?'<button class="btn ghost sm" id="shCheckNow" type="button">Check now</button> <span class="hint" id="shCheckMsg" style="font-size:11.5px"></span>':'');
    var bAgeH=B.last_at?((Date.now()-new Date(B.last_at).getTime())/3.6e6):null;
    var bState=B.last_at?(bAgeH>36?{w:'Ageing',c:'warn'}:{w:'Current',c:'ok'}):{w:'None yet',c:'bad'};
    var bkTile=shTileBtn('Backups',shPill(bState.w,bState.c),[
        ['Last backup',shDT(B.last_at)+(B.last_at?(' ('+shAgo(B.last_at)+')'):'')],
        ['Size',B.last_bytes!=null?(Math.round(B.last_bytes/1024)+' KB'):'&mdash;'],
        ['Snapshots kept',(B.count!=null?B.count:'&mdash;')]
      ],'Daily snapshot of the config, mapping and governance tables to a private store, 30-day retention. The Sage ledger rebuilds from Sage on restore.',
      canRun?'<button class="btn ghost sm" id="shBackupNow" type="button">Back up now</button> <span class="hint" id="shBackupMsg" style="font-size:11.5px"></span>':'');
    var xMiss=X.members_without_login;
    var xState=(xMiss==null)?{w:'Unknown',c:'warn'}:(xMiss>0?{w:xMiss+' without a login',c:'warn'}:{w:'All covered',c:'ok'});
    var acTile=shTileBtn('Portal access',shPill(xState.w,xState.c),[
        ['Active logins',(X.active!=null?X.active:'&mdash;')],
        ['From Sage / manual',(X.sage!=null?X.sage:0)+' / '+(X.manual!=null?X.manual:0)],
        ['Members without a login',(xMiss!=null?xMiss:'&mdash;')],
        ['Last synced',shDT(X.last_synced_at)]
      ],'All 43 full and 7 associate clubs must have a login. Sync adds Sage contacts and never removes hand-added people.',
      canRun?'<button class="btn ghost sm" id="shSyncNow" type="button">Sync from Sage</button> <span class="hint" id="shSyncMsg" style="font-size:11.5px"></span>':'');
    var h='';
    h+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">System health</h3><p class="hint" style="margin:2px 0 0">Live status of the feeds and services behind the Admin Centre. Read-only. Snapshot taken '+shDT(data.generated_at)+'.</p></div><button class="btn ghost sm" id="shRefresh">Refresh</button></div></div>';
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px">'+agTile+dbTile+emTile+coTile+fxTile+wdTile+'</div>';
    h+='<div class="card" style="margin-top:12px;margin-bottom:0"><h3 style="margin:0">Automated jobs, monitoring &amp; backups</h3><p class="hint" style="margin:2px 0 0">The scheduled safeguards behind the platform: a 30-minute uptime monitor, a daily backup and a daily Sage access sync. You can run each on demand.</p></div>';
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px">'+platTile+bkTile+acTile+'</div>';
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
      +'<tr><td><b>Websites &amp; portals</b><br><span class="hint">admin / club / vote</span></td><td>Treasurer</td><td>Hosted on Xneelo; GitHub Actions deploys by FTP from the cttlfa-website repository on each push to main. A bad change is undone by reverting the last commit and pushing; the deploy runs on its own.</td></tr>'
      +'<tr><td><b>Database</b><br><span class="hint">Supabase &mdash; all data</span></td><td>Treasurer</td><td>Supabase project cttlfa-voting. Backups are retained by Supabase; access is by invitation only.</td></tr>'
      +'</tbody></table></div>'
      +'<p class="hint" style="margin:10px 0 0">Escalation: the Treasurer holds the master access. Keep this list current as owners change.</p></div>';
  }
  NS.renderSysHealth = renderSysHealth;
})(window.AC);
