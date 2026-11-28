/* ============================================================
   payments.js v3 — validated, allocation-aware payment recording.
   All math comes from Finance. Balances/status are derived, never
   written back to the loan.
   ============================================================ */
async function openPaymentForm(loan, borrower, onDone, opts = {}) {
  let activeLoan = loan, activePayments = [];
  let borrowers = [], openLoans = [];
  let submitting = false;
  if (!loan) { borrowers = await DB.listBorrowers(); openLoans = await DB.listLoans(); }
  else activePayments = await DB.paymentsForLoan(loan.id);

  Sheet.open({
    title: "Record Payment",
    bodyHtml: `
      ${!loan ? `<div class="field"><label for="pBorrowerSel">Borrower</label><select id="pBorrowerSel"></select></div>
                 <div class="field"><label for="pLoanSel">Loan</label><select id="pLoanSel"></select></div>` : ""}
      <div class="card" id="pSummary" style="background:var(--surface-2);margin-bottom:14px;"></div>
      <div class="field"><label for="pAmount">Amount *</label>
        <div class="currency-wrap"><input id="pAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" autocomplete="off"></div>
        <div class="hint" id="pAmtMsg" role="alert"></div></div>
      <div style="display:flex;gap:8px;margin:-4px 0 12px;flex-wrap:wrap;" id="pQuick"></div>
      <div class="field-row">
        <div class="field"><label for="pDate">Date</label><input id="pDate" type="date" value="${Utils.toInputDate(Date.now())}"></div>
        <div class="field"><label for="pMethod">Method</label><select id="pMethod"><option>Cash</option><option>GCash</option><option>Bank Transfer</option><option>Maya</option><option>Palawan</option><option>Other</option></select></div>
      </div>
      <div class="field"><label for="pRef">Reference #</label><input id="pRef" placeholder="Optional"></div>
      <div id="pAlloc" style="margin-bottom:12px;display:none;"></div>
      <details style="margin-bottom:12px;"><summary>Adjust allocation (advanced)</summary>
        <div style="padding-top:8px;">
          <p class="muted" style="font-size:12px;margin:0 0 8px;">Leave blank to apply automatically: penalty → interest → principal. If you fill these in, they must add up to the payment.</p>
          <div class="field-row">
            <div class="field"><label for="pPrincipal">Principal</label><div class="currency-wrap"><input id="pPrincipal" type="number" min="0" step="0.01"></div></div>
            <div class="field"><label for="pInterest">Interest</label><div class="currency-wrap"><input id="pInterest" type="number" min="0" step="0.01"></div></div>
          </div>
          <div class="field"><label for="pPenalty">Penalty</label><div class="currency-wrap"><input id="pPenalty" type="number" min="0" step="0.01"></div></div>
        </div></details>
      <div class="field"><label for="pNotes">Notes</label><textarea id="pNotes" placeholder="Optional" style="min-height:60px;"></textarea></div>`,
    footHtml: `<button class="btn btn-primary btn-block" id="savePayBtn" disabled>Record Payment</button>`,
    onMount: async (sheet) => {
      const $ = (s) => sheet.querySelector(s);
      const money = Utils.money;

      function candidate() {
        const v = (id) => $(id).value;
        return { amount: parseFloat(v("#pAmount")), date: Utils.fromInputDate(v("#pDate")),
          principalPortion: parseFloat(v("#pPrincipal")) || 0, interestPortion: parseFloat(v("#pInterest")) || 0, penaltyPortion: parseFloat(v("#pPenalty")) || 0 };
      }
      function renderSummary() {
        if (!activeLoan) { $("#pSummary").innerHTML = `<div class="muted">No open loan selected.</div>`; $("#pQuick").innerHTML = ""; return; }
        const c = Finance.compute(activeLoan, activePayments);
        const b = borrower || borrowers.find((x) => x.id === activeLoan.borrowerId);
        $("#pSummary").innerHTML = `
          <div class="flex-between"><div><div style="font-weight:700">${Utils.escapeHtml(b?.name || "")}</div>
            <div class="muted" style="font-size:12px;">Due ${Utils.fmtDate(activeLoan.dueDate)} · ${statusTag(c.status)}</div></div>
            <div style="text-align:right"><div class="eyebrow">Outstanding</div><div class="num" style="font-weight:700;font-size:18px;">${money(c.remaining)}</div></div></div>
          ${c.penaltyRemaining > 0 ? `<div class="muted" style="font-size:12px;margin-top:6px;">Includes penalty ${money(c.penaltyRemaining)}</div>` : ""}`;
        const sched = activeLoan.installments > 0 ? Finance.scheduleStatus(Finance.buildSchedule(activeLoan), Finance.toCents(c.principalPaid + c.interestPaid)) : [];
        const nextInst = sched.find((s) => s.status !== "paid");
        $("#pQuick").innerHTML = (c.remaining > 0 ? `<button type="button" class="btn btn-ghost btn-sm" data-fill="${c.remaining}">Full ${money(c.remaining)}</button>` : "") +
          (nextInst ? `<button type="button" class="btn btn-ghost btn-sm" data-fill="${nextInst.balance}">Installment #${nextInst.index} ${money(nextInst.balance)}</button>` : "");
        $("#pQuick").querySelectorAll("[data-fill]").forEach((b) => b.onclick = () => { $("#pAmount").value = Number(b.dataset.fill).toFixed(2); validate(); });
      }
      function validate() {
        const btn = $("#savePayBtn"), msg = $("#pAmtMsg"), box = $("#pAlloc");
        if (!activeLoan) { btn.disabled = true; return null; }
        const cand = candidate();
        if (!$("#pAmount").value) { msg.textContent = ""; box.style.display = "none"; btn.disabled = true; return null; }
        const v = Finance.validatePayment(activeLoan, activePayments, cand);
        msg.textContent = v.ok ? "" : v.error; msg.style.color = v.ok ? "" : "var(--red)";
        btn.disabled = !v.ok || submitting;
        if (v.ok) {
          const a = v.allocation, row = (l, n) => n > 0 ? `<div class="ln"><span>${l}</span><i></i><b>${money(n)}</b></div>` : "";
          box.style.display = ""; box.innerHTML = `<div class="tape" style="padding:14px 16px;"><div class="k">This payment covers</div>${row("Penalty", a.penalty)}${row("Interest", a.interest)}${row("Principal", a.principal)}
            <div class="d" style="margin:8px 0;"></div><div class="ln"><b>Remaining after</b><i></i><b>${money(v.remainingAfter)}</b></div></div><div class="tape-edge"></div>`;
        } else box.style.display = "none";
        return v;
      }

      if (!loan) {
        const bSel = $("#pBorrowerSel"), lSel = $("#pLoanSel");
        const withOpen = [];
        for (const b of borrowers) {
          const ls = openLoans.filter((l) => l.borrowerId === b.id && l.status !== "archived" && l.status !== "cancelled");
          const open = []; for (const l of ls) { const p = await DB.paymentsForLoan(l.id); if (Finance.compute(l, p).remaining > 0) open.push(l); }
          if (open.length) withOpen.push({ b, open });
        }
        bSel.innerHTML = withOpen.map((x) => `<option value="${x.b.id}">${Utils.escapeHtml(x.b.name)}</option>`).join("") || `<option value="">No borrowers with open loans</option>`;
        if (opts.borrowerId && withOpen.some((x) => x.b.id === opts.borrowerId)) bSel.value = opts.borrowerId;
        const pickLoan = async () => {
          const group = withOpen.find((x) => x.b.id === bSel.value);
          lSel.innerHTML = (group?.open || []).map((l) => `<option value="${l.id}">${Utils.money(l.principal)} · due ${Utils.fmtDate(l.dueDate)}</option>`).join("");
          activeLoan = group?.open.find((l) => l.id === lSel.value) || null;
          activePayments = activeLoan ? await DB.paymentsForLoan(activeLoan.id) : [];
          renderSummary(); validate();
        };
        bSel.onchange = pickLoan;
        lSel.onchange = async () => { activeLoan = openLoans.find((l) => l.id === lSel.value) || null; activePayments = activeLoan ? await DB.paymentsForLoan(activeLoan.id) : []; renderSummary(); validate(); };
        await pickLoan();
      } else renderSummary();

      ["#pAmount", "#pDate", "#pPrincipal", "#pInterest", "#pPenalty"].forEach((id) => $(id).addEventListener("input", validate));

      $("#savePayBtn").onclick = async () => {
        if (submitting) return;
        const v = validate(); if (!v || !v.ok) return;
        submitting = true; $("#savePayBtn").disabled = true; $("#savePayBtn").textContent = "Saving…";
        try {
          const cand = candidate();
          const payment = await DB.recordPayment({
            loanId: activeLoan.id, borrowerId: activeLoan.borrowerId, amount: cand.amount, date: cand.date,
            method: $("#pMethod").value, reference: $("#pRef").value.trim(), notes: $("#pNotes").value.trim(),
            principalPortion: v.allocation.principal, interestPortion: v.allocation.interest, penaltyPortion: v.allocation.penalty,
          });
          Toast.show(payment.duplicateOf ? "Already recorded" : (v.remainingAfter === 0 ? "Payment recorded — loan fully paid" : `Payment recorded · ${money(v.remainingAfter)} left`), { type: "success" });
          Sheet.close(); if (onDone) onDone(payment); Router.refresh();
        } catch (e) {
          console.error("[payment]", e.message); submitting = false;
          $("#savePayBtn").disabled = false; $("#savePayBtn").textContent = "Record Payment";
          Toast.show("Couldn't save the payment. Nothing was changed.", { type: "error" });
        }
      };
    },
  });
}

