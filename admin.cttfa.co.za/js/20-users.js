/* CTTLFA admin - Users module (T05). Closure over window.AC; session via NS.session(). */
(function(NS){
  "use strict";
  /* ---------- users ---------- */
  var AREA_LABELS={voting:"Voting",registrations:"Registrations",webadmin:"Website Admin",discipline:"Discipline",fincom:"Fincom",debtors:"Club Debtors",fixtures:"Fixtures",site:"Live site"};
  var AREA_ORDER=["voting","registrations","webadmin","discipline","fincom","debtors","fixtures","site"];
  var _uEditing=null;
  async function loadUsers(){
    var _S=NS.session(), me=_S.me, meRole=_S.role;
    var l=NS.$("usersList"); if(!l) return;
    var r=await NS.sb.from("admin_users").select("full_name,email,title,role,active,auth_id,modules").order("role").order("full_name");
    if(r.error){l.innerHTML='<p class="hint">'+NS.esc(r.error.message)+'</p>';return;}
    var us=r.data||[];
    var isAdmin=(meRole==="administrator");
    var h='';
    if(isAdmin){
      h+='<div class="uadd">'+
         '<input type="text" id="uaName" placeholder="Full name">'+
         '<input type="email" id="uaEmail" placeholder="email@cttfa.co.za">'+
         '<input type="text" id="uaTitle" placeholder="Title on Mancom (optional)">'+
         '<select id="uaRole"><option value="viewer">Viewer</option><option value="staff">Staff</option><option value="fincom">Fincom</option><option value="administrator">Administrator</option></select>'+
         '<button class="btn gold sm" id="uaBtn" title="Add this person to the allow-list. They sign in with this email and set their own password the first time.">Add to allow-list</button>'+
         '</div>';
    }
    h+='<div id="usersMsg"></div>';
    if(isAdmin && _uEditing){
      var eu=us.filter(function(x){ return x.email===_uEditing; })[0];
      if(eu){
        h+='<div class="uadd" id="uEditPanel" style="background:rgba(244,180,26,.06);border:1px solid rgba(244,180,26,.25);padding:10px;border-radius:10px">'+
           '<input type="text" id="ueName" value="'+NS.esc(eu.full_name||'')+'" placeholder="Full name">'+
           '<input type="email" id="ueEmail" value="'+NS.esc(eu.email)+'" placeholder="email@cttfa.co.za">'+
           '<input type="text" id="ueTitle" value="'+NS.esc(eu.title||'')+'" placeholder="Title (optional)">'+
           '<button class="btn gold sm" id="ueSave" data-email="'+NS.esc(eu.email)+'">Save changes</button>'+
           '<button class="btn ghost sm" id="ueCancel">Cancel</button>'+
           '</div>';
        if(eu.auth_id) h+='<p class="hint" style="margin:2px 0 8px">This person has already registered; changing their email updates the list entry only, they still sign in with the email they registered.</p>';
      }
    }
    h+='<table><thead><tr><th>Name</th><th>Email</th><th>User type</th>'+(isAdmin?'<th>Access / editable areas</th>':'')+'<th>Sign-in</th>'+(isAdmin?'<th>Manage</th>':'')+'</tr></thead><tbody>';
    us.forEach(function(u){
      var isMe=(me && u.email && me.email && u.email.toLowerCase()===me.email.toLowerCase());
      var _roleOpts=[["viewer","Viewer"],["staff","Staff"],["fincom","Fincom"],["administrator","Administrator"]];
      var roleCell = isAdmin
        ? '<select class="urole" data-email="'+NS.esc(u.email)+'">'+_roleOpts.map(function(o){ return '<option value="'+o[0]+'"'+(u.role===o[0]?" selected":"")+'>'+o[1]+'</option>'; }).join('')+'</select>'
        : '<span class="tag '+(u.role==="administrator"?"open":"draft")+'">'+NS.esc(u.role)+'</span>';
      var signin = (u.auth_id?'<span class="tag in">registered</span>':'<span class="kv">not yet</span>')+(u.active?'':' <span class="tag closed">inactive</span>');
      var areas='';
      if(isAdmin){
        if(u.role==="administrator"){ areas='<span class="kv">Sees &amp; edits everything</span>'; }
        else if(u.role==="viewer"){ areas='<span class="kv">Sees all &middot; view only</span>'; }
        else if(u.role==="fincom"){ areas='<span class="kv">Fincom Dashboard only &middot; view only</span>'; }
        else { var mods=u.modules||[]; areas='<div class="kv" style="margin-bottom:4px">Sees all &middot; can edit the ticked areas:</div><div class="umodwrap">'+AREA_ORDER.map(function(a){ return '<label class="umodlbl"><input type="checkbox" class="umod" data-email="'+NS.esc(u.email)+'" data-area="'+a+'"'+(mods.indexOf(a)>=0?' checked':'')+'> '+AREA_LABELS[a]+'</label>'; }).join('')+'</div>'; }
      }
      var manage='';
      if(isAdmin){
        manage = u.active
          ? '<button class="btn ghost sm uact" data-email="'+NS.esc(u.email)+'" data-active="0"'+(isMe?' disabled title="You cannot deactivate your own access"':'')+'>Deactivate</button>'
          : '<button class="btn green sm uact" data-email="'+NS.esc(u.email)+'" data-active="1">Activate</button>';
        manage += ' <button class="btn ghost sm uedit" data-email="'+NS.esc(u.email)+'">Edit</button>';
        if(!isMe) manage += ' <button class="btn ghost sm udel" data-email="'+NS.esc(u.email)+'" title="Remove this person from the list">Remove</button>';
      }
      h+='<tr'+(u.active?'':' style="opacity:.55"')+'><td><b>'+NS.esc(u.full_name)+'</b>'+(isMe?' <span class="kv">(you)</span>':'')+'<br><span class="kv">'+NS.esc(u.title||"")+'</span></td><td>'+NS.esc(u.email)+'</td><td>'+roleCell+'</td>'+(isAdmin?'<td>'+areas+'</td>':'')+'<td>'+signin+'</td>'+(isAdmin?'<td>'+manage+'</td>':'')+'</tr>';
    });
    h+='</tbody></table>';
    h+='<p class="hint" style="margin-top:10px"><b>Administrator</b> — sees and edits everything, and manages this user list. <b>Staff</b> — sees everything and can edit only the areas ticked above. <b>Fincom</b> — sees only the Fincom Dashboard, view only. <b>Viewer</b> — sees everything, view only. A change takes effect the next time that person signs in.'+(isAdmin?'':' Only administrators can change access.')+'</p>';
    l.innerHTML=h;
    if(isAdmin) wireUsers();
  }
  function wireUsers(){
    var add=NS.$("uaBtn"); if(add) add.onclick=async function(){
      var email=(NS.$("uaEmail").value||"").trim(), name=(NS.$("uaName").value||"").trim(), title=(NS.$("uaTitle").value||"").trim(), role=NS.$("uaRole").value;
      if(!email){ NS.msg(NS.$("usersMsg"),"Enter an email address for the new user.","err"); return; }
      add.disabled=true;
      var r=await NS.sb.rpc("add_user",{p_email:email,p_full_name:name,p_title:title,p_role:role});
      add.disabled=false;
      if(r.error){ NS.msg(NS.$("usersMsg"),r.error.message,"err"); return; }
      NS.msg(NS.$("usersMsg"),"Added "+NS.esc(email)+". They can now sign in with this email and set their own password.","ok");
      loadUsers();
    };
    Array.prototype.forEach.call(document.querySelectorAll("#usersList .urole"),function(sel){
      var prev=sel.value;
      sel.onchange=async function(){
        sel.disabled=true;
        var r=await NS.sb.rpc("set_user_role",{p_email:sel.dataset.email,p_role:sel.value});
        sel.disabled=false;
        if(r.error){ NS.msg(NS.$("usersMsg"),r.error.message,"err"); sel.value=prev; return; }
        NS.msg(NS.$("usersMsg"),"Access level updated for "+NS.esc(sel.dataset.email)+".","ok"); loadUsers();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#usersList .uact"),function(b){
      b.onclick=async function(){
        b.disabled=true;
        var r=await NS.sb.rpc("set_user_active",{p_email:b.dataset.email,p_active:(b.dataset.active==="1")});
        b.disabled=false;
        if(r.error){ NS.msg(NS.$("usersMsg"),r.error.message,"err"); return; }
        loadUsers();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#usersList .umod"),function(cb){
      cb.onchange=async function(){
        var email=cb.dataset.email, chosen=[];
        Array.prototype.forEach.call(document.querySelectorAll("#usersList .umod"),function(x){ if(x.dataset.email===email && x.checked) chosen.push(x.dataset.area); });
        cb.disabled=true;
        var r=await NS.sb.rpc("set_user_modules",{p_email:email,p_modules:chosen});
        cb.disabled=false;
        if(r.error){ NS.msg(NS.$("usersMsg"),r.error.message,"err"); cb.checked=!cb.checked; return; }
        NS.msg(NS.$("usersMsg"),"Area access updated for "+NS.esc(email)+".","ok");
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#usersList .uedit"),function(b){
      b.onclick=function(){ _uEditing=b.dataset.email; loadUsers(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#usersList .udel"),function(b){
      b.onclick=async function(){
        if(!window.confirm("Remove "+b.dataset.email+" from the list? They will no longer be able to sign in. This does not delete any of their work.")) return;
        b.disabled=true;
        var r=await NS.sb.rpc("delete_user",{p_email:b.dataset.email});
        b.disabled=false;
        if(r.error){ NS.msg(NS.$("usersMsg"),r.error.message,"err"); return; }
        NS.msg(NS.$("usersMsg"),"Removed "+NS.esc(b.dataset.email)+" from the list.","ok"); _uEditing=null; loadUsers();
      };
    });
    var eSave=NS.$("ueSave"); if(eSave) eSave.onclick=async function(){
      var cur=eSave.dataset.email, name=(NS.$("ueName").value||"").trim(), email=(NS.$("ueEmail").value||"").trim(), title=(NS.$("ueTitle").value||"").trim();
      if(!name){ NS.msg(NS.$("usersMsg"),"Name cannot be blank.","err"); return; }
      if(!email){ NS.msg(NS.$("usersMsg"),"Email cannot be blank.","err"); return; }
      eSave.disabled=true;
      var r=await NS.sb.rpc("update_user",{p_email:cur,p_new_email:email,p_full_name:name,p_title:title});
      eSave.disabled=false;
      if(r.error){ NS.msg(NS.$("usersMsg"),r.error.message,"err"); return; }
      NS.msg(NS.$("usersMsg"),"Updated "+NS.esc(name)+".","ok"); _uEditing=null; loadUsers();
    };
    var eCancel=NS.$("ueCancel"); if(eCancel) eCancel.onclick=function(){ _uEditing=null; loadUsers(); };
  }
  NS.loadUsers = loadUsers;
})(window.AC);
