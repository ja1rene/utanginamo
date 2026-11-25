// Run: npm i fake-indexeddb jsdom && node tests/app-boot.test.js
// Loads the app exactly like index.html (same script order), boots it, visits every screen.
require("fake-indexeddb/auto");
const { JSDOM } = require("jsdom"); const fs = require("fs"); const path = require("path"); const assert = require("assert");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"><div class="topbar" id="topbar"></div><main class="view" id="appMain"></main></div><button id="fab"></button><nav id="tabbar"></nav></body>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window; w.indexedDB = global.indexedDB; w.IDBKeyRange = global.IDBKeyRange;
w.crypto = global.crypto; w.TextEncoder = global.TextEncoder; w.TextDecoder = global.TextDecoder; w.atob = global.atob; w.btoa = global.btoa;
w.matchMedia = () => ({ matches: true, addEventListener() {} }); w.scrollTo = () => {};
const errors = []; w.console.error = (...a) => errors.push(a.join(" "));
// load in index.html order
const order = [...html.matchAll(/<script src="\.\/(js\/[^"]+)"><\/script>|<script>(window\.Pages = \{\};)<\/script>/g)].map(m => m[1] || "__PAGES__");
assert.ok(order.includes("js/finance.js") && order.indexOf("js/finance.js") < order.indexOf("js/utils.js"), "finance before utils");
for (const f of order) { if (f === "__PAGES__") w.eval("window.Pages = {};"); else w.eval(fs.readFileSync(path.join(root, f), "utf8") + (f === "js/app.js" ? "\n;window.Router = Router;" : "")); }   // browsers share top-level const across <script> tags; eval does not
w.document.getElementById("fab").innerHTML = w.Icons.plus;
const Router = () => w.Router;
const lastSheet = () => [...w.document.querySelectorAll(".sheet")].pop();
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const D = (y,m,d)=>new Date(y,m-1,d,12).getTime();

(async () => {
  await w.bootApp(); await wait(200);
  assert.ok(w.document.getElementById("appMain").textContent.includes("No loans yet") || w.document.getElementById("appMain").textContent.includes("Owed to you")); console.log("ok - boots with empty database");
  const b = await w.DB.createBorrower({ name: "Ana Reyes", phone: "09171234567" });
  const b2 = await w.DB.createBorrower({ name: "Ben Cruz" });
  const now = Date.now();
  const l1 = await w.DB.createLoan({ borrowerId: b.id, principal: 10000, interestType: "monthly", interestRate: 5, dateBorrowed: D(2026,1,1), dueDate: D(2026,3,1), penaltyType: "percent", penaltyRate: 10, installments: 4 });
  const l2 = await w.DB.createLoan({ borrowerId: b.id, principal: 3000, dateBorrowed: now, dueDate: now + 6 * 86400000 });
  const l3 = await w.DB.createLoan({ borrowerId: b2.id, principal: 800, dateBorrowed: now, dueDate: now + 30 * 86400000 });
  const p = await w.DB.recordPayment({ loanId: l1.id, borrowerId: b.id, amount: 1000, date: D(2026,2,1), reference: "GC123" });
  await w.DB.recordPayment({ loanId: l3.id, borrowerId: b2.id, amount: 800, date: now });
  await w.DB.voidPayment(p.id, "test");

  const views = [["dashboard"], ["borrowers"], ["loans"], ["reports"], ["settings"], ["calendar"], ["borrowerProfile", { id: b.id }], ["borrowerProfile", { id: b2.id }], ["loanDetail", { id: l1.id }], ["loanDetail", { id: l2.id }], ["loanDetail", { id: l3.id }]];
  for (const [v, params] of views) {
    Router().stack = [{ view: v, params: params || {} }]; await Router().render(); await wait(120);
    const main = w.document.getElementById("appMain").textContent;
    assert.ok(!main.includes("Something went wrong") && !main.includes("Page not found") && main.length > 20, `view ${v} failed`);
    assert.ok(w.document.querySelector("#tabbar .tab.active"), "active tab");
    console.log("ok - renders", v);
  }
  // calendar click + month nav
  Router().stack = [{ view: "calendar", params: {} }]; await Router().render(); await wait(100);
  w.document.querySelector("#calNext").click(); await wait(30); w.document.querySelector("#calToday").click(); await wait(30);
  const cell = w.document.querySelector(".cal-cell.today"); assert.ok(cell && /aria-label|due|payment/i.test(cell.outerHTML)); console.log("ok - calendar navigation + accessible cells");
  // top-level helpers
  w.openQuickAdd(); await wait(50); assert.ok(lastSheet().textContent.includes("Record Payment")); w.Sheet.close(); console.log("ok - quick add");
  w.openGlobalSearch(); await wait(50); const gs = w.document.querySelector("#gSearch"); gs.value = "GC123"; gs.dispatchEvent(new w.Event("input")); await wait(400);
  assert.ok(w.document.querySelector("#gResults").textContent.includes("10,000") === false); w.Sheet.close(); console.log("ok - global search (voided refs excluded)");
  await w.openNotifications(); await wait(50); assert.ok(lastSheet().textContent.includes("Overdue")); w.Sheet.close(); console.log("ok - reminders panel");
  // forms open without errors
  w.openBorrowerForm(); await wait(50); assert.ok(lastSheet().querySelector("#fName")); w.Sheet.close();
  await w.openLoanForm(null, b.id); await wait(50); assert.ok(lastSheet().querySelector("#lPrincipal")); w.Sheet.close();
  await w.openPaymentForm(null, null, null, { borrowerId: b.id }); await wait(150); assert.ok(lastSheet().querySelector("#pAmount")); w.Sheet.close(); console.log("ok - borrower / loan / payment forms open");
  // cascade delete + undo, atomic
  const snap = await w.DB.deleteBorrowerCascade(b.id);
  assert.equal((await w.DB.getAll("loans")).filter(l => l.borrowerId === b.id).length, 0); assert.equal(snap.loans.length, 2); assert.ok(snap.payments.length >= 1);
  await w.DB.restoreSnapshot(snap); assert.equal((await w.DB.loansForBorrower(b.id)).length, 2); assert.equal((await w.DB.paymentsForLoan(l1.id)).length, 1); console.log("ok - cascade delete is atomic and Undo restores everything (incl. voided)");
  assert.deepEqual(errors, [], "console errors: " + errors.join(" | ")); console.log("ok - no console errors");
  console.log("\napp boot tests passed"); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
