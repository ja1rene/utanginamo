// Run: npm i fake-indexeddb && node tests/db.test.js
require("fake-indexeddb/auto");
const assert = require("assert"); const path = require("path");
global.window = global; global.Icons = {};
global.Finance = require(path.join(__dirname, "../js/finance.js"));
require(path.join(__dirname, "../js/utils.js"));
const { DB } = require(path.join(__dirname, "../js/db.js"));
const D = (y,m,d)=>new Date(y,m-1,d,12).getTime();
(async () => {
  await DB.init();
  const b = await DB.createBorrower({ name: "Juan" });
  const loan = await DB.createLoan({ borrowerId: b.id, principal: 10000, interestType: "fixed", interestFixedAmount: 500, dateBorrowed: D(2026,1,1), dueDate: D(2099,1,1), installments: 4 });
  const mk = (amount, extra={}) => ({ loanId: loan.id, borrowerId: b.id, amount, date: D(2026,1,10), ...extra });

  const p1 = await DB.recordPayment(mk(1000)); console.log("ok - record payment");
  const dup = await DB.recordPayment(mk(1000)); assert.ok(dup.duplicateOf); assert.equal((await DB.paymentsForLoan(loan.id)).length, 1); console.log("ok - duplicate blocked");
  await assert.rejects(DB.recordPayment(mk(99999, { date: D(2026,1,11) })), /more than is owed/); console.log("ok - overpayment rejected, nothing written");
  assert.equal((await DB.paymentsForLoan(loan.id)).length, 1);
  let c = Utils.computeLoan(loan, await DB.paymentsForLoan(loan.id)); assert.equal(c.remaining, 9500); assert.equal(c.interestPaid, 500); assert.equal(c.principalPaid, 500); console.log("ok - allocation stored/derived");
  const [s0] = Finance.scheduleStatus(await DB.scheduleForLoan(loan.id), Finance.toCents(c.principalPaid + c.interestPaid)); assert.equal(s0.status, "overdue"); assert.equal(s0.paid, 1000);  console.log("ok - schedule derived");
  await DB.updateLoan(loan.id, { principal: 12000 }, "edited"); c = Utils.computeLoan(await DB.get("loans", loan.id), await DB.paymentsForLoan(loan.id)); assert.equal(c.paid, 1000); assert.equal(c.remaining, 11500); console.log("ok - edit keeps payment history");
  await DB.voidPayment(p1.id, "wrong amount"); c = Utils.computeLoan(await DB.get("loans", loan.id), await DB.paymentsForLoan(loan.id)); assert.equal(c.paid, 0);
  assert.equal((await DB.allPayments()).length, 0); assert.equal((await DB.paymentsForLoan(loan.id)).length, 1); console.log("ok - void excluded from balances, kept in history");
  const act = await DB.recentActivity(20); assert.ok(act.some(a => a.type === "payment_void")); console.log("ok - audit trail");
  const csv = await DB.exportPaymentsCSV(); assert.match(csv, /wrong amount/); console.log("ok - CSV includes voids");
  const exp = await DB.exportAll(); await DB.resetAll(); await DB.importAll(exp, { mode: "replace" }); assert.equal((await DB.getAll("payments")).length, 1); console.log("ok - backup round trip");
  await assert.rejects(DB.importAll({ foo: 1 })); console.log("ok - invalid import rejected");
  console.log("\ndb tests passed");
})().catch(e => { console.error(e); process.exit(1); });
