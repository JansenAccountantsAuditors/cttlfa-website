/* CTTLFA admin - Website Statistics module (T05). Closure over window.AC. */
(function(NS){
  "use strict";
  /* ---------- website analytics (embedded Looker Studio on GA4) ---------- */
  /* Paste the Looker Studio EMBED url here once the report is shared with embedding on.
     It looks like: https://lookerstudio.google.com/embed/reporting/<id>/page/<id> */
  var LOOKER_URL="https://lookerstudio.google.com/embed/reporting/c52a3e7d-34a9-4578-991a-ec762f572f62/page/TlJ0C";
  function renderWebstats(){
    var root=NS.$("webstatsRoot"); if(!root) return;
    if(!NS.canSee("webstats")){ root.innerHTML='<div class="card"><h3>Website Analytics</h3><p class="hint">This area is restricted.</p></div>'; return; }
    if(!LOOKER_URL){
      root.innerHTML='<div class="card"><h3>Website Analytics &mdash; not connected yet</h3>'+
        '<p class="hint">This shows the live Google Analytics for <b>www.cttfa.co.za</b> once a Looker Studio dashboard is linked. One-time setup, about ten minutes:</p>'+
        '<ol class="steps">'+
        '<li>Sign in to <span class="kk">lookerstudio.google.com</span> with the Google account that can see the site&rsquo;s Analytics.</li>'+
        '<li><b>Create &rarr; Report</b>, add data, choose <b>Google Analytics</b>, and pick the <b>Cape Town Tygerberg LFA</b> property (a402827176 / p547720506). A blank report auto-builds a sensible default.</li>'+
        '<li>Make sure there is a <b>Date range control</b> on the page (add one if not), plus the tiles you want: users, sessions, channels, top pages, countries, events.</li>'+
        '<li><b>Share &rarr; Manage access &rarr; turn on &ldquo;Enable embedding&rdquo;</b>, then <b>Share &rarr; Embed report</b> and copy the URL (it starts with <span class="kk">https://lookerstudio.google.com/embed/reporting/</span>).</li>'+
        '<li>Send that embed URL to the Treasurer / to this project and it is dropped in here. It then shows live for everyone signed in, with the date picker built in.</li>'+
        '</ol>'+
        '<p class="hint" style="margin-top:10px">You can always open the full report directly: <a href="https://analytics.google.com/analytics/web/#/a402827176p547720506/reports/reportinghub" target="_blank" rel="noopener">Google Analytics &rarr;</a></p>'+
        '</div>';
      return;
    }
    root.innerHTML='';
    var bar=document.createElement("div"); bar.className="card"; bar.style.marginBottom="12px";
    bar.innerHTML='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><h3 style="margin:0 0 4px">Website Analytics</h3><p class="hint" style="margin:0;max-width:70ch">Live Google Analytics for www.cttfa.co.za. Change the period with the date control inside the dashboard.</p></div><a class="btn ghost sm" href="https://analytics.google.com/analytics/web/#/a402827176p547720506/reports/reportinghub" target="_blank" rel="noopener">Open in Google Analytics</a></div>';
    root.appendChild(bar);
    var fr=document.createElement("iframe"); fr.id="webstatsFrame";
    fr.setAttribute("allowfullscreen",""); fr.setAttribute("loading","lazy");
    fr.style.cssText="width:100%;height:calc(100vh - 250px);min-height:640px;border:1px solid var(--line);border-radius:12px;background:#fff;display:block";
    fr.src=LOOKER_URL;
    root.appendChild(fr);
  }
  NS.renderWebstats = renderWebstats;
})(window.AC);
