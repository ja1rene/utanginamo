// Run: npm i fake-indexeddb && node tests/region.test.js
require("fake-indexeddb/auto");
const assert = require("assert"), path = require("path"); const ok = (m) => console.log("ok -", m);
global.window = global; global.Icons = {};
global.Finance = require(path.join(__dirname, "../js/finance.js")); require(path.join(__dirname, "../js/utils.js"));
const { DB } = require(path.join(__dirname, "../js/db.js")); const U = global.Utils;
const D = (y,m,d)=>new Date(y,m-1,d,12).getTime(), day = D(2026,11,22);
const nb = (s) => s.replace(/[\u00A0\u202F]/g, " ");
(async () => {
  await DB.init();
  U.applyRegion({ currency:"PHP", num:"en", date:"mdy_short" });
  assert.equal(U.money(1234567.8), "₱1,234,567.80"); assert.equal(U.money(-5), "-₱5.00"); assert.equal(U.moneyShort(2500), "₱2.5K"); ok("default ₱ / en / Nov 22, 2026");
  for (const [d, exp] of [["mdy_short","Nov 22, 2026"],["dmy_short","22 Nov 2026"],["dmy_num","22/11/2026"],["mdy_num","11/22/2026"],["iso","2026-11-22"]]) { U.applyRegion({ date: d }); assert.equal(U.fmtDate(day), exp); } ok("5 date formats");
  U.applyRegion({ currency:"USD", num:"en" }); assert.equal(U.money(1234.5), "$1,234.50"); ok("USD");
  U.applyRegion({ currency:"EUR", num:"de" }); assert.equal(nb(U.money(1234.5)), "1.234,50 €"); assert.equal(nb(U.moneyShort(2500)), "2,5K €"); ok("EUR German style, symbol after");
  U.applyRegion({ currency:"EUR", num:"fr" }); assert.equal(nb(U.money(-1234.5)), "-1 234,50 €"); ok("French style");
  U.applyRegion({ currency:"INR", num:"in" }); assert.equal(U.money(1234567.8), "₹12,34,567.80"); ok("Indian digit grouping");
  U.applyRegion({ currency:"CUSTOM", symbol:"Nu", num:"en" }); assert.equal(U.money(3), "Nu3.00"); U.applyRegion({ currency:"CUSTOM", symbol:"TOOLONGX" }); assert.equal(U.currencySymbol.length, 4); ok("custom symbol (trimmed to 4)");
  U.applyRegion({ currency:"ZZZ", num:"xx", date:"bogus" }); assert.ok(U.NUMBER_FORMATS[U.region.num] && U.DATE_FORMATS[U.region.date]); assert.equal(U.fmtDate(day).length > 0, true); ok("invalid settings fall back safely");
  // persistence
  await U.saveRegion({ currency:"GBP", num:"en", date:"dmy_short" }); U.applyRegion({ currency:"PHP", date:"iso" }); await U.loadRegion();
  assert.equal(U.currencyCode, "GBP"); assert.equal(U.fmtDate(day), "22 Nov 2026"); ok("saved region reloads at startup");
  // stored amounts never change
  const b = await DB.createBorrower({ name:"A" }), l = await DB.createLoan({ borrowerId:b.id, principal:1000, dateBorrowed:day, dueDate:day+864e6 });
  const p = await DB.recordPayment({ loanId:l.id, borrowerId:b.id, amount:250, date:day });
  U.applyRegion({ currency:"USD" }); U.applyRegion({ currency:"JPY" });
  assert.equal((await DB.get("loans", l.id)).principal, 1000); assert.equal((await DB.get("payments", p.id)).amount, 250); assert.equal(Finance.compute(l, [p], day).remaining, 750); ok("changing currency never alters stored amounts or balances");
  // CSV: raw numbers, ISO dates, currency column — whatever the display format
  U.applyRegion({ currency:"EUR", num:"de", date:"dmy_short" });
  const lc = await DB.exportLoansCSV(), pc = await DB.exportPaymentsCSV();
  assert.match(lc.split("\n")[0], /Currency/); assert.match(lc, /"EUR"/); assert.match(lc, /"1000"/); assert.match(lc, /2026-11-22/); assert.ok(!/1\.000,00/.test(lc));
  assert.match(pc, /"250"/); assert.match(pc, /2026-11-22/); ok("CSV: plain numbers, ISO dates, currency column (spreadsheet-safe)");
  console.log("\nregion tests passed");
})().catch(e => { console.error(e); process.exit(1); });
