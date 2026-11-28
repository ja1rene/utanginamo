/* ============================================================
   calendar.js v3 — due dates, installment dates and payments are
   visually distinct, each with its own marker shape + text legend.
   ============================================================ */
let _calCursor = new Date();
let _calSelected = null;

window.Pages.calendar = async function (root) {
  const [loans, payments, borrowers] = await Promise.all([DB.listLoans(), DB.allPayments(), DB.listBorrowers({ includeArchived: true })]);
  const model = loans.filter(l => l.status !== "archived" && l.status !== "cancelled").map(l => {
    const c = Utils.computeLoan(l, payments.filter(p => p.loanId === l.id));
    const sched = l.installments > 0 ? Finance.scheduleStatus(Finance.buildSchedule(l), Finance.toCents(c.principalPaid + c.interestPaid)) : [];
    return { loan: l, c, sched };
  });
  const key = ts => Utils.toInputDate(ts);
  const events = {};   // yyyy-mm-dd -> { due:[], inst:[], paid:[] }
  const slot = k => (events[k] = events[k] || { due: [], inst: [], paid: [] });
  model.forEach(x => {
    if (x.c.status === "active" || x.c.status === "overdue") slot(key(x.loan.dueDate)).due.push(x);
    x.sched.filter(s => s.status !== "paid").forEach(s => slot(key(s.dueDate)).inst.push({ ...x, s }));
  });
  payments.forEach(p => slot(key(p.date)).paid.push(p));
  const nameOf = id => (borrowers.find(b => b.id === id) || {}).name || "Borrower";

  function draw() {
    const year = _calCursor.getFullYear(), month = _calCursor.getMonth();
    const first = new Date(year, month, 1), lead = first.getDay(), dim = new Date(year, month + 1, 0).getDate();
    const todayKey = key(Date.now());
    const cells = []; for (let i = 0; i < lead; i++) cells.push(null); for (let d = 1; d <= dim; d++) cells.push(d);
    const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    root.innerHTML = `
      <div class="card">
        <div class="flex-between" style="margin-bottom:12px;">
          <button class="icon-btn" id="calPrev" aria-label="Previous month">${Icons.back}</button>
          <div style="text-align:center;"><div style="font-weight:650;font-size:16px;" aria-live="polite">${first.toLocaleDateString(Utils.DATE_LOCALE,{month:"long",year:"numeric"})}</div>
            <button class="link" id="calToday" style="background:none;border:none;color:var(--green);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px;">Today</button></div>
          <button class="icon-btn" id="calNext" aria-label="Next month" style="transform:rotate(180deg);">${Icons.back}</button>
        </div>
        <div class="cal-grid" role="grid">
          ${dows.map(d => `<div class="cal-dow" role="columnheader" aria-label="${d}">${d[0]}</div>`).join("")}
          ${cells.map(d => {
            if (!d) return `<div class="cal-cell empty-cell" aria-hidden="true"></div>`;
            const k = key(new Date(year, month, d).getTime()), e = events[k] || { due: [], inst: [], paid: [] };
            const od = e.due.filter(x => x.c.status === "overdue").length, du = e.due.length - od;
            const io = e.inst.length;
            const parts = [od && `${od} overdue`, du && `${du} due`, io && `${io} installment${io>1?"s":""}`, e.paid.length && `${e.paid.length} payment${e.paid.length>1?"s":""}`].filter(Boolean);
            const marks = [od ? `<i class="mk overdue"></i>` : "", du ? `<i class="mk due"></i>` : "", io ? `<i class="mk inst"></i>` : "", e.paid.length ? `<i class="mk paid"></i>` : ""].join("");
            const label = `${new Date(year, month, d).toLocaleDateString(Utils.DATE_LOCALE,{weekday:"long",month:"long",day:"numeric"})}${parts.length ? ": " + parts.join(", ") : ""}`;
            return `<button class="cal-cell ${k === todayKey ? "today" : ""} ${k === _calSelected ? "selected" : ""}" data-key="${k}" aria-label="${label}" ${k === todayKey ? 'aria-current="date"' : ""}>${d}<span class="marks" aria-hidden="true">${marks}</span></button>`;
          }).join("")}
        </div>
        <div class="legend" aria-label="Legend">
          <span><i class="mk overdue"></i>Overdue loan</span><span><i class="mk due"></i>Loan due</span>
          <span><i class="mk inst"></i>Installment</span><span><i class="mk paid"></i>Payment received</span>
        </div>
      </div>
      <div class="section-title"><h2 id="dayTitle">Selected day</h2></div>
      <div class="card" id="calDayDetail"></div>`;

    root.querySelector("#calPrev").onclick = () => { _calCursor = new Date(year, month - 1, 1); draw(); };
    root.querySelector("#calNext").onclick = () => { _calCursor = new Date(year, month + 1, 1); draw(); };
    root.querySelector("#calToday").onclick = () => { _calCursor = new Date(); _calSelected = todayKey; draw(); };
    root.querySelectorAll(".cal-cell[data-key]").forEach(el => el.onclick = () => {
      _calSelected = el.dataset.key;
      root.querySelectorAll(".cal-cell.selected").forEach(c => c.classList.remove("selected")); el.classList.add("selected");
      showDay(_calSelected);
    });
    showDay(_calSelected);
  }

  function showDay(k) {
    const card = root.querySelector("#calDayDetail"), title = root.querySelector("#dayTitle");
    if (!k) { title.textContent = "Selected day"; card.innerHTML = emptyState("calendar", "Pick a date", "Tap a day to see loans due, installments and payments."); return; }
    const [y, m, d] = k.split("-").map(Number), dt = new Date(y, m - 1, d, 12);
    title.textContent = dt.toLocaleDateString(Utils.DATE_LOCALE, { weekday: "long", month: "long", day: "numeric" });
    const e = events[k] || { due: [], inst: [], paid: [] };
    if (!e.due.length && !e.inst.length && !e.paid.length) { card.innerHTML = emptyState("calendar", "Nothing scheduled", "No loans due, installments or payments on this day."); return; }
    const sec = (label, html) => html ? `<div class="eyebrow" style="margin:6px 4px 2px;">${label}</div>${html}` : "";
    card.innerHTML =
      sec("Loans due", e.due.map(x => loanRowHtml(x.loan, x.c, borrowers)).join("")) +
      sec("Installments due", e.inst.map(x => `
        <div class="row" data-loan-row="${x.loan.id}" role="button" tabindex="0">
          <div class="avatar" style="background:var(--blue-soft);color:var(--blue);">${x.s.index}</div>
          <div class="meta"><div class="title">${Utils.escapeHtml(nameOf(x.loan.borrowerId))}</div>
            <div class="sub">Installment ${x.s.index} of ${x.s.totalInstallments}${x.s.status === "overdue" ? " · overdue" : ""}${x.s.status === "partial" || x.s.paid > 0 ? ` · ${Utils.money(x.s.paid)} paid` : ""}</div></div>
          <div class="trail"><div class="amt">${Utils.money(x.s.balance)}</div></div></div>`).join("")) +
      sec("Payments received", e.paid.map(p => `
        <div class="row" data-loan-row="${p.loanId}" role="button" tabindex="0">
          <div class="avatar" style="background:var(--green-soft);color:var(--green);">${Icons.receipt}</div>
          <div class="meta"><div class="title">${Utils.escapeHtml(nameOf(p.borrowerId))}</div><div class="sub">${Utils.escapeHtml(p.method || "Cash")}${p.reference ? " · Ref " + Utils.escapeHtml(p.reference) : ""}</div></div>
          <div class="trail"><div class="amt" style="color:var(--green);">${Utils.money(p.amount)}</div></div></div>`).join(""));
    card.querySelectorAll("[data-loan-row]").forEach(el => el.onclick = () => Router.go("loanDetail", { id: el.dataset.loanRow }));
  }

  if (!_calSelected) _calSelected = key(Date.now());
  draw();
};
