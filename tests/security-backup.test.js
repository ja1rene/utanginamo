// Run: npm i fake-indexeddb && node tests/security-backup.test.js
require("fake-indexeddb/auto");
const assert = require("assert"); const path = require("path");
global.window = global; global.Icons = {};
global.Finance = require(path.join(__dirname, "../js/finance.js"));
require(path.join(__dirname, "../js/utils.js"));
const { DB } = require(path.join(__dirname, "../js/db.js"));
require(path.join(__dirname, "../js/security.js")); const Backup = require(path.join(__dirname, "../js/backup.js"));
const S = global.Security; const ok = (m) => console.log("ok -", m);
const D = (y,m,d)=>new Date(y,m-1,d,12).getTime();

(async () => {
  await DB.init();
  // ---------- PIN ----------
  assert.ok(S.isWeak("0000") && S.isWeak("1234") && S.isWeak("4321") && S.isWeak("111111") && !S.isWeak("7391")); ok("weak PINs rejected");
  await S.setPin("7391");
  let st = await S.getState(); assert.ok(st.hash2 && st.salt && !st.legacy && st.length === 4); assert.notEqual(st.hash2, "7391"); ok("PIN stored as salted PBKDF2, not plaintext");
  assert.equal((await S.verify("7391")).ok, true); ok("correct PIN accepted");
  let r = await S.verify("0001"); assert.equal(r.ok, false); assert.equal(r.attemptsLeft, 4); ok("wrong PIN counts attempts");
  for (let i = 0; i < 3; i++) await S.verify("0002");
  r = await S.verify("0003"); assert.equal(r.locked, true); assert.equal(r.remainingMs, 30000); ok("5th wrong try → 30s lockout");
  r = await S.verify("7391"); assert.equal(r.ok, false); assert.equal(r.locked, true); ok("correct PIN refused while locked");
  await DB.setSetting("pinLockUntil", Date.now() - 1); r = await S.verify("0004"); assert.equal(r.locked, true); assert.equal(r.remainingMs, 60000); ok("lockout doubles on next failure");
  await DB.setSetting("pinLockUntil", Date.now() - 1); assert.equal((await S.verify("7391")).ok, true); assert.equal((await S.getState()).fails, 0); ok("success after lock expiry resets counter");
  // legacy upgrade
  const legacy = (pin) => { let h = 5381; for (const c of String(pin)) h = ((h << 5) + h) + c.charCodeAt(0); return (h >>> 0).toString(16); };
  await S.disablePin(); await DB.setSetting("pinEnabled", true); await DB.setSetting("pinHash", legacy("2580"));
  assert.equal((await S.verify("2580")).ok, true); st = await S.getState(); assert.ok(st.hash2 && !st.legacy); assert.equal((await S.verify("2580")).ok, true); ok("legacy weak hash silently upgraded");
  await S.disablePin(); assert.equal(await S.isEnabled(), false); ok("disable PIN clears hashes");

  // ---------- Backup ----------
  const b = await DB.createBorrower({ name: "Ana" });
  const l = await DB.createLoan({ borrowerId: b.id, principal: 5000, dateBorrowed: D(2026,1,1), dueDate: D(2099,1,1) });
  await DB.recordPayment({ loanId: l.id, borrowerId: b.id, amount: 500, date: D(2026,1,5) });
  const plain = await Backup.create(); assert.equal(plain.encrypted, false); assert.equal(plain.obj.counts.payments, 1); assert.ok(plain.obj.checksum); ok("plain backup has counts + checksum");
  let o = await Backup.open(JSON.stringify(plain.obj)); assert.equal(o.wrapper.data.loans.length, 1); ok("plain backup round trip");
  const tampered = JSON.parse(JSON.stringify(plain.obj)); tampered.data.payments[0].amount = 9999;
  await assert.rejects(Backup.open(JSON.stringify(tampered)), /checksum/); ok("edited/corrupt backup rejected");
  const enc = await Backup.create("correct horse"); assert.equal(enc.encrypted, true); assert.ok(!JSON.stringify(enc.obj).includes("Ana")); ok("encrypted backup hides contents");
  o = await Backup.open(JSON.stringify(enc.obj)); assert.ok(o.needsPassword);
  await assert.rejects(Backup.open(JSON.stringify(enc.obj), "wrong pass"), /WRONG_PASSWORD/); ok("wrong password rejected");
  o = await Backup.open(JSON.stringify(enc.obj), "correct horse"); assert.equal(o.wrapper.data.borrowers[0].name, "Ana"); ok("encrypted round trip");
  assert.throws(() => Backup.parseText("not json"), /valid backup/); assert.throws(() => Backup.parseText('{"app":"Other"}'), /isn't a Utanginamo/); ok("garbage files rejected");
  const legacyFile = { app: "Utanginamo", version: 2, exportedAt: 1, borrowers: plain.obj.data.borrowers, loans: plain.obj.data.loans, payments: plain.obj.data.payments };
  o = await Backup.open(JSON.stringify(legacyFile)); assert.equal(o.wrapper.format, "legacy"); ok("old-format backups still importable");

  // validation
  const bad = { borrowers: [{ id: "b1", name: "x" }, { id: "b1", name: "y" }], loans: [{ id: "l1", borrowerId: "b1", principal: -5, dateBorrowed: 1, dueDate: 2 }], payments: [{ id: "p1", loanId: "zz", amount: "5", date: 1 }] };
  let v = Backup.validate(bad); assert.ok(v.errors.length >= 3); ok("validation catches dup ids, negative principal, bad amount");
  v = Backup.validate({ borrowers: [], loans: [{ id: "l1", borrowerId: "nope", principal: 1, dateBorrowed: 1, dueDate: 2 }], payments: [] }); assert.equal(v.errors.length, 0); assert.equal(v.warnings.length, 1); ok("orphan records warn (not block)");

  // restore: merge adds only missing
  const snap = JSON.parse(JSON.stringify(plain.obj.data));
  const extraB = { id: "brw_extra", name: "Ben", createdAt: 1, updatedAt: 1 }; snap.borrowers.push(extraB); snap.borrowers[0].name = "CHANGED";
  let res = await DB.importAll(snap, { mode: "merge", skipExisting: true }); assert.equal((await DB.get("borrowers", b.id)).name, "Ana"); assert.ok(await DB.get("borrowers", "brw_extra")); ok("merge adds new, never overwrites existing");
  // replace
  await DB.importAll(plain.obj.data, { mode: "replace" }); assert.equal((await DB.getAll("borrowers")).length, 1); assert.equal((await DB.getAll("payments")).length, 1); ok("replace restores exactly the backup");
  // atomic rollback: bad record (no id) must leave current data intact
  const poisoned = JSON.parse(JSON.stringify(plain.obj.data)); poisoned.payments.push({ amount: 1 });
  await assert.rejects(DB.importAll(poisoned, { mode: "replace" }));
  assert.equal((await DB.getAll("borrowers")).length, 1); assert.equal((await DB.getAll("loans")).length, 1); assert.equal((await DB.getAll("payments")).length, 1); ok("failed restore rolls back — existing data untouched");
  // integrity
  await DB.put("payments", { id: "orph", loanId: "gone", borrowerId: b.id, amount: 5, date: 1, createdAt: 1 });
  const rep = await Backup.integrity(); assert.ok(rep.issues.some(i => /no loan/.test(i))); ok("integrity check finds orphan payment");
  await DB.resetAll(); assert.equal((await DB.getAll("loans")).length, 0); ok("reset clears all stores atomically");
  console.log("\nsecurity + backup tests passed");
})().catch(e => { console.error(e); process.exit(1); });
