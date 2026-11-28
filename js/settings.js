/* ============================================================
   settings.js v3 — PIN & auto-lock, backup/restore, data check, reminders.
   PIN logic lives in security.js; backup logic in backup.js.
   ============================================================ */
window.Pages.settings = async function(root){
  const [theme,pinEnabled,reminderDays,pushEnabled,autoLock,lastBackup] = await Promise.all([
    DB.getSetting("theme","system"), Security.isEnabled(), DB.getSetting("reminderDays",3),
    DB.getSetting("pushEnabled",false), DB.getSetting("autoLock",5), DB.getSetting("lastBackupAt",0)]);
  const days = lastBackup ? Math.floor((Date.now()-lastBackup)/Utils.DAY) : null;
  const persisted = (navigator.storage && navigator.storage.persisted) ? await navigator.storage.persisted() : null;

  root.innerHTML=`
    <div class="section-title"><h2>Appearance</h2></div>
    <div class="card"><div class="field" style="margin:0;"><label>Theme</label>
      <div class="seg" id="themeSeg">
        <button data-t="system" class="${theme==="system"?"active":""}">Auto</button>
        <button data-t="dark" class="${theme==="dark"?"active":""}">Dark</button>
        <button data-t="light" class="${theme==="light"?"active":""}">Light</button></div></div></div>

    <div class="section-title"><h2>Region &amp; currency</h2></div>
    <div class="card" style="padding-top:14px;">
      <div class="field"><label for="rgCur">Currency</label>
        <select id="rgCur">${Utils.CURRENCIES.map(c=>`<option value="${c.code}">${c.symbol} — ${c.name} (${c.code})</option>`).join("")}<option value="CUSTOM">Custom symbol…</option></select></div>
      <div class="field hidden" id="rgSymWrap"><label for="rgSym">Symbol (up to 4 characters)</label><input id="rgSym" maxlength="4" autocomplete="off"></div>
      <div class="field-row">
        <div class="field"><label for="rgNum">Numbers</label><select id="rgNum">${Object.entries(Utils.NUMBER_FORMATS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("")}</select></div>
        <div class="field"><label for="rgDate">Dates</label><select id="rgDate">${Object.entries(Utils.DATE_FORMATS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></div>
      </div>
      <div class="tape" style="padding:12px 14px;"><div class="k">Preview</div>
        <div class="ln"><span>Amount</span><i></i><b id="rgPrevMoney"></b></div><div class="ln"><span>Date</span><i></i><b id="rgPrevDate"></b></div></div><div class="tape-edge"></div>
      <p class="faint" style="font-size:12.5px;line-height:1.6;margin:0;">This only changes how amounts and dates are <b>shown</b>. Stored amounts are never converted — switching currency does not change what anyone owes. Spreadsheet (CSV) exports always use plain numbers and ISO dates, plus a currency column, so Excel and Sheets read them correctly.</p>
    </div>

    <div class="section-title"><h2>Security</h2></div>
    <div class="card">
      <div class="flex-between" style="padding:4px 0;">
        <div><div style="font-weight:600;font-size:14px;">PIN Lock</div>
          <div class="muted" style="font-size:12px;">4 or 6 digits · locks after repeated wrong tries</div></div>
        <label class="toggle"><input type="checkbox" id="pinToggle" aria-label="PIN lock" ${pinEnabled?"checked":""}><span class="slider"></span></label>
      </div>
      <div id="pinSection" style="${pinEnabled?"":"display:none;"}margin-top:12px;">
        <div class="field"><label for="autoLockSel">Auto-lock</label>
          <select id="autoLockSel">
            <option value="0">Never</option><option value="-1">Whenever I leave the app</option>
            <option value="1">After 1 minute idle</option><option value="5">After 5 minutes idle</option><option value="15">After 15 minutes idle</option></select></div>
        <button class="btn btn-ghost btn-block" id="changePinBtn">Change PIN</button>
      </div>
      <p class="faint" style="font-size:12px;line-height:1.6;margin:12px 0 0;">The PIN hides the app on this device. It does <b>not</b> encrypt your records — anyone who can open this browser profile's storage could still read them. Use a password-protected backup for copies you export. A forgotten PIN can't be recovered.</p>
    </div>

    <div class="section-title"><h2>Reminders</h2></div>
    <div class="card">
      <div class="flex-between" style="padding:4px 0;margin-bottom:10px;">
        <div><div style="font-weight:600;font-size:14px;">Browser notifications</div>
          <div class="muted" style="font-size:12px;line-height:1.5;">Shown while you use the app. Utanginamo can't send reminders when it's closed.</div></div>
        <label class="toggle"><input type="checkbox" id="pushToggle" aria-label="Browser notifications" ${pushEnabled?"checked":""}><span class="slider"></span></label>
      </div>
      <div class="field"><label for="setReminder">Remind me this many days before due</label>
        <input id="setReminder" type="number" inputmode="numeric" min="0" max="30" value="${reminderDays}"></div>
      <button class="btn btn-ghost btn-block" id="saveReminder">Save Reminder Settings</button>
      <div class="divider"></div>
      <div style="font-weight:500;font-size:14.5px;">Reminders that work when the app is closed</div>
      <p class="muted" style="font-size:13px;line-height:1.6;margin:4px 0 12px;">Download a calendar file with every upcoming due date and installment. Your phone's calendar app will alert you — no internet or server needed.</p>
      <button class="btn btn-ghost btn-block" id="calAll">${Icons.calendar}&nbsp;Add all open loans to calendar</button>
    </div>

    <div class="section-title"><h2>Interest Defaults</h2></div>
    <div class="card">
      <div class="field"><label for="setIntType">Default Interest Type</label>
        <select id="setIntType"><option value="none">No Interest</option><option value="flat">Flat (one-time %)</option><option value="monthly">Monthly %</option><option value="weekly">Weekly %</option><option value="daily">Daily %</option><option value="percent">Custom % (one-time)</option><option value="fixed">Fixed Amount</option></select></div>
      <div class="field-row">
        <div class="field"><label for="setIntRate">Default Rate (%)</label><input id="setIntRate" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div>
        <div class="field"><label for="setPenType">Default Penalty</label><select id="setPenType"><option value="none">None</option><option value="percent">%</option><option value="fixed">Fixed</option></select></div>
      </div>
      <button class="btn btn-ghost btn-block" id="saveDefaults">Save Defaults</button>
    </div>

    <div class="section-title"><h2>Backup &amp; Restore</h2></div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px;">
      <div class="flex-between"><div><div style="font-weight:600;font-size:14px;">Last backup</div>
        <div class="muted" style="font-size:12px;">${lastBackup?`${Utils.fmtDateTime(lastBackup)} · ${days===0?"today":days+" day"+(days===1?"":"s")+" ago"}`:"You haven't backed up yet"}</div></div>
        ${lastBackup&&days<=7?`<span class="tag active">Up to date</span>`:`<span class="tag due">Back up soon</span>`}</div>
      <button class="btn btn-primary btn-block" id="exportJson">${Icons.download}&nbsp;Export Backup</button>
      <button class="btn btn-ghost btn-block" id="importBtn">${Icons.upload}&nbsp;Restore from Backup</button>
      <input type="file" id="importFile" accept=".json,application/json" class="hidden">
      <button class="btn btn-ghost btn-block" id="checkData">Check data for problems</button>
      <p class="faint" style="font-size:12px;line-height:1.6;margin:0;">Backups include photos and personal details. Add a password when exporting to encrypt the file. Restoring shows a preview first.</p>
    </div>

    <div class="section-title"><h2>Spreadsheet Export</h2></div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-ghost btn-block" id="exportLoansCSV">${Icons.download}&nbsp;Loans (CSV)</button>
      <button class="btn btn-ghost btn-block" id="exportPayCSV">${Icons.download}&nbsp;Payments (CSV)</button>
      <p class="faint" style="font-size:12px;margin:0;">CSV files are not encrypted and are not a full backup.</p>
    </div>

    <div class="section-title"><h2>Where your data lives</h2></div>
    <div class="card" style="font-size:13px;line-height:1.7;">
      <p style="margin:0 0 8px;">Everything is stored <b>only on this device</b>, in this browser's storage. Nothing is sent to a server.</p>
      <ul style="margin:0 0 8px;padding-left:18px;" class="muted">
        <li>Clearing browser/site data, or uninstalling the app, can erase your records.</li>
        <li>Moving to a new phone means exporting a backup and restoring it there.</li>
        <li>Your backup file is the only copy that survives a lost or reset device.</li></ul>
      ${persisted===null?"":`<div class="flex-between"><span class="muted">Protected from automatic cleanup</span><b>${persisted?"Yes":"Not yet"}</b></div>`}
      ${persisted===false?`<button class="btn btn-ghost btn-block btn-sm" id="persistBtn" style="margin-top:10px;">Request protection</button>`:""}
    </div>

    <div class="section-title"><h2>Install app</h2></div>
    <div class="card" style="padding-top:14px;">
      <div class="muted" id="instText" style="font-size:14px;line-height:1.6;">Checking this device…</div>
      <div id="instAct" style="margin-top:12px;"></div>
      <details style="margin-top:6px;"><summary>App health</summary><div id="instDiag" style="font-size:13.5px;line-height:1.9;"></div>
        <button class="btn btn-ghost btn-sm" id="instRecheck" style="margin-bottom:10px;">Check again</button></details>
    </div>

    <div class="section-title"><h2>Danger Zone</h2></div>
    <div class="card"><button class="btn btn-danger btn-block" id="resetBtn">Reset Database…</button></div>

    <div class="section-title"><h2>About</h2></div>
    <div class="card"><div class="row" style="cursor:default;"><div class="avatar">${Icons.coin}</div>
      <div class="meta"><div class="title">Utanginamo — Lending Ledger</div><div class="sub">Version ${window.APP_VERSION||"3"} · Offline-first PWA</div></div></div></div>
  `;

  const $=s=>root.querySelector(s);
  const [defIntType,defIntRate,defPenType]=await Promise.all([DB.getSetting("defaultInterestType","none"),DB.getSetting("defaultInterestRate",0),DB.getSetting("defaultPenaltyType","none")]);
  $("#setIntType").value=defIntType; $("#setIntRate").value=defIntRate; $("#setPenType").value=defPenType; $("#autoLockSel").value=String(autoLock);

  root.querySelectorAll("#themeSeg button").forEach(btn=>btn.onclick=async()=>{
    root.querySelectorAll("#themeSeg button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    await DB.setSetting("theme",btn.dataset.t); applyTheme(btn.dataset.t);
  });

  // ----- region & currency -----
  const r0=Utils.region, isCustom=r0.currency==="CUSTOM";
  $("#rgCur").value=isCustom?"CUSTOM":r0.currency; $("#rgNum").value=r0.num; $("#rgDate").value=r0.date; $("#rgSym").value=isCustom?r0.symbol:""; $("#rgSymWrap").classList.toggle("hidden",!isCustom);
  const rgPreview=()=>{ $("#rgPrevMoney").textContent=Utils.money(1234567.89); $("#rgPrevDate").textContent=Utils.fmtDate(Date.now()); };
  rgPreview();
  const rgSave=async()=>{
    const code=$("#rgCur").value; $("#rgSymWrap").classList.toggle("hidden",code!=="CUSTOM");
    const cfg={currency:code,num:$("#rgNum").value,date:$("#rgDate").value}; if(code==="CUSTOM") cfg.symbol=($("#rgSym").value||"").trim()||"¤";
    await Utils.saveRegion(cfg); rgPreview(); Toast.show("Region saved",{type:"success",duration:1600});
  };
  ["#rgCur","#rgNum","#rgDate"].forEach(id=>$(id).onchange=rgSave); $("#rgSym").addEventListener("change",rgSave);

  // ----- install & app health -----
  async function paintInstall(){
    const d=await Install.diagnostics(), a=Install.advice(d);
    $("#instText").textContent=a.text; const act=$("#instAct"); act.innerHTML="";
    if (a.state==="ready"){ act.innerHTML=`<button class="btn btn-primary btn-block" id="instBtn">Install Utanginamo</button>`; $("#instBtn").onclick=async()=>{ await Install.prompt(); paintInstall(); }; }
    const yn=(ok,good,bad)=>ok?`<b style="color:var(--green)">✓ ${good}</b>`:`<b style="color:var(--red)">✗ ${bad}</b>`;
    $("#instDiag").innerHTML=[
      ["Secure connection (https)",yn(d.secure,"Yes","No")],
      ["Offline engine",yn(d.sw==="active","Running",d.sw==="none"?"Not running":d.sw)],
      ["Files saved for offline",d.cache?`<b>${d.cachedFiles}</b> <span class="faint">(${d.cache})</span>`:yn(false,"","None yet")],
      ["App manifest",yn(!!d.manifest,d.manifest?`${d.manifest.icons} icons`:"","Not found")],
      ["Icons load",yn(!d.badIcons.length,"All OK","Missing: "+d.badIcons.join(", "))],
      ["Installed",d.standalone?`<b>✓ Yes</b>`:"<b>No</b>"],
      ["Install prompt available",d.canPrompt?`<b>✓ Yes</b>`:`<b>No</b> <span class="faint">${d.ios?"(iPhone: use Share → Add to Home Screen)":"(browser decides when)"}</span>`],
    ].map(([k,v])=>`<div class="flex-between"><span class="muted">${k}</span><span>${v}</span></div>`).join("");
  }
  paintInstall(); $("#instRecheck").onclick=paintInstall;
  $("#calAll").onclick=()=>Ics.openSheet(null,"Add all to calendar");

  // ----- PIN -----
  const pinToggle=$("#pinToggle"), pinSection=$("#pinSection");
  pinToggle.onchange=async()=>{
    if (pinToggle.checked){
      openSetPin_(()=>{ pinToggle.checked=false; });
    } else {
      const ok=await Security.promptPin("Turn off PIN","Enter your current PIN to turn it off.");
      if (!ok){ pinToggle.checked=true; return; }
      await Security.disablePin(); pinSection.style.display="none"; Toast.show("PIN lock turned off",{type:"success"});
    }
  };
  function openSetPin_(onCancel){
    Security.openSetPin(async(pin)=>{
      await Security.setPin(pin); await Security.startWatch(); pinSection.style.display=""; pinToggle.checked=true;
      Toast.show("PIN lock turned on",{type:"success"});
    },{title:"Set PIN",onCancel});
  }
  $("#changePinBtn").onclick=async()=>{
    if (!(await Security.promptPin("Change PIN","Enter your current PIN first."))) return;
    Security.openSetPin(async(pin)=>{ await Security.setPin(pin); await Security.startWatch(); Toast.show("PIN updated",{type:"success"}); },{title:"New PIN"});
  };
  $("#autoLockSel").onchange=async(e)=>{ await DB.setSetting("autoLock",parseInt(e.target.value,10)); await Security.startWatch(); Toast.show("Auto-lock saved",{type:"success"}); };

  // ----- reminders (only while app is open) -----
  $("#pushToggle").onchange=async(e)=>{
    if (e.target.checked){
      const granted=await requestPushPermission();
      if (!granted){ e.target.checked=false; Toast.show("Notification permission denied",{type:"error"}); return; }
      await DB.setSetting("pushEnabled",true); schedulePushReminders(); Toast.show("Notifications on while the app is open",{type:"success"});
    } else { await DB.setSetting("pushEnabled",false); Toast.show("Notifications off"); }
  };
  $("#saveReminder").onclick=async()=>{ await DB.setSetting("reminderDays",parseInt($("#setReminder").value)||0); Toast.show("Saved",{type:"success"}); Router.updateBadge(); };
  $("#saveDefaults").onclick=async()=>{
    await DB.setSetting("defaultInterestType",$("#setIntType").value);
    await DB.setSetting("defaultInterestRate",parseFloat($("#setIntRate").value)||0);
    await DB.setSetting("defaultPenaltyType",$("#setPenType").value); Toast.show("Defaults saved",{type:"success"});
  };

  // ----- backup / restore -----
  $("#exportJson").onclick=async()=>{ if (await Backup.exportFlow()) Router.refresh(); };
  const importFile=$("#importFile");
  $("#importBtn").onclick=()=>importFile.click();
  importFile.onchange=async()=>{ const f=importFile.files[0]; importFile.value=""; if (f) await Backup.restoreFlow(f); };
  $("#checkData").onclick=()=>Backup.integrityFlow();
  $("#exportLoansCSV").onclick=async()=>{ downloadFile(await DB.exportLoansCSV(),"text/csv",`utanginamo-loans-${Utils.toInputDate(Date.now())}.csv`); Toast.show("Loans CSV exported",{type:"success"}); };
  $("#exportPayCSV").onclick=async()=>{ downloadFile(await DB.exportPaymentsCSV(),"text/csv",`utanginamo-payments-${Utils.toInputDate(Date.now())}.csv`); Toast.show("Payments CSV exported",{type:"success"}); };
  if ($("#persistBtn")) $("#persistBtn").onclick=async()=>{ const ok=await navigator.storage.persist(); Toast.show(ok?"Storage protected":"The browser declined — it may allow it after you install the app",{type:ok?"success":"default",duration:4000}); Router.refresh(); };

  // ----- reset (PIN + typed confirmation) -----
  $("#resetBtn").onclick=async()=>{
    if (!(await Security.promptPin("Confirm with PIN","Enter your PIN to reset the database."))) return;
    Sheet.open({ title:"Reset Database",
      bodyHtml:`<div class="card" style="background:var(--red-soft);font-size:13.5px;line-height:1.6;margin-bottom:14px;">This permanently deletes <b>all</b> borrowers, loans, payments, attachments and history on this device. Your PIN and settings are kept.</div>
        <p class="muted" style="font-size:13px;line-height:1.6;margin-top:0;">${lastBackup?`Your last backup was ${days===0?"today":days+" day(s) ago"}. Anything added since then will be lost.`:"You have <b>no backup</b>. Export one first — it's the only way to get this data back."}</p>
        <div class="field"><label for="rsText">Type RESET to confirm</label><input id="rsText" autocomplete="off" autocapitalize="characters"></div>`,
      footHtml:`<button class="btn btn-ghost btn-block" id="rsNo">Cancel</button><button class="btn btn-danger btn-block" id="rsGo" disabled>Delete everything</button>`,
      onMount:(sheet)=>{
        const t=sheet.querySelector("#rsText"), go=sheet.querySelector("#rsGo");
        t.oninput=()=>go.disabled=t.value.trim()!=="RESET";
        sheet.querySelector("#rsNo").onclick=()=>Sheet.close();
        go.onclick=async()=>{ go.disabled=true; await DB.resetAll(); await DB.logActivity({type:"reset",text:"Database was reset"}); Sheet.close(); Toast.show("Database reset",{type:"success"}); Router.stack=[{view:"dashboard",params:{}}]; Router.render(); };
      } });
  };
};

function downloadFile(content, mime, filename){
  const blob=new Blob([content],{type:mime}), url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}

// ---------- Reminders (only fire while the app is open) ----------
async function requestPushPermission(){
  if (!("Notification" in window)) return false;
  if (Notification.permission==="granted") return true;
  return (await Notification.requestPermission())==="granted";
}

const _notified = new Set();   // avoid repeating the same reminder within one session
async function schedulePushReminders(){
  const pushEnabled=await DB.getSetting("pushEnabled",false);
  if (!pushEnabled||!("Notification" in window)||Notification.permission!=="granted") return;
  const reminderDays=await DB.getSetting("reminderDays",3);
  const [loans,payments,borrowers]=await Promise.all([DB.listLoans(),DB.allPayments(),DB.listBorrowers({includeArchived:true})]);
  const nameOf=(id)=>(borrowers.find(b=>b.id===id)||{}).name||"Borrower";
  const today=Utils.toInputDate(Date.now());
  loans.forEach(loan=>{
    const c=Utils.computeLoan(loan,payments.filter(p=>p.loanId===loan.id));
    const key=`${loan.id}:${c.status}:${today}`;
    if (_notified.has(key)) return;
    if (c.status==="overdue"){
      _notified.add(key);
      new Notification("Utanginamo — Overdue",{body:`${nameOf(loan.borrowerId)} is ${c.daysOverdue} day(s) overdue · ${Utils.money(c.remaining)}`,icon:"./icons/icon-192.png",tag:`overdue-${loan.id}`});
    } else if (c.status==="active"&&c.daysRemaining>=0&&c.daysRemaining<=reminderDays){
      _notified.add(key);
      new Notification("Utanginamo — Payment due",{body:`${nameOf(loan.borrowerId)} owes ${Utils.money(c.remaining)} — due ${Utils.fmtRelative(loan.dueDate)}`,icon:"./icons/icon-192.png",tag:`due-${loan.id}`});
    }
  });
}

// ---------- Theme ----------
function applyTheme(t){
  if (t==="system") document.documentElement.setAttribute("data-theme",window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
  else document.documentElement.setAttribute("data-theme",t);
}

window.schedulePushReminders=schedulePushReminders;
window.applyTheme=applyTheme;
window.downloadFile=downloadFile;
