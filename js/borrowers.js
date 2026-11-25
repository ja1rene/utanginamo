/* ============================================================
   borrowers.js v3 — list, profile, form.
   Data minimisation: only the name is required; extra details are optional
   and tucked away. Photos are downscaled. Deleting is atomic with Undo.
   ============================================================ */

// ---------- Borrower list ----------
window.Pages.borrowers = async function(root, params={}) {
  root.innerHTML = `
    <div class="search-bar">${Icons.search}
      <input type="search" id="bSearch" aria-label="Search borrowers" placeholder="Search name, phone, address, notes…" value="${Utils.escapeHtml(params.q||"")}">
    </div>
    <div class="chip-row" id="bFilters">
      <button class="chip active" data-f="all">All</button>
      <button class="chip" data-f="active">Active loans</button>
      <button class="chip" data-f="overdue">Overdue</button>
      <button class="chip" data-f="archived">Archived</button>
    </div>
    <div id="bList"><div class="card">${skeletonRows(5)}</div></div>`;

  let filter = "all";
  const listEl = root.querySelector("#bList"), input = root.querySelector("#bSearch");

  async function render() {
    const [borrowers, loans, payments] = await Promise.all([DB.listBorrowers({includeArchived:true}), DB.listLoans(), DB.allPayments()]);
    const q = input.value.trim().toLowerCase();
    const statusOf = b => loans.filter(l=>l.borrowerId===b.id).map(l=>Utils.computeLoan(l,payments.filter(p=>p.loanId===l.id)).status);
    let rows = borrowers.filter(b => {
      if (filter === "archived") return b.archived;
      if (b.archived) return false;
      if (filter === "active") return statusOf(b).some(s=>s==="active"||s==="overdue");
      if (filter === "overdue") return statusOf(b).includes("overdue");
      return true;
    });
    if (q) rows = rows.filter(b => [b.name,b.nickname,b.phone,b.address,b.facebook,b.occupation,b.notes].some(f=>(f||"").toLowerCase().includes(q)));
    rows.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));

    if (!rows.length) {
      const none = !borrowers.some(b=>!b.archived);
      listEl.innerHTML = `<div class="card">${emptyState("users", q?"No results":(filter==="overdue"?"No overdue borrowers":(none?"No borrowers yet":"Nothing here")),
        q?"Try a different search term.":(none?"Add the people you lend to. You can add loans and record payments after that.":"No borrowers match this filter."),
        none&&!q?`<button class="btn btn-primary" id="emptyAdd">Add Borrower</button>`:"")}</div>`;
      const add = listEl.querySelector("#emptyAdd"); if (add) add.onclick = () => openBorrowerForm();
      return;
    }
    listEl.innerHTML = `<div class="card">${rows.map(b=>borrowerRowHtml(b,loans,payments)).join("")}</div>`;
    listEl.querySelectorAll("[data-borrower-row]").forEach(el=>el.onclick=()=>Router.go("borrowerProfile",{id:el.dataset.borrowerRow}));
  }
  input.addEventListener("input",Utils.debounce(render,200));
  root.querySelectorAll("#bFilters .chip").forEach(chip=>chip.onclick=()=>{
    root.querySelectorAll("#bFilters .chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); filter=chip.dataset.f; render();
  });
  render();
};

// Downscale photos (privacy + storage): max 480px JPEG
async function resizeImage(file, max=480) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max/Math.max(bmp.width,bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width*k); c.height = Math.round(bmp.height*k);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    return c.toDataURL("image/jpeg",0.82);
  } catch(e) { return Utils.blobToDataURL(file); }
}

