/* dashboard.js v4 — "What is happening with my money, and what needs my attention?" */
window.Pages.dashboard = async function(root) {
  root.innerHTML = `
    <div class="hero-card"><div class="label">Owed to you</div>
      <div class="amount"><span class="skel" style="height:42px;width:180px;display:inline-block;border-radius:10px;"></span></div>
      <div class="meta">Loading…</div></div>
    <div class="kpi-grid" style="margin-top:12px;">${skeletonKpis(3)}</div>`;

  const [borrowers, loans, payments, activity] = await Promise.all([DB.listBorrowers(), DB.listLoans(), DB.allPayments(), DB.recentActivity(6)]);
  const lastBackup = await DB.getSetting("lastBackupAt", 0);
  const needBackup = loans.length > 0 && Date.now() - lastBackup > 7 * Utils.DAY;
  const computed = loans.map(l => ({ loan: l, c: Utils.computeLoan(l, payments.filter(p => p.loanId === l.id)) }));
  const s = Finance.summarize(loans, payments);                 // same engine as Reports → same numbers
  const openLoans = computed.filter(x => x.c.status === "active" || x.c.status === "overdue");
  const overdue = computed.filter(x => x.c.status === "overdue").sort((a,b)=>b.c.daysOverdue-a.c.daysOverdue);
  const dueSoon = computed.filter(x => x.c.status === "active" && x.c.daysRemaining >= 0 && x.c.daysRemaining <= 7).sort((a,b)=>a.c.daysRemaining-b.c.daysRemaining);
  const attention = [...overdue, ...dueSoon];

  root.innerHTML = `
    <div class="hero-card">
      <div class="label">Owed to you</div>
      <div class="amount">${Utils.money(s.totalReceivables)}</div>
      <div class="meta">${openLoans.length} open loan${openLoans.length===1?"":"s"} · principal ${Utils.money(s.outstandingPrincipal)}</div>
      ${s.overdueCount>0?`<div style="margin-top:12px;display:inline-flex;align-items:center;gap:6px;background:var(--red-soft);border-radius:20px;padding:5px 12px;font-size:12.5px;font-weight:700;color:var(--red);">
        ${Icons.warn} ${s.overdueCount} overdue · ${Utils.money(s.overdueAmount)}</div>`:""}
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-top:12px;">
      <div class="kpi"><div class="eyebrow">Collected</div><div class="val">${Utils.moneyShort(s.collected)}</div></div>
      <div class="kpi"><div class="eyebrow">Income</div><div class="val">${Utils.moneyShort(s.realizedIncome)}</div></div>
      <div class="kpi"><div class="eyebrow">Borrowers</div><div class="val">${borrowers.length}</div></div>
    </div>

    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn btn-primary" style="flex:1;" id="qaPay">Record Payment</button>
      <button class="btn btn-ghost" style="flex:1;" id="qaLoan">New Loan</button>
      <button class="btn btn-ghost" id="qaBorrower" aria-label="Add borrower">${Icons.users}</button>
    </div>

    ${needBackup?`<div class="card" style="margin-top:12px;display:flex;align-items:center;gap:12px;background:var(--orange-soft);border-color:transparent;">
      <div style="flex:1;font-size:13px;line-height:1.5;"><b>${lastBackup?"Backup is "+Math.floor((Date.now()-lastBackup)/Utils.DAY)+" days old":"No backup yet"}</b><br><span class="muted">Your records live only on this device.</span></div>
      <button class="btn btn-primary btn-sm" id="bkNow">Back up</button></div>`:""}

    <div class="section-title"><h2>Needs attention${attention.length?` <span style="background:var(--orange-soft);color:var(--orange);font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;">${attention.length}</span>`:""}</h2>
      ${attention.length?`<span class="link" id="seeLoans" role="button" tabindex="0">All loans</span>`:""}</div>
    <div class="card">
      ${attention.length===0 ? emptyState("check", loans.length?"You're all caught up":"No loans yet", loans.length?"Nothing is overdue or due in the next 7 days.":"Add a borrower, then create the first loan.")
        : attention.slice(0,6).map(x=>loanRowHtml(x.loan,x.c,borrowers)).join("")}
    </div>

    <div class="section-title"><h2>Recent activity</h2></div>
    <div class="card">
      ${activity.length===0 ? emptyState("inbox","No activity yet","Payments and loans you record will show up here.")
        : `<div class="timeline">${activity.map(a=>`
            <div class="t-item ${a.type==="payment"?"green":(a.type==="payment_void"?"red":"")}">
              <div class="when">${Utils.fmtDateTime(a.date)}</div><div class="what">${Utils.escapeHtml(a.text)}</div></div>`).join("")}</div>`}
    </div>`;

  root.querySelectorAll("[data-loan-row]").forEach(el => el.onclick = () => Router.go("loanDetail", { id: el.dataset.loanRow }));
  const $ = id => root.querySelector(id);
  if ($("#bkNow")) $("#bkNow").onclick = async () => { if (await Backup.exportFlow()) Router.refresh(); };
  $("#qaPay").onclick = () => { if (!openLoans.length) Toast.show("No open loans to pay",{type:"error"}); else openPaymentForm(null,null); };
  $("#qaLoan").onclick = () => { if (!borrowers.length) { Toast.show("Add a borrower first",{type:"error"}); openBorrowerForm(); } else openLoanForm(null,null); };
  $("#qaBorrower").onclick = () => openBorrowerForm();
  if ($("#seeLoans")) $("#seeLoans").onclick = () => { Router.stack=[{view:"loans",params:{filter:"overdue"}}]; Router.render(); };
};