/** Void a payment (audit-safe: record stays, excluded from balances). Optionally replace it. */
async function voidPaymentFlow(payment, loan, borrower, { replace = false } = {}) {
  const reasons = await new Promise((resolve) => {
    Sheet.open({
      title: replace ? "Correct Payment" : "Void Payment",
      bodyHtml: `<p class="muted" style="font-size:13.5px;line-height:1.6;">The original ${Utils.money(payment.amount)} payment on ${Utils.fmtDate(payment.date)} stays in the history, marked as voided, and no longer counts toward the balance.${replace ? " You'll enter the corrected payment next." : ""}</p>
        <div class="field"><label for="vReason">Reason *</label><input id="vReason" placeholder="e.g. wrong amount, duplicate"></div>`,
      footHtml: `<button class="btn btn-ghost btn-block" id="vNo">Cancel</button><button class="btn btn-danger btn-block" id="vYes">${replace ? "Void & Correct" : "Void Payment"}</button>`,
      onMount: (s) => {
        s.querySelector("#vNo").onclick = () => { Sheet.close(); resolve(null); };
        s.querySelector("#vYes").onclick = () => { const r = s.querySelector("#vReason").value.trim(); if (!r) { Toast.show("Please give a reason", { type: "error" }); return; } Sheet.close(); resolve(r); };
      },
    });
  });
  if (!reasons) return false;
  await DB.voidPayment(payment.id, reasons);
  Toast.show("Payment voided", { type: "success" });
  if (replace) setTimeout(() => openPaymentForm(loan, borrower), 320); else Router.refresh();
  return true;
}

window.openPaymentForm = openPaymentForm;
window.voidPaymentFlow = voidPaymentFlow;