// ---------- Add / Edit borrower ----------
function openBorrowerForm(existing=null){
  const b = existing||{};
  let photoData = b.photo||null, saving = false, dupAck = false;
  const hasMore = !!(b.nickname||b.relationship||b.occupation||b.facebook||b.emergencyContact);
  Sheet.open({
    title: existing?"Edit Borrower":"Add Borrower",
    bodyHtml:`
      <div style="text-align:center;margin-bottom:14px;">
        <button type="button" id="photoPreview" class="avatar" aria-label="Choose photo" style="width:72px;height:72px;font-size:24px;margin:0 auto 8px;border:none;cursor:pointer;">
          ${photoData?`<img src="${photoData}" alt="">`:(Utils.initials(b.name||"")||Icons.users)}</button>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button type="button" class="btn btn-ghost btn-sm" id="photoFile">${Icons.image}&nbsp;Gallery</button>
          <button type="button" class="btn btn-ghost btn-sm" id="photoCamera">${Icons.camera}&nbsp;Camera</button>
          ${photoData?`<button type="button" class="btn btn-ghost btn-sm" id="photoClear">Remove</button>`:""}
        </div></div>
      <div class="field"><label for="fName">Full name *</label><input id="fName" value="${Utils.escapeHtml(b.name||"")}" placeholder="Juan Dela Cruz" autocomplete="off"><div class="hint" id="fNameErr" role="alert" style="color:var(--red);"></div></div>
      <div class="field"><label for="fPhone">Phone</label><input id="fPhone" type="tel" inputmode="tel" value="${Utils.escapeHtml(b.phone||"")}" placeholder="09xx xxx xxxx"></div>
      <div class="field"><label for="fAddr">Address</label><input id="fAddr" value="${Utils.escapeHtml(b.address||"")}" placeholder="Brgy, City"></div>
      <div class="field"><label for="fNotes">Notes</label><textarea id="fNotes" placeholder="Anything worth remembering…">${Utils.escapeHtml(b.notes||"")}</textarea></div>
      <details ${hasMore?"open":""}><summary>More details (optional)</summary>
        <div class="field-row">
          <div class="field"><label for="fNick">Nickname</label><input id="fNick" value="${Utils.escapeHtml(b.nickname||"")}"></div>
          <div class="field"><label for="fRel">Relationship</label><input id="fRel" value="${Utils.escapeHtml(b.relationship||"")}" placeholder="Friend, co-worker…"></div>
        </div>
        <div class="field"><label for="fOcc">Occupation</label><input id="fOcc" value="${Utils.escapeHtml(b.occupation||"")}"></div>
        <div class="field"><label for="fFb">Facebook</label><input id="fFb" value="${Utils.escapeHtml(b.facebook||"")}" placeholder="facebook.com/username"></div>
        <div class="field"><label for="fEmg">Emergency contact</label><input id="fEmg" value="${Utils.escapeHtml(b.emergencyContact||"")}" placeholder="Name · phone"></div>
        <p class="faint" style="font-size:12px;margin:0;">Only add what you actually need. This stays on your device.</p>
      </details>
      <div id="dupWarn" class="card hidden" style="background:var(--amber-soft);border-color:transparent;font-size:13px;line-height:1.6;margin-top:12px;" role="alert"></div>`,
    footHtml:`<button class="btn btn-primary btn-block" id="saveBorrower">${existing?"Save Changes":"Add Borrower"}</button>`,
    onMount:(sheet)=>{
      const $=s=>sheet.querySelector(s);
      const gallery=document.createElement("input"); gallery.type="file"; gallery.accept="image/*";
      const camera=document.createElement("input"); camera.type="file"; camera.accept="image/*"; camera.capture="environment";
      async function handlePhoto(file){ if(!file)return; photoData=await resizeImage(file); $("#photoPreview").innerHTML=`<img src="${photoData}" alt="">`; }
      $("#photoFile").onclick=()=>gallery.click(); $("#photoCamera").onclick=()=>camera.click(); $("#photoPreview").onclick=()=>gallery.click();
      if ($("#photoClear")) $("#photoClear").onclick=()=>{ photoData=null; $("#photoPreview").innerHTML=Utils.initials($("#fName").value)||Icons.users; $("#photoClear").remove(); };
      gallery.onchange=()=>handlePhoto(gallery.files[0]); camera.onchange=()=>handlePhoto(camera.files[0]);
      $("#fName").addEventListener("input",()=>{ dupAck=false; $("#dupWarn").classList.add("hidden"); $("#saveBorrower").textContent=existing?"Save Changes":"Add Borrower"; $("#fName").removeAttribute("aria-invalid"); $("#fNameErr").textContent=""; });
      $("#fPhone").addEventListener("input",()=>{ dupAck=false; $("#dupWarn").classList.add("hidden"); });

      $("#saveBorrower").onclick=async()=>{
        if (saving) return;
        const name=$("#fName").value.trim().replace(/\s+/g," "), phone=$("#fPhone").value.trim();
        if (!name){ $("#fName").setAttribute("aria-invalid","true"); $("#fNameErr").textContent="Name is required."; $("#fName").focus(); return; }
        if (phone && phone.replace(/\D/g,"").length<7){ Toast.show("That phone number looks too short",{type:"error"}); $("#fPhone").focus(); return; }
        // duplicate check — inline, so nothing typed is lost
        if (!dupAck){
          const norm=s=>s.toLowerCase().replace(/\s+/g," ").trim(), digits=s=>(s||"").replace(/\D/g,"");
          const all=await DB.listBorrowers({includeArchived:true});
          const m=all.find(x=>x.id!==(existing&&existing.id)&&(norm(x.name)===norm(name)||(digits(phone).length>=7&&digits(x.phone)===digits(phone))));
          if (m){ dupAck=true; const w=$("#dupWarn"); w.innerHTML=`<b>Possible duplicate:</b> ${Utils.escapeHtml(m.name)}${m.phone?` · ${Utils.escapeHtml(m.phone)}`:""} is already in your list${m.archived?" (archived)":""}. Tap again to save anyway.`; w.classList.remove("hidden"); $("#saveBorrower").textContent="Save anyway"; w.scrollIntoView({block:"nearest"}); return; }
        }
        saving=true; $("#saveBorrower").disabled=true;
        const data={ name, phone, nickname:$("#fNick").value.trim(), facebook:$("#fFb").value.trim(), address:$("#fAddr").value.trim(),
          occupation:$("#fOcc").value.trim(), relationship:$("#fRel").value.trim(), emergencyContact:$("#fEmg").value.trim(), notes:$("#fNotes").value.trim(), photo:photoData };
        try {
          if (existing){ await DB.updateBorrower(existing.id,data); Sheet.close(); Toast.show("Borrower updated",{type:"success"}); Router.refresh(); }
          else { const created=await DB.createBorrower(data); Sheet.close(); Toast.show("Borrower added",{type:"success"}); Router.go("borrowerProfile",{id:created.id}); }
        } catch(e){ console.error("[borrower]",e.message); saving=false; $("#saveBorrower").disabled=false; Toast.show("Couldn't save. Nothing was changed.",{type:"error"}); }
      };
    },
  });
}

