/* ============================================================
   helpers.js v3 — shared UI helpers (rows, tags, empty states).
   Rows are keyboard-reachable (role=button, tabindex=0); app.js turns
   Enter/Space on them into clicks.
   ============================================================ */
function skeletonKpis(n) {
  return Array.from({length:n}).map(()=>
    `<div class="kpi"><div class="skel" style="height:11px;width:60%;margin-bottom:10px;"></div><div class="skel" style="height:20px;width:80%;"></div></div>`).join("");
}
function skeletonRows(n) {
  return Array.from({length:n}).map(()=>`
    <div class="row" style="cursor:default;">
      <div class="skel" style="width:42px;height:42px;border-radius:50%;flex-shrink:0;"></div>
      <div class="meta" style="flex:1;"><div class="skel" style="height:12px;width:55%;margin-bottom:7px;"></div><div class="skel" style="height:10px;width:38%;"></div></div>
    </div>`).join("");
}
function emptyState(icon, title, desc, actionHtml="") {
  return `<div class="empty"><div class="glyph" aria-hidden="true">${Icons[icon]||""}</div>
    <div class="title">${Utils.escapeHtml(title)}</div>
    <div class="desc">${Utils.escapeHtml(desc)}</div>${actionHtml}</div>`;
}
function statusTag(status) {
  const map = { active:["active","Active"], overdue:["overdue","Overdue"], paid:["paid","Paid"], archived:["archived","Archived"], cancelled:["cancelled","Cancelled"] };
  const [cls, label] = map[status]||["paid", status];
  return `<span class="tag ${cls}">${label}</span>`;
}
function avatarHtml(b) {
  return b && b.photo ? `<img src="${b.photo}" alt="">` : Utils.initials(b?b.name:"?");
}

// Loan row: borrower, original amount, due date, remaining balance, status, payment progress
function loanRowHtml(loan, c, borrowers) {
  const b = borrowers.find(x => x.id === loan.borrowerId);
  const name = b ? b.name : "Unknown";
  const pct = c.totalDue > 0 ? Math.min(100, Math.round(c.paid / c.totalDue * 100)) : 0;
  const when = c.status === "paid" ? "Paid in full" : c.status === "overdue" ? `${c.daysOverdue} day${c.daysOverdue===1?"":"s"} overdue` : c.status === "archived" || c.status === "cancelled" ? "Closed" : `Due ${Utils.fmtRelative(loan.dueDate).toLowerCase()}`;
  return `
    <div class="row" data-loan-row="${loan.id}" role="button" tabindex="0" aria-label="${Utils.escapeHtml(name)}, ${Utils.money(c.remaining)} remaining, ${c.status}">
      <div class="avatar">${avatarHtml(b)}</div>
      <div class="meta">
        <div class="title">${Utils.escapeHtml(name)}</div>
        <div class="sub">${Utils.money(loan.principal)} · ${when} · ${Utils.fmtDate(loan.dueDate)}</div>
        <div class="pbar thin ${c.status==="overdue"?"red":""}" aria-hidden="true"><span style="width:${pct}%"></span></div>
      </div>
      <div class="trail">
        <div class="amt">${Utils.money(c.remaining)}</div>
        <div style="margin-top:4px;">${statusTag(c.status)}</div>
      </div>
    </div>`;
}

// Borrower row: name, active loans, amount owed, overdue flag
function borrowerRowHtml(b, loans, payments) {
  const mine = loans.filter(l => l.borrowerId === b.id);
  const computed = mine.map(l => Utils.computeLoan(l, payments.filter(p => p.loanId === l.id)));
  const open = computed.filter(c => c.status==="active"||c.status==="overdue");
  const owed = open.reduce((s,c) => s + c.remaining, 0);
  const overdue = open.filter(c => c.status==="overdue").length;
  return `
    <div class="row" data-borrower-row="${b.id}" role="button" tabindex="0" aria-label="${Utils.escapeHtml(b.name)}, owes ${Utils.money(owed)}${overdue?`, ${overdue} overdue`:""}">
      <div class="avatar">${avatarHtml(b)}</div>
      <div class="meta">
        <div class="title">${Utils.escapeHtml(b.name)}</div>
        <div class="sub">${open.length} active loan${open.length===1?"":"s"}${b.phone?` · ${Utils.escapeHtml(b.phone)}`:""}</div>
      </div>
      <div class="trail">
        <div class="amt">${Utils.money(owed)}</div>
        <div style="margin-top:4px;">${overdue?`<span class="tag overdue">${overdue} overdue</span>`:`<span class="faint" style="font-size:11.5px;">owed</span>`}</div>
      </div>
    </div>`;
}

window.skeletonKpis=skeletonKpis; window.skeletonRows=skeletonRows; window.emptyState=emptyState;
window.statusTag=statusTag; window.avatarHtml=avatarHtml; window.loanRowHtml=loanRowHtml; window.borrowerRowHtml=borrowerRowHtml;
