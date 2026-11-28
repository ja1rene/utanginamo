/* ============================================================
   loans.js v3 — All Loans, Loan Detail, loan form, receipts.
   Every figure comes from Finance via Utils.computeLoan.
   ============================================================ */

// ---------- All Loans ----------
window.Pages.loans = async function(root, params={}) {
  root.innerHTML = `
    <div class="search-bar">${Icons.search}
      <input type="search" id="lSearch" aria-label="Search loans" placeholder="Search borrower, amount, notes, reference…">
    </div>
    <div class="chip-row" id="lFilters" role="tablist">
      <button class="chip active" data-f="open">Open</button>
      <button class="chip" data-f="overdue">Overdue</button>
      <button class="chip" data-f="due7">Due in 7 days</button>
      <button class="chip" data-f="paid">Paid</button>
      <button class="chip" data-f="archived">Archived</button>
      <button class="chip" data-f="all">All</button>
    </div>
    <div id="lList"></div>`;

  let filter = params.filter || "open";
  root.querySelectorAll("#lFilters .chip").forEach(c => c.classList.toggle("active", c.dataset.f === filter));
  const listEl = root.querySelector("#lList"), input = root.querySelector("#lSearch");

  async function render() {
    const [loans, payments, borrowers, allPay] = await Promise.all([DB.listLoans(), DB.allPayments(), DB.listBorrowers({includeArchived:true}), DB.getAll("payments")]);
    const q = input.value.trim().toLowerCase();
    const computed = loans.map(l => ({ loan:l, c:Utils.computeLoan(l, payments.filter(p=>p.loanId===l.id)) }));
    const open = x => x.c.status === "active" || x.c.status === "overdue";
    let rows = computed.filter(x => {
      switch (filter) {
        case "open": return open(x);
        case "overdue": return x.c.status === "overdue";
        case "paid": return x.c.status === "paid";
        case "archived": return x.c.status === "archived" || x.c.status === "cancelled";
        case "due7": return x.c.status === "active" && x.c.daysRemaining >= 0 && x.c.daysRemaining <= 7;
        default: return true;
      }
    });
    if (q) rows = rows.filter(x => {
      const b = borrowers.find(b=>b.id===x.loan.borrowerId);
      const refs = allPay.filter(p=>p.loanId===x.loan.id).map(p=>p.reference).join(" ");
      return [b?.name, b?.nickname, b?.phone, String(x.loan.principal), x.loan.notes, refs].some(f=>(f||"").toLowerCase().includes(q));
    });
    const rank = x => x.c.status==="overdue"?0:(x.c.status==="active"?1:2);
    rows.sort((a,b)=> rank(a)-rank(b) || a.loan.dueDate-b.loan.dueDate);

    if (!rows.length) {
      const msg = q ? "Try a different search term." : ({open:"No open loans. Tap + to create one.",overdue:"Nothing is overdue. 🎉",due7:"Nothing due in the next 7 days.",paid:"No fully paid loans yet.",archived:"No archived loans.",all:"Tap + to create your first loan."})[filter];
      listEl.innerHTML = `<div class="card">${emptyState("wallet", q?"No results":"No loans here", msg)}</div>`; return;
    }
    listEl.innerHTML = `<div class="card">${rows.map(x=>loanRowHtml(x.loan,x.c,borrowers)).join("")}</div>`;
    listEl.querySelectorAll("[data-loan-row]").forEach(el=>el.onclick=()=>Router.go("loanDetail",{id:el.dataset.loanRow}));
  }
  input.addEventListener("input", Utils.debounce(render,200));
  root.querySelectorAll("#lFilters .chip").forEach(chip=>{
    chip.onclick=()=>{ root.querySelectorAll("#lFilters .chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); filter=chip.dataset.f; render(); };
  });
  render();
};

function penaltyText(loan) {
  if (!loan.penaltyType || loan.penaltyType === "none") return "No late penalty";
  const r = Number(loan.penaltyRate) || 0;
  return loan.penaltyType === "percent" ? `${r}% one-time penalty on the unpaid balance at the due date` : `${Utils.money(r)} one-time penalty if unpaid after the due date`;
}
function allocLine(a) {
  if (!a) return "";
  const parts = [["Penalty",a.penalty],["Interest",a.interest],["Principal",a.principal]].filter(x=>x[1]>0);
  if (a.credit > 0) parts.push(["Credit",a.credit]);
  return parts.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:3px;font-size:11.5px;color:var(--text-faint);">${parts.map(([l,n])=>`<span>${l}: ${Utils.money(n)}</span>`).join("")}</div>` : "";
}

// ---------- Loan Detail ----------
window.Pages.loanDetail = async function(root, params) {
  const loan = await DB.get("loans", params.id);
  if (!loan) { root.innerHTML = emptyState("wallet","Loan not found","It may have been deleted."); return; }
  const b = await DB.get("borrowers", loan.borrowerId);
  const payments = await DB.paymentsForLoan(loan.id);              // includes voided (history)
  const c = Utils.computeLoan(loan, payments);
  const pctPaid = c.totalDue>0 ? Math.min(100,(c.paid/c.totalDue)*100) : 0;
  const sched = loan.installments > 0 ? Finance.scheduleStatus(Finance.buildSchedule(loan), Finance.toCents(c.principalPaid + c.interestPaid)) : [];
  const closed = c.status==="archived" || c.status==="cancelled";
  const open = c.remaining > 0 && !closed;

  root.innerHTML = `
    <div class="card" style="display:flex;align-items:center;gap:14px;cursor:pointer;" id="borrowerLink" role="link" tabindex="0">
      <div class="avatar">${b?.photo?`<img src="${b.photo}" alt="">`:Utils.initials(b?.name||"?")}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:15.5px;">${Utils.escapeHtml(b?b.name:"Unknown")}</div>
        <div class="muted" style="font-size:12.5px;">Borrowed ${Utils.fmtDate(loan.dateBorrowed)} · Due ${Utils.fmtDate(loan.dueDate)}</div>
      </div>
      ${statusTag(c.status)}
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:16px;">
        ${Utils.coinRing(pctPaid,60,7,c.status==="overdue"?"var(--red)":"var(--green)")}
        <div style="flex:1;">
          <div class="eyebrow">Remaining Balance</div>
          <div class="serif" style="font-size:36px;line-height:1.1;letter-spacing:-.02em;">${Utils.money(c.remaining)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">of ${Utils.money(c.totalDue)} total due · ${Utils.money(c.paid)} paid</div>
        </div>
      </div>
      ${c.status==="overdue"?`<div style="margin-top:10px;font-size:12.5px;color:var(--red);font-weight:600;">${Icons.warn.replace("<svg","<svg style='width:14px;height:14px;vertical-align:-2px'")} ${c.daysOverdue} day${c.daysOverdue===1?"":"s"} overdue</div>`:""}
      ${open?`<button class="btn btn-primary btn-block" id="addPayBtn" style="margin-top:14px;">Record Payment</button>`:""}
      ${c.credit>0?`<div class="muted" style="font-size:12px;margin-top:10px;">Overpaid by ${Utils.money(c.credit)} (unapplied credit from an older payment).</div>`:""}
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="eyebrow">Principal left</div><div class="val">${Utils.moneyShort(c.principalRemaining)}</div></div>
      <div class="kpi"><div class="eyebrow">Interest left</div><div class="val">${Utils.moneyShort(c.interestRemaining)}</div></div>
      <div class="kpi"><div class="eyebrow">Penalty left</div><div class="val" style="${c.penaltyRemaining>0?"color:var(--red)":""}">${Utils.moneyShort(c.penaltyRemaining)}</div></div>
      <div class="kpi"><div class="eyebrow">${c.status==="overdue"?"Days overdue":(c.daysRemaining>=0?"Days left":"Past due")}</div><div class="val">${Math.abs(c.daysRemaining)}</div></div>
    </div>

    <div class="section-title"><h2>How this is calculated</h2></div>
    <div class="tape">
      <div class="tape-title">LOAN #${loan.id.slice(-6).toUpperCase()}</div>
      <div class="tape-sub">${Utils.fmtDate(loan.dateBorrowed)} → ${Utils.fmtDate(loan.dueDate)}</div><div class="d"></div>
      <div class="ln"><span>Principal</span><i></i><b>${Utils.money(c.principal)}</b></div>
      <div class="ln"><span>Interest</span><i></i><b>${Utils.money(c.interest)}</b></div>
      <div class="k" style="margin:-2px 0 6px;text-transform:none;letter-spacing:0;">${Utils.escapeHtml(Finance.explainInterest(loan, Utils.money))}</div>
      <div class="ln"><span>Penalty</span><i></i><b>${Utils.money(c.penalty)}</b></div>
      <div class="k" style="margin:-2px 0 6px;text-transform:none;letter-spacing:0;">${Utils.escapeHtml(penaltyText(loan))}</div>
      <div class="d"></div>
      <div class="ln"><b>TOTAL DUE</b><i></i><b>${Utils.money(c.totalDue)}</b></div>
      <div class="ln"><span>Paid so far</span><i></i><b>-${Utils.money(c.paid)}</b></div>
      <div class="ln"><b>REMAINING</b><i></i><b class="${c.status==="overdue"?"neg":""}">${Utils.money(c.remaining)}</b></div>
      <div class="k" style="margin-top:10px;text-transform:none;letter-spacing:0;">Payments are applied to penalty first, then interest, then principal.</div>
    </div><div class="tape-edge"></div>

    ${loan.notes?`<div class="card" style="margin-top:10px;"><div class="eyebrow" style="margin-bottom:6px;">Notes</div><div style="font-size:13.5px;line-height:1.5;">${Utils.escapeHtml(loan.notes)}</div></div>`:""}

    ${sched.length ? renderScheduleCard(sched) : ""}

    <div class="section-title"><h2>Payment History (${payments.filter(p=>!p.voidedAt).length})</h2></div>
    <div class="card">
      ${payments.length===0 ? emptyState("receipt","No payments yet","Record this borrower's first payment.") :
        payments.map(p=>{
          const v = !!p.voidedAt, a = c.allocations[p.id];
          return `<div class="row" style="cursor:default;align-items:flex-start;${v?"opacity:.55;":""}">
            <div class="avatar" style="background:${v?"var(--surface-3)":"var(--green-soft)"};color:${v?"var(--text-faint)":"var(--green)"};">${Icons.receipt}</div>
            <div class="meta">
              <div class="title" style="${v?"text-decoration:line-through;":""}">${Utils.money(p.amount)} ${v?`<span class="tag archived">Voided</span>`:""}</div>
              <div class="sub">${Utils.fmtDate(p.date)} · ${Utils.escapeHtml(p.method||"Cash")}${p.reference?` · Ref ${Utils.escapeHtml(p.reference)}`:""}</div>
              ${v?`<div class="sub">Voided ${Utils.fmtDate(p.voidedAt)}${p.voidReason?` — ${Utils.escapeHtml(p.voidReason)}`:""}</div>`:allocLine(a)}
              ${p.notes&&!v?`<div class="sub">${Utils.escapeHtml(p.notes)}</div>`:""}
            </div>
            ${v?"":`<div class="trail" style="display:flex;gap:4px;">
              <button class="icon-btn" style="width:36px;height:36px;" data-receipt="${p.id}" aria-label="Receipt">${Icons.download}</button>
              <button class="icon-btn" style="width:36px;height:36px;" data-correct="${p.id}" aria-label="Correct payment">${Icons.edit}</button>
              <button class="icon-btn" style="width:36px;height:36px;color:var(--red);" data-void="${p.id}" aria-label="Void payment">${Icons.trash}</button></div>`}
          </div>`; }).join("")}
    </div>

    <div class="section-title"><h2>Manage</h2></div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-ghost btn-block" id="editLoanBtn">Edit Loan</button>
      ${open?`<button class="btn btn-ghost btn-block" id="calLoanBtn">${Icons.calendar}&nbsp;Add reminders to calendar</button>`:""}
      <button class="btn btn-ghost btn-block" id="archiveLoanBtn">${closed?"Reopen Loan":"Archive Loan"}</button>
      <button class="btn btn-danger btn-block" id="delLoanBtn">Delete Loan</button>
    </div>`;

  const q = s => root.querySelector(s);
  if (b) { q("#borrowerLink").onclick = () => Router.go("borrowerProfile",{id:b.id}); }
  if (q("#addPayBtn")) q("#addPayBtn").onclick = () => openPaymentForm(loan,b);
  q("#editLoanBtn").onclick = () => openLoanForm(loan, loan.borrowerId);
  if (q("#calLoanBtn")) q("#calLoanBtn").onclick = () => Ics.openSheet([loan.id]);
  q("#archiveLoanBtn").onclick = async () => {
    const next = closed ? "active" : "archived";
    await DB.updateLoan(loan.id, { status:next }, closed ? "Loan reopened" : "Loan archived");
    Toast.show(closed?"Loan reopened":"Loan archived",{type:"success"}); Router.refresh();
  };
  root.querySelectorAll("[data-receipt]").forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); showReceipt(payments.find(p=>p.id===el.dataset.receipt),loan,b); });
  root.querySelectorAll("[data-void]").forEach(el=>el.onclick=()=>voidPaymentFlow(payments.find(p=>p.id===el.dataset.void),loan,b));
  root.querySelectorAll("[data-correct]").forEach(el=>el.onclick=()=>voidPaymentFlow(payments.find(p=>p.id===el.dataset.correct),loan,b,{replace:true}));

  q("#delLoanBtn").onclick = async () => {
    if (!(await Security.promptPin("Confirm with PIN","Enter your PIN to delete this loan."))) return;
    const ok = await confirmAction({title:"Delete Loan?",message:`Permanently delete this loan and its ${payments.length} payment record(s)? To keep the history, archive it instead.`,confirmLabel:"Delete",danger:true});
    if (!ok) return;
    const snap = await DB.deleteLoanCascade(loan.id);
    Toast.show("Loan deleted",{type:"success",action:{label:"Undo",onClick:async()=>{
      await DB.restoreSnapshot(snap); Toast.show("Loan restored",{type:"success"}); Router.go("loanDetail",{id:loan.id});
    }}});
    Router.go(loan.borrowerId?"borrowerProfile":"loans", loan.borrowerId?{id:loan.borrowerId}:{});
  };
};