// ---------- Borrower profile ----------
window.Pages.borrowerProfile = async function(root, params){
  const b = await DB.get("borrowers", params.id);
  if (!b){ root.innerHTML=emptyState("users","Borrower not found","It may have been deleted."); return; }

  const [loans, payments, attachments] = await Promise.all([DB.loansForBorrower(b.id), DB.paymentsForBorrower(b.id), DB.attachmentsFor(b.id)]);
  const computed = loans.map(l=>({loan:l,c:Utils.computeLoan(l,payments.filter(p=>p.loanId===l.id))}));
  const overdue = computed.filter(x=>x.c.status==="overdue").sort((a,b)=>a.loan.dueDate-b.loan.dueDate);
  const active  = computed.filter(x=>x.c.status==="active").sort((a,b)=>a.loan.dueDate-b.loan.dueDate);
  const history = computed.filter(x=>!["active","overdue"].includes(x.c.status)).sort((a,b)=>b.loan.createdAt-a.loan.createdAt);
  const open = [...overdue,...active];
  const owed = open.reduce((s,x)=>s+x.c.remaining,0), overdueAmt = overdue.reduce((s,x)=>s+x.c.remaining,0);
  const paidTotal = computed.reduce((s,x)=>s+x.c.paid,0);
  const trust = Utils.trustRating(loans,payments);
  const loanOf = id => loans.find(l=>l.id===id);
  const fbUrl = b.facebook ? "https://"+b.facebook.replace(/^https?:\/\//,"") : "";
  const hasDetails = b.address||b.occupation||b.emergencyContact||b.facebook||b.notes;
  const payRow = p => { const l=loanOf(p.loanId); return `
    <div class="row" data-loan-row="${p.loanId}" role="button" tabindex="0">
      <div class="avatar" style="background:var(--green-soft);color:var(--green);">${Icons.receipt}</div>
      <div class="meta"><div class="title">${Utils.money(p.amount)}</div><div class="sub">${Utils.fmtDate(p.date)} · ${Utils.escapeHtml(p.method||"Cash")}${l?` · loan ${Utils.money(l.principal)}`:""}</div></div>
      <div class="trail faint">${Icons.chev}</div></div>`; };

  root.innerHTML=`
    <div class="card">
      <div style="display:flex;align-items:center;gap:14px;">
        <div class="avatar" style="width:64px;height:64px;font-size:21px;">${avatarHtml(b)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:19px;font-weight:650;letter-spacing:-.01em;">${Utils.escapeHtml(b.name)}${b.archived?` <span class="tag archived">Archived</span>`:""}</div>
          <div class="muted" style="font-size:13px;margin-top:2px;">${b.nickname?`“${Utils.escapeHtml(b.nickname)}”`:""}${b.nickname&&b.relationship?" · ":""}${Utils.escapeHtml(b.relationship||"")}${!b.nickname&&!b.relationship?(b.phone?Utils.escapeHtml(b.phone):"No phone saved"):""}</div>
          ${loans.length?`<div style="margin-top:6px;font-size:12.5px;" class="muted"><span class="stars" aria-hidden="true">${Utils.starString(trust.stars)}</span> <span class="visually-hidden">${trust.stars} of 5 stars.</span> ${Utils.escapeHtml(trust.label)}</div>`:""}
        </div>
        <button class="icon-btn" id="editBorrower" aria-label="Edit borrower">${Icons.edit}</button>
      </div>
      ${b.phone?`<div style="display:flex;gap:8px;margin-top:14px;">
        <a href="tel:${Utils.escapeHtml(b.phone)}" class="btn btn-ghost btn-block">${Icons.phone}&nbsp;Call</a>
        <a href="sms:${Utils.escapeHtml(b.phone)}" class="btn btn-ghost btn-block">${Icons.chat}&nbsp;Message</a></div>`:""}
    </div>

    <div class="kpi-grid" style="margin-top:12px;">
      <div class="kpi accent"><div class="eyebrow">Owes you</div><div class="val">${Utils.moneyShort(owed)}</div></div>
      <div class="kpi"><div class="eyebrow">Overdue</div><div class="val" style="${overdueAmt>0?"color:var(--red)":""}">${Utils.moneyShort(overdueAmt)}</div></div>
      <div class="kpi"><div class="eyebrow">Paid so far</div><div class="val">${Utils.moneyShort(paidTotal)}</div></div>
      <div class="kpi"><div class="eyebrow">Open loans</div><div class="val">${open.length}<span class="faint" style="font-size:13px;font-weight:500;"> / ${loans.length}</span></div></div>
    </div>

    <div style="display:flex;gap:8px;margin-top:12px;">
      ${open.length?`<button class="btn btn-primary" style="flex:1;" id="payBtn">Record Payment</button>`:""}
      <button class="btn ${open.length?"btn-ghost":"btn-primary"}" style="flex:1;" id="addLoanBtn">New Loan</button>
    </div>

    ${overdue.length?`<div class="section-title"><h2>Overdue (${overdue.length})</h2></div><div class="card">${overdue.map(x=>loanRowHtml(x.loan,x.c,[b])).join("")}</div>`:""}
    ${active.length?`<div class="section-title"><h2>Active loans (${active.length})</h2></div><div class="card">${active.map(x=>loanRowHtml(x.loan,x.c,[b])).join("")}</div>`:""}
    ${!loans.length?`<div class="section-title"><h2>Loans</h2></div><div class="card">${emptyState("wallet","No loans yet","Create this borrower's first loan to start tracking.")}</div>`:""}
    ${history.length?`<div class="section-title"><h2>Loan history (${history.length})</h2></div><div class="card">${history.map(x=>loanRowHtml(x.loan,x.c,[b])).join("")}</div>`:""}

    <div class="section-title"><h2>Payment history</h2></div>
    <div class="card" id="payCard">
      ${payments.length===0?emptyState("receipt","No payments yet","Payments you record will appear here."):
        payments.slice(0,6).map(payRow).join("")+(payments.length>6?`<div id="morePays" class="hidden">${payments.slice(6).map(payRow).join("")}</div><button class="btn btn-ghost btn-block btn-sm" id="showMore" style="margin-top:8px;">Show all ${payments.length}</button>`:"")}
    </div>

    <div class="card" style="margin-top:12px;padding:4px 16px;">
      <details ${hasDetails?"":""}><summary>Contact &amp; details</summary>
        ${hasDetails?`<div style="padding-bottom:8px;">
          ${b.phone?`<div class="row" style="cursor:default;"><div class="avatar">${Icons.phone}</div><div class="meta"><div class="title">${Utils.escapeHtml(b.phone)}</div><div class="sub">Phone</div></div></div>`:""}
          ${b.address?`<div class="row" style="cursor:default;"><div class="avatar">${Icons.map}</div><div class="meta"><div class="title" style="white-space:normal;">${Utils.escapeHtml(b.address)}</div><div class="sub">Address</div></div></div>`:""}
          ${b.occupation?`<div class="row" style="cursor:default;"><div class="avatar">${Icons.briefcase}</div><div class="meta"><div class="title">${Utils.escapeHtml(b.occupation)}</div><div class="sub">Occupation</div></div></div>`:""}
          ${b.emergencyContact?`<div class="row" style="cursor:default;"><div class="avatar">${Icons.phone}</div><div class="meta"><div class="title">${Utils.escapeHtml(b.emergencyContact)}</div><div class="sub">Emergency contact</div></div></div>`:""}
          ${b.facebook?`<a class="row" href="${Utils.escapeHtml(fbUrl)}" target="_blank" rel="noopener"><div class="avatar">${Icons.fb}</div><div class="meta"><div class="title">${Utils.escapeHtml(b.facebook)}</div><div class="sub">Facebook</div></div><div class="trail faint">${Icons.chev}</div></a>`:""}
          ${b.notes?`<div style="padding:10px 4px;"><div class="eyebrow" style="margin-bottom:6px;">Notes</div><div style="font-size:13.5px;line-height:1.6;">${Utils.escapeHtml(b.notes)}</div></div>`:""}
        </div>`:`<p class="muted" style="font-size:13px;margin:0 0 12px;">No additional details saved. Use Edit to add some.</p>`}
      </details>
    </div>

    <div class="section-title"><h2>Documents</h2><button class="link" id="addAttBtn" style="background:none;border:none;">+ Add</button></div>
    <div class="card" id="attCard">
      ${attachments.length===0?emptyState("paperclip","No documents","Photos of IDs, agreements or signed notes. Max 10 MB each."):attachments.map(a=>attachmentRow(a)).join("")}
    </div>
    <input type="file" id="attGallery" accept="image/*,application/pdf" class="hidden">
    <input type="file" id="attCamera" accept="image/*" capture="environment" class="hidden">

    <div class="section-title"><h2>Manage</h2></div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-ghost btn-block" id="archiveBtn">${b.archived?"Unarchive borrower":"Archive borrower"}</button>
      <p class="faint" style="font-size:12px;margin:0;">Archiving hides this borrower from lists but keeps every loan and payment.</p>
      <div class="divider" style="margin:4px 0;"></div>
      <button class="btn btn-danger btn-block" id="deleteBtn">Delete borrower…</button>
      <p class="faint" style="font-size:12px;margin:0;">Permanently removes ${loans.length} loan${loans.length===1?"":"s"}, ${payments.length} payment${payments.length===1?"":"s"} and ${attachments.length} document${attachments.length===1?"":"s"}. You'll have a moment to undo.</p>
    </div>`;

  const $=s=>root.querySelector(s);
  root.querySelectorAll("[data-loan-row]").forEach(el=>el.onclick=()=>Router.go("loanDetail",{id:el.dataset.loanRow}));
  $("#editBorrower").onclick=()=>openBorrowerForm(b);
  $("#addLoanBtn").onclick=()=>openLoanForm(null,b.id);
  if ($("#payBtn")) $("#payBtn").onclick=()=> open.length===1 ? openPaymentForm(open[0].loan,b) : openPaymentForm(null,null,null,{borrowerId:b.id});
  if ($("#showMore")) $("#showMore").onclick=(e)=>{ $("#morePays").classList.remove("hidden"); e.target.remove(); };

  $("#archiveBtn").onclick=async()=>{
    if (!b.archived && open.length){
      const ok=await confirmAction({title:"Archive borrower?",message:`${b.name} still owes ${Utils.money(owed)} across ${open.length} open loan${open.length===1?"":"s"}. They'll be hidden from the borrower list, but the loans stay tracked.`,confirmLabel:"Archive"});
      if (!ok) return;
    }
    await DB.updateBorrower(b.id,{archived:!b.archived});
    Toast.show(b.archived?"Borrower unarchived":"Borrower archived",{type:"success"}); Router.refresh();
  };

  $("#deleteBtn").onclick=async()=>{
    if (!(await Security.promptPin("Confirm with PIN","Enter your PIN to delete this borrower."))) return;
    const ok=await confirmAction({title:"Delete borrower?",
      message:`Permanently delete ${b.name}, ${loans.length} loan(s) and ${payments.length} payment(s)? Archiving keeps the history instead.`,confirmLabel:"Delete",danger:true});
    if (!ok) return;
    const snap=await DB.deleteBorrowerCascade(b.id);
    Toast.show("Borrower deleted",{type:"success",action:{label:"Undo",onClick:async()=>{
      await DB.restoreSnapshot(snap); Toast.show("Borrower restored",{type:"success"}); Router.go("borrowerProfile",{id:b.id});
    }}});
    Router.go("borrowers");
  };

  // ----- documents -----
  const attGallery=$("#attGallery"), attCamera=$("#attCamera");
  $("#addAttBtn").onclick=()=>{
    Sheet.open({title:"Add Document",bodyHtml:`<div style="display:flex;flex-direction:column;gap:6px;">
      <div class="row" id="aGallery" role="button" tabindex="0"><div class="avatar">${Icons.image}</div><div class="meta"><div class="title">From gallery or files</div><div class="sub">Photo or PDF</div></div></div>
      <div class="row" id="aCamera" role="button" tabindex="0"><div class="avatar">${Icons.camera}</div><div class="meta"><div class="title">Take photo</div><div class="sub">Use the camera</div></div></div></div>`,
      onMount:(sheet)=>{ sheet.querySelector("#aGallery").onclick=()=>{Sheet.close();attGallery.click();}; sheet.querySelector("#aCamera").onclick=()=>{Sheet.close();attCamera.click();}; }});
  };
  async function saveAtt(file, input){
    if (!file) return; input.value="";
    if (!(file.type.startsWith("image/")||file.type==="application/pdf")){ Toast.show("Only photos and PDFs are supported",{type:"error"}); return; }
    if (file.size>10*1024*1024){ Toast.show("That file is over 10 MB",{type:"error"}); return; }
    try { await DB.addAttachment({ownerId:b.id,ownerType:"borrower",name:file.name,mime:file.type,blob:file,label:file.type.includes("pdf")?"Document":"Photo"}); Toast.show("Document added",{type:"success"}); Router.refresh(); }
    catch(e){ console.error("[attachment]",e.message); Toast.show("Couldn't save the file (storage may be full)",{type:"error"}); }
  }
  attGallery.onchange=()=>saveAtt(attGallery.files[0],attGallery); attCamera.onchange=()=>saveAtt(attCamera.files[0],attCamera);
  root.querySelectorAll("[data-att-open]").forEach(el=>el.onclick=()=>{
    const a=attachments.find(x=>x.id===el.dataset.attOpen); if(!a||!a.blob)return;
    const url=URL.createObjectURL(a.blob); window.open(url,"_blank","noopener"); setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  root.querySelectorAll("[data-att-del]").forEach(el=>el.onclick=async()=>{
    const ok=await confirmAction({title:"Delete document?",message:"This permanently removes the file from this device.",confirmLabel:"Delete",danger:true});
    if (!ok) return; await DB.delete("attachments",el.dataset.attDel); Router.refresh();
  });
};

function attachmentRow(a){
  const isPdf=a.mime&&a.mime.includes("pdf"), kb=a.blob?Math.max(1,Math.round(a.blob.size/1024)):0;
  return `<div class="row" style="cursor:default;">
    <div class="avatar">${isPdf?Icons.receipt:Icons.image}</div>
    <div class="meta"><div class="title">${Utils.escapeHtml(a.name)}</div><div class="sub">${Utils.escapeHtml(a.label)} · ${Utils.fmtDate(a.createdAt)}${kb?` · ${kb>1024?(kb/1024).toFixed(1)+" MB":kb+" KB"}`:""}</div></div>
    <div class="trail" style="display:flex;gap:6px;">
      <button class="icon-btn" data-att-open="${a.id}" aria-label="Open ${Utils.escapeHtml(a.name)}">${Icons.chev}</button>
      <button class="icon-btn" style="color:var(--red);" data-att-del="${a.id}" aria-label="Delete ${Utils.escapeHtml(a.name)}">${Icons.trash}</button></div></div>`;
}

window.openBorrowerForm=openBorrowerForm;
