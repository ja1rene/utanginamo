// Run: npm i fake-indexeddb jsdom && node tests/ui-smoke.test.js
// Renders Dashboard / Loans / Loan Detail / Reports / payment form against real data and checks balances agree.
require("fake-indexeddb/auto");
const { JSDOM } = require("jsdom"); const fs = require("fs"); const path = require("path"); const assert = require("assert");
const dom = new JSDOM(`<!DOCTYPE html><body><div id="appMain"></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window; w.indexedDB = global.indexedDB; w.IDBKeyRange = global.IDBKeyRange;
w.Icons = new Proxy({}, { get: () => "<i></i>" });
w.Router = { go() {}, refresh() {}, stack: [], render() {} };
const load = f => w.eval(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"));
w.Pages = {}; load("finance.js"); load("utils.js"); load("db.js");
w.eval(`
 window.skeletonKpis=()=>"";window.skeletonRows=()=>"";window.emptyState=(i,t)=>'<div class="empty">'+t+'</div>';
 window.statusTag=s=>'<span class="tag '+s+'">'+s+'</span>';
 window.loanRowHtml=(l,c,bs)=>'<div class="row" data-loan-row="'+l.id+'">'+Utils.money(c.remaining)+'|'+c.status+'</div>';
 window.borrowerRowHtml=()=>"";`);
["dashboard.js","loans.js","payments.js","reports.js"].forEach(load);
const D = (y,m,d)=>new Date(y,m-1,d,12).getTime();
(async () => {
  await w.DB.init();
  const b = await w.DB.createBorrower({ name: "Ana" });
  const now = Date.now(), past = D(2026,1,1);
  const l1 = await w.DB.createLoan({ borrowerId: b.id, principal: 10000, interestType: "fixed", interestFixedAmount: 1000, dateBorrowed: past, dueDate: D(2026,3,1), penaltyType: "fixed", penaltyRate: 200, installments: 4 }); // overdue
  const l2 = await w.DB.createLoan({ borrowerId: b.id, principal: 5000, dateBorrowed: now - 86400000, dueDate: now + 5*86400000 });
  await w.DB.recordPayment({ loanId: l1.id, borrowerId: b.id, amount: 2000, date: D(2026,2,1) });
  await w.DB.recordPayment({ loanId: l2.id, borrowerId: b.id, amount: 1000, date: now });
  const mount = async (page, params) => { const r = w.document.getElementById("appMain"); r.innerHTML = ""; await w.Pages[page](r, params); await new Promise(r=>setTimeout(r,50)); return r; };

  const loans = await w.DB.listLoans(), pays = await w.DB.allPayments();
  const expectedTotal = loans.reduce((s,l)=>s+w.Finance.compute(l,pays.filter(p=>p.loanId===l.id)).remaining,0);
  let r = await mount("dashboard"); assert.ok(r.textContent.includes(w.Utils.money(expectedTotal)), "dashboard total"); console.log("ok - dashboard shows", w.Utils.money(expectedTotal));
  r = await mount("loans", {filter:"open"}); assert.equal(r.querySelectorAll("[data-loan-row]").length, 2); console.log("ok - loans list (open=2)");
  r = await mount("loans", {filter:"overdue"}); assert.equal(r.querySelectorAll("[data-loan-row]").length, 1); console.log("ok - overdue filter");
  r = await mount("loanDetail", { id: l1.id }); const c1 = w.Utils.computeLoan(await w.DB.get("loans", l1.id), await w.DB.paymentsForLoan(l1.id));
  assert.ok(r.textContent.includes(w.Utils.money(c1.remaining)) && r.textContent.includes("Record Payment") && r.textContent.includes("Installments")); console.log("ok - loan detail", w.Utils.money(c1.remaining));
  r = await mount("reports"); assert.ok(r.textContent.includes("Income received") && !r.textContent.includes("Net Profit")); console.log("ok - reports (no Net Profit)");
  r.querySelector('[data-r="all"]').click(); await new Promise(r=>setTimeout(r,50));
  const s = w.Finance.summarize(loans, pays); assert.ok(r.textContent.includes(w.Utils.moneyShort(s.totalReceivables))); console.log("ok - reports all-time receivables match dashboard engine");
  r.querySelector('[data-r="custom"]').click(); await new Promise(r=>setTimeout(r,50)); console.log("ok - custom range renders");
  await w.openPaymentForm(await w.DB.get("loans", l1.id), b); await new Promise(r=>setTimeout(r,100));
  const amt = w.document.querySelector("#pAmount"), save = w.document.querySelector("#savePayBtn");
  assert.ok(save.disabled); amt.value = "999999"; amt.dispatchEvent(new w.Event("input")); assert.ok(save.disabled && /more than is owed/.test(w.document.querySelector("#pAmtMsg").textContent));
  amt.value = "500"; amt.dispatchEvent(new w.Event("input")); assert.ok(!save.disabled && w.document.querySelector("#pAlloc").textContent.includes("Remaining after")); console.log("ok - payment form validates live + shows allocation");
  console.log("\nui smoke tests passed");
})().catch(e => { console.error(e); process.exit(1); });