function renderScheduleCard(sched) {
  const paidCount = sched.filter(s=>s.status==="paid").length;
  const label = {paid:"Paid",partial:"Partly paid",overdue:"Overdue",pending:"Upcoming"};
  return `
    <div class="section-title"><h2>Installments</h2><span class="muted" style="font-size:12px;">${paidCount}/${sched.length} paid</span></div>
    <div class="card">
      <div class="pbar" style="margin-bottom:12px;"><span style="width:${Math.round(paidCount/sched.length*100)}%"></span></div>
      ${sched.map(s=>`
        <div class="row" style="cursor:default;">
          <div class="avatar" style="${s.status==="paid"?"background:var(--green-soft);color:var(--green)":(s.status==="overdue"?"background:var(--red-soft);color:var(--red)":"background:var(--surface-3);")}">
            ${s.status==="paid"?Icons.check:(s.status==="overdue"?Icons.warn:s.index)}</div>
          <div class="meta">
            <div class="title">#${s.index} of ${s.totalInstallments} — ${Utils.money(s.amount)}</div>
            <div class="sub">${label[s.status]} · due ${Utils.fmtDate(s.dueDate)}${s.status==="partial"||(s.status==="overdue"&&s.paid>0)?` · ${Utils.money(s.paid)} paid`:""}</div>
          </div>
        </div>`).join("")}
      <div class="faint" style="font-size:11.5px;margin-top:8px;">Installment status follows your recorded payments (principal + interest), oldest first.</div>
    </div>`;
}

// ---------- Add / Edit Loan form ----------
async function openLoanForm(existing, borrowerId) {
  const l = existing || {};
  const borrowers = await DB.listBorrowers();
  if (!borrowers.length) { Toast.show("Add a borrower first",{type:"error"}); return; }
  const defaultBorrower = borrowerId || l.borrowerId || borrowers[0].id;
  if (!existing) {
    const [dt, dr, dp] = await Promise.all([DB.getSetting("defaultInterestType","none"),DB.getSetting("defaultInterestRate",0),DB.getSetting("defaultPenaltyType","none")]);
    l.interestType = dt; l.interestRate = dr || ""; l.penaltyType = dp;
  }
  const customInit = l.installments && ![0,4,6,12].includes(l.installments);

  Sheet.open({
    title: existing?"Edit Loan":"New Loan",
    bodyHtml:`
      ${existing?`<div class="card" style="background:var(--surface-2);font-size:12.5px;margin-bottom:14px;">Payments already recorded are kept. Changing terms recalculates the balance and installments.</div>`:""}
      <div class="field"><label for="lBorrower">Borrower *</label>
        <select id="lBorrower">${borrowers.map(b=>`<option value="${b.id}" ${b.id===defaultBorrower?"selected":""}>${Utils.escapeHtml(b.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="lPrincipal">Principal Amount *</label>
        <div class="currency-wrap"><input id="lPrincipal" type="number" inputmode="decimal" min="0" step="0.01" value="${l.principal||""}" placeholder="0.00"></div></div>
      <div class="field"><label for="lIntType">Interest</label>
        <select id="lIntType"><option value="none">No Interest</option><option value="flat">Flat (one-time %)</option><option value="monthly">Monthly %</option><option value="weekly">Weekly %</option><option value="daily">Daily %</option><option value="percent">Custom % (one-time)</option><option value="fixed">Fixed Amount</option></select></div>
      <div class="field-row">
        <div class="field" id="lRateWrap"><label for="lRate">Rate (%)</label><input id="lRate" type="number" inputmode="decimal" min="0" step="0.01" value="${l.interestRate||""}" placeholder="0"></div>
        <div class="field hidden" id="lFixedWrap"><label for="lFixed">Fixed Interest</label><div class="currency-wrap"><input id="lFixed" type="number" inputmode="decimal" min="0" step="0.01" value="${l.interestFixedAmount||""}"></div></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="lDateB">Date Borrowed</label><input id="lDateB" type="date" value="${Utils.toInputDate(l.dateBorrowed)}"></div>
        <div class="field"><label for="lDateD">Due Date</label><input id="lDateD" type="date" value="${Utils.toInputDate(l.dueDate||Date.now()+30*Utils.DAY)}"></div>
      </div>
      <div class="field"><label for="lPenType">Late Penalty</label>
        <select id="lPenType"><option value="none">No Penalty</option><option value="percent">% of unpaid balance (one-time)</option><option value="fixed">Fixed amount (one-time)</option></select></div>
      <div class="field hidden" id="lPenRateWrap"><label for="lPenRate" id="lPenLabel">Penalty</label><input id="lPenRate" type="number" inputmode="decimal" min="0" step="0.01" value="${l.penaltyRate||""}"></div>

      <div class="divider"></div>
      <div class="field"><label>Installments <span class="faint">(optional)</span></label>
        <div class="seg" id="installSeg">
          <button type="button" data-n="0" class="${!l.installments?"active":""}">None</button>
          <button type="button" data-n="4" class="${l.installments===4?"active":""}">4x</button>
          <button type="button" data-n="6" class="${l.installments===6?"active":""}">6x</button>
          <button type="button" data-n="12" class="${l.installments===12?"active":""}">12x</button>
          <button type="button" data-n="custom" class="${customInit?"active":""}">Custom</button>
        </div></div>
      <div class="field-row" id="installWrap">
        <div class="field" id="installNWrap"><label for="lInstN"># of Installments</label><input id="lInstN" type="number" inputmode="numeric" min="2" max="120" value="${customInit?l.installments:""}"></div>
        <div class="field"><label for="lInstFreq">Frequency</label>
          <select id="lInstFreq"><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></div>
      </div>
      <div class="field"><label for="lNotes">Notes</label><textarea id="lNotes" placeholder="Purpose, collateral, agreement…">${Utils.escapeHtml(l.notes||"")}</textarea></div>

      <div class="card" style="background:var(--surface-2);">
        <div class="eyebrow" style="margin-bottom:8px;">Live Calculation</div>
        <div class="flex-between" style="margin-bottom:4px;"><span class="muted" style="font-size:13px;">Interest</span><span id="calcInterest" class="num" style="font-weight:700;"></span></div>
        <div class="faint" id="calcExplain" style="font-size:11.5px;margin-bottom:8px;"></div>
        <div class="flex-between" style="margin-bottom:6px;"><span class="muted" style="font-size:13px;">Total Due</span><span id="calcTotal" class="num" style="font-weight:700;color:var(--green);"></span></div>
        <div class="flex-between" id="calcInstRow" style="display:none;"><span class="muted" style="font-size:13px;">Per Installment</span><span id="calcInst" class="num" style="font-weight:700;"></span></div>
        <div class="faint" id="calcLast" style="font-size:11.5px;margin-top:6px;"></div>
      </div>`,
    footHtml:`<button class="btn btn-primary btn-block" id="saveLoanBtn">${existing?"Save Changes":"Create Loan"}</button>`,
    onMount:(sheet)=>{
      const $ = id => sheet.querySelector(id);
      const intType=$("#lIntType"), penType=$("#lPenType");
      intType.value=l.interestType||"none"; penType.value=l.penaltyType||"none"; $("#lInstFreq").value=l.installmentFreq||"monthly";
      let installN=l.installments||0, custom=!!customInit;

      function draft(){
        return { principal:parseFloat($("#lPrincipal").value)||0, interestType:intType.value, interestRate:parseFloat($("#lRate").value)||0,
          interestFixedAmount:parseFloat($("#lFixed").value)||0, dateBorrowed:Utils.fromInputDate($("#lDateB").value), dueDate:Utils.fromInputDate($("#lDateD").value),
          installments:installN, installmentFreq:$("#lInstFreq").value };
      }
      function syncVis(){
        $("#lFixedWrap").classList.toggle("hidden",intType.value!=="fixed");
        $("#lRateWrap").classList.toggle("hidden",intType.value==="fixed"||intType.value==="none");
        $("#lPenRateWrap").classList.toggle("hidden",penType.value==="none");
        $("#lPenLabel").textContent=penType.value==="percent"?"Penalty (%)":"Penalty Amount";
        $("#installWrap").style.display=installN>0||custom?"":"none";
        $("#installNWrap").style.display=custom?"":"none";
        $("#calcInstRow").style.display=installN>0?"flex":"none";
      }
      function recalc(){
        const d=draft(), c=Finance.compute({...d,penaltyType:"none",status:"active"},[],d.dateBorrowed);
        $("#calcInterest").textContent=Utils.money(c.interest);
        $("#calcExplain").textContent=Finance.explainInterest(d,Utils.money);
        $("#calcTotal").textContent=Utils.money(c.totalDue);
        if (installN>0) {
          $("#calcInst").textContent=Utils.money(c.totalDue/installN);
          const sch=Finance.buildSchedule({...d,installments:installN}), last=sch[sch.length-1];
          $("#calcLast").textContent=last?`Last installment: ${Utils.fmtDate(last.dueDate)}${last.dueDate>d.dueDate+Utils.DAY?" — later than your due date":""}`:"";
        } else $("#calcLast").textContent="";
      }
      syncVis(); recalc();
      intType.onchange=()=>{syncVis();recalc();}; penType.onchange=syncVis;
      ["#lPrincipal","#lRate","#lFixed","#lDateB","#lDateD","#lInstFreq"].forEach(id=>$(id).addEventListener("input",recalc));
      sheet.querySelectorAll("#installSeg button").forEach(btn=>{
        btn.onclick=()=>{
          sheet.querySelectorAll("#installSeg button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
          const v=btn.dataset.n; custom=v==="custom"; installN=custom?(parseInt($("#lInstN").value)||0):(parseInt(v)||0);
          syncVis(); recalc();
        };
      });
      $("#lInstN").addEventListener("input",()=>{ installN=parseInt($("#lInstN").value)||0; recalc(); });

      let saving=false;
      $("#saveLoanBtn").onclick=async()=>{
        if (saving) return;
        const d=draft();
        if (!(d.principal>0)){Toast.show("Enter a valid principal amount",{type:"error"});return;}
        if (d.dueDate<d.dateBorrowed){Toast.show("Due date can't be before the date borrowed",{type:"error"});return;}
        if (custom&&installN<2){Toast.show("Custom installments must be at least 2",{type:"error"});return;}
        if ((intType.value!=="none"&&intType.value!=="fixed"&&d.interestRate<=0)){Toast.show("Enter an interest rate (or choose No Interest)",{type:"error"});return;}
        saving=true; $("#saveLoanBtn").disabled=true;
        const data={ borrowerId:$("#lBorrower").value, principal:d.principal, interestType:d.interestType,
          interestRate:intType.value==="fixed"||intType.value==="none"?0:d.interestRate, interestFixedAmount:intType.value==="fixed"?d.interestFixedAmount:0,
          dateBorrowed:d.dateBorrowed, dueDate:d.dueDate, penaltyType:penType.value, penaltyRate:penType.value==="none"?0:(parseFloat($("#lPenRate").value)||0),
          installments:installN, installmentFreq:d.installmentFreq, notes:$("#lNotes").value.trim() };
        try {
          if (existing){ await DB.updateLoan(existing.id,data,`Edited loan terms (${Utils.money(data.principal)})`); Toast.show("Loan updated",{type:"success"}); }
          else { await DB.createLoan(data); Toast.show("Loan created",{type:"success"}); }
          Sheet.close(); Router.refresh();
        } catch(e){ console.error("[loan]",e.message); saving=false; $("#saveLoanBtn").disabled=false; Toast.show("Couldn't save the loan. Nothing was changed.",{type:"error"}); }
      };
    },
  });
}

// ---------- Receipt ----------
async function showReceipt(payment, loan, borrower) {
  if (!payment) return;
  const all = await DB.paymentsForLoan(loan.id);
  const full = Finance.compute(loan, all);
  const a = full.allocations[payment.id] || {};
  const upTo = all.filter(p=>!p.voidedAt && (p.date<payment.date || (p.date===payment.date && (p.createdAt||0)<=(payment.createdAt||0))));
  const after = Finance.compute(loan, upTo, payment.date);
  const ref = loan.id.slice(-6).toUpperCase();
  const rows = [["Borrower",borrower?.name||"—"],["Loan ref","#"+ref],["Date",Utils.fmtDate(payment.date)],["Method",payment.method||"Cash"]];
  if (payment.reference) rows.push(["Reference",payment.reference]);
  const alloc = [["Penalty",a.penalty],["Interest",a.interest],["Principal",a.principal]].filter(x=>x[1]>0);
  const row = ([k,v],s="") => `<div class="flex-between" ${s}><span class="muted">${Utils.escapeHtml(k)}</span><span>${Utils.escapeHtml(String(v))}</span></div>`;
  Sheet.open({ title:"Payment Receipt",
    bodyHtml:`<div class="tape"><div class="tape-title">UTANGINAMO</div><div class="tape-sub">PAYMENT RECEIPT · LOAN #${ref}</div>
      <div class="d"></div>
      ${rows.filter(r=>r[0]!=="Loan ref").map(([k,v])=>`<div class="ln"><span>${Utils.escapeHtml(k)}</span><i></i><b>${Utils.escapeHtml(String(v))}</b></div>`).join("")}<div class="d"></div>
      <div style="position:relative;"><div class="k">Amount paid</div><div class="big">${Utils.money(payment.amount)}</div>
        <div class="stamp" style="top:4px;right:0;">${after.remaining===0?"PAID IN FULL":"RECEIVED"}</div></div>
      ${alloc.map(([k,v])=>`<div class="ln"><span>↳ ${k}</span><i></i><b>${Utils.money(v)}</b></div>`).join("")}<div class="d"></div>
      <div class="ln"><span>Balance after</span><i></i><b>${Utils.money(after.remaining)}</b></div>
      ${payment.notes?`<div class="d"></div><div class="k" style="text-transform:none;letter-spacing:0;">${Utils.escapeHtml(payment.notes)}</div>`:""}</div><div class="tape-edge"></div>`,
    footHtml:`<button class="btn btn-primary btn-block" id="printReceipt">${Icons.download}&nbsp;Print / Save PDF</button>`,
    onMount:(sheet)=>{
      sheet.querySelector("#printReceipt").onclick=()=>{
        const w=window.open("","_blank"); if(!w){Toast.show("Allow pop-ups to print",{type:"error"});return;}
        const line=([k,v])=>`<div class="r"><span class="m">${Utils.escapeHtml(k)}</span><span>${Utils.escapeHtml(String(v))}</span></div>`;
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt — Utanginamo</title>
          <style>@page{margin:20mm}body{font-family:monospace;max-width:340px;margin:0 auto;padding:20px;color:#111}.r{display:flex;justify-content:space-between;margin:6px 0}.d{border-top:1px dashed #999;margin:12px 0}.m{color:#666}.big{font-size:1.25em;font-weight:bold}</style></head><body>
          <div style="text-align:center;font-weight:bold;letter-spacing:.1em">UTANGINAMO RECEIPT</div><div class="d"></div>
          ${rows.map(line).join("")}<div class="d"></div>
          <div class="r big"><span>Amount Paid</span><span>${Utils.escapeHtml(Utils.money(payment.amount))}</span></div>
          ${alloc.map(([k,v])=>line(["↳ "+k,Utils.money(v)])).join("")}<div class="d"></div>
          ${line(["Balance after",Utils.money(after.remaining)])}
          ${payment.notes?`<div class="d"></div><div>${Utils.escapeHtml(payment.notes)}</div>`:""}</body></html>`);
        w.document.close(); w.focus(); w.print();
      };
    },
  });
}

window.openLoanForm=openLoanForm;
window.showReceipt=showReceipt;
