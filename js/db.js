/* ============================================================
   db.js — IndexedDB layer for Utanginamo v3
   Schema unchanged (DB_VERSION 2): voidedAt/voidReason are plain fields,
   so existing data upgrades with NO migration and nothing is rewritten.
   Payments are the authoritative financial record. Loan status and
   installment status are DERIVED by Finance, never stored.
   ============================================================ */
const DB_NAME = "utang-db";
const DB_VERSION = 2;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("borrowers")) { const s = db.createObjectStore("borrowers", { keyPath: "id" }); s.createIndex("name", "name"); s.createIndex("archived", "archived"); }
      if (!db.objectStoreNames.contains("loans")) { const s = db.createObjectStore("loans", { keyPath: "id" }); s.createIndex("borrowerId", "borrowerId"); s.createIndex("status", "status"); s.createIndex("dueDate", "dueDate"); }
      if (!db.objectStoreNames.contains("payments")) { const s = db.createObjectStore("payments", { keyPath: "id" }); s.createIndex("loanId", "loanId"); s.createIndex("borrowerId", "borrowerId"); s.createIndex("date", "date"); }
      if (!db.objectStoreNames.contains("attachments")) { const s = db.createObjectStore("attachments", { keyPath: "id" }); s.createIndex("ownerId", "ownerId"); }
      if (!db.objectStoreNames.contains("activity")) { const s = db.createObjectStore("activity", { keyPath: "id" }); s.createIndex("date", "date"); s.createIndex("borrowerId", "borrowerId"); }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("schedules")) { const s = db.createObjectStore("schedules", { keyPath: "id" }); s.createIndex("loanId", "loanId"); }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeNames, mode = "readonly") { return _db.transaction(storeNames, mode); }
function promisify(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
/** Run several writes as ONE atomic transaction. fn receives a store getter. */
function atomic(stores, fn) {
  return new Promise((res, rej) => {
    const t = _db.transaction(stores, "readwrite");
    try { fn((n) => t.objectStore(n)); } catch (e) { try { t.abort(); } catch (_) {} rej(e); return; }   // roll back everything
    t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("Transaction aborted"));
  });
}

const DB = {
  async init() { if (!_db) await openDB(); return _db; },
  uid(prefix = "id") { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; },

  async put(store, obj) { const t = tx([store],"readwrite"); await promisify(t.objectStore(store).put(obj)); return obj; },
  async get(store, id) { const t = tx([store]); return promisify(t.objectStore(store).get(id)); },
  async getAll(store) { const t = tx([store]); return promisify(t.objectStore(store).getAll()); },
  async delete(store, id) { const t = tx([store],"readwrite"); await promisify(t.objectStore(store).delete(id)); },
  async byIndex(store, idx, val) { const t = tx([store]); return promisify(t.objectStore(store).index(idx).getAll(val)); },
  async getAllKeys(store) { const t = tx([store]); return promisify(t.objectStore(store).getAllKeys()); },
  async clearStore(store) { const t = tx([store],"readwrite"); await promisify(t.objectStore(store).clear()); },

  // ---------- borrowers ----------
  async createBorrower(data) {
    const now = Date.now();
    const b = { id:DB.uid("brw"), name:"", nickname:"", phone:"", facebook:"", address:"",
      occupation:"", emergencyContact:"", relationship:"", notes:"", photo:null,
      archived:false, createdAt:now, updatedAt:now, ...data };
    await atomic(["borrowers","activity"], (s) => {
      s("borrowers").put(b);
      s("activity").put({ id:DB.uid("act"), date:now, type:"borrower_created", borrowerId:b.id, text:`Added borrower ${b.name}` });
    });
    return b;
  },
  async updateBorrower(id, patch) {
    const b = await DB.get("borrowers", id); if (!b) return null;
    const updated = { ...b, ...patch, updatedAt:Date.now() };
    await DB.put("borrowers", updated); return updated;
  },
  async listBorrowers({ includeArchived=false }={}) {
    const all = await DB.getAll("borrowers");
    return includeArchived ? all : all.filter(b=>!b.archived);
  },

  // ---------- loans ----------
  async createLoan(data) {
    const now = Date.now();
    const loan = { id:DB.uid("loan"), borrowerId:null, principal:0,
      interestType:"none", interestRate:0, interestFixedAmount:0,
      penaltyType:"none", penaltyRate:0, installments:0, installmentFreq:"monthly",
      dateBorrowed:now, dueDate:now, status:"active", notes:"", createdAt:now, updatedAt:now, ...data };
    const b = await DB.get("borrowers", loan.borrowerId);
    await atomic(["loans","activity"], (s) => {
      s("loans").put(loan);
      s("activity").put({ id:DB.uid("act"), date:now, type:"loan_created", borrowerId:loan.borrowerId, loanId:loan.id,
        text:`New loan of ${Utils.money(loan.principal)} to ${b?b.name:"borrower"}` });
    });
    return loan;
  },
  /** Editing never touches payments or schedules: schedules are derived from the loan terms. */
  async updateLoan(id, patch, logText) {
    const loan = await DB.get("loans", id); if (!loan) return null;
    const updated = { ...loan, ...patch, updatedAt:Date.now() };
    await atomic(["loans","activity"], (s) => {
      s("loans").put(updated);
      if (logText) s("activity").put({ id:DB.uid("act"), date:Date.now(), type:"loan_updated", borrowerId:loan.borrowerId, loanId:id, text:logText });
    });
    return updated;
  },
  async listLoans() { return DB.getAll("loans"); },
  async loansForBorrower(borrowerId) { return DB.byIndex("loans","borrowerId",borrowerId); },

  // ---------- installment schedule (DERIVED — see Finance.buildSchedule/scheduleStatus) ----------
  async scheduleForLoan(loanId) {
    const loan = await DB.get("loans", loanId);
    return loan ? Finance.buildSchedule(loan) : [];
  },

  // ---------- payments ----------
  /** Validates against fresh data, blocks double-taps, writes payment + activity atomically. */
  async recordPayment(data) {
    const now = Date.now();
    const payment = { id:DB.uid("pay"), loanId:null, borrowerId:null, amount:0, date:now, method:"Cash",
      reference:"", notes:"", principalPortion:0, interestPortion:0, penaltyPortion:0, createdAt:now, ...data };
    const loan = await DB.get("loans", payment.loanId);
    if (!loan) throw new Error("Loan not found");
    const existing = await DB.paymentsForLoan(payment.loanId);
    const dup = existing.find(p => !p.voidedAt && p.amount === payment.amount && p.date === payment.date && (now - p.createdAt) < 15000);
    if (dup) return { ...dup, duplicateOf: dup.id };
    const v = Finance.validatePayment(loan, existing, payment);
    if (!v.ok) throw new Error(v.error);
    const b = await DB.get("borrowers", loan.borrowerId);
    await atomic(["payments","activity"], (s) => {
      s("payments").put(payment);
      s("activity").put({ id:DB.uid("act"), date:now, type:"payment", borrowerId:payment.borrowerId, loanId:payment.loanId, paymentId:payment.id,
        text:`${b?b.name:"Borrower"} paid ${Utils.money(payment.amount)}` });
    });
    return payment;
  },
  /** Back-compat alias (old callers). Always validated. */
  async createPayment(data) { return DB.recordPayment(data); },
  /** Void keeps the record for audit; Finance ignores voided payments. */
  async voidPayment(id, reason) {
    const p = await DB.get("payments", id); if (!p || p.voidedAt) return null;
    const voided = { ...p, voidedAt:Date.now(), voidReason:reason || "" };
    await atomic(["payments","activity"], (s) => {
      s("payments").put(voided);
      s("activity").put({ id:DB.uid("act"), date:Date.now(), type:"payment_void", borrowerId:p.borrowerId, loanId:p.loanId, paymentId:p.id,
        text:`Voided ${Utils.money(p.amount)} payment${reason?` — ${reason}`:""}` });
    });
    return voided;
  },
  /** ALL payments for a loan INCLUDING voided (history). Finance ignores voided ones. */
  async paymentsForLoan(loanId) { const list = await DB.byIndex("payments","loanId",loanId); return list.sort((a,b)=>b.date-a.date); },
  /** Active (non-voided) payments only. */
  async paymentsForBorrower(borrowerId) { const list = await DB.byIndex("payments","borrowerId",borrowerId); return list.filter(p=>!p.voidedAt).sort((a,b)=>b.date-a.date); },
  async allPayments() { return (await DB.getAll("payments")).filter(p=>!p.voidedAt); },

  // ---------- cascade delete / undo (single transaction each) ----------
  async deleteBorrowerCascade(id) {
    const borrower = await DB.get("borrowers", id); if (!borrower) return null;
    const loans = await DB.byIndex("loans","borrowerId",id);
    const payments = await DB.byIndex("payments","borrowerId",id), seen = new Set(payments.map(p=>p.id));
    for (const l of loans) for (const p of await DB.byIndex("payments","loanId",l.id)) if (!seen.has(p.id)) { seen.add(p.id); payments.push(p); }
    const attachments = await DB.byIndex("attachments","ownerId",id);
    await atomic(["borrowers","loans","payments","attachments","activity"], (s) => {
      payments.forEach(p => s("payments").delete(p.id)); loans.forEach(l => s("loans").delete(l.id));
      attachments.forEach(a => s("attachments").delete(a.id)); s("borrowers").delete(id);
      s("activity").put({ id:DB.uid("act"), date:Date.now(), type:"borrower_deleted", text:`Deleted borrower ${borrower.name}` });
    });
    return { borrowers:[borrower], loans, payments, attachments };
  },
  async deleteLoanCascade(id) {
    const loan = await DB.get("loans", id); if (!loan) return null;
    const payments = await DB.byIndex("payments","loanId",id);
    await atomic(["loans","payments","activity"], (s) => {
      payments.forEach(p => s("payments").delete(p.id)); s("loans").delete(id);
      s("activity").put({ id:DB.uid("act"), date:Date.now(), type:"loan_deleted", borrowerId:loan.borrowerId, text:`Deleted a ${Utils.money(loan.principal)} loan` });
    });
    return { borrowers:[], loans:[loan], payments, attachments:[] };
  },
  async restoreSnapshot(snap) {
    await atomic(["borrowers","loans","payments","attachments"], (s) => {
      for (const k of ["borrowers","loans","payments","attachments"]) (snap[k]||[]).forEach(r => s(k).put(r));
    });
  },

  // ---------- attachments ----------
  async addAttachment({ ownerId, ownerType, name, mime, blob, label }) {
    const att = { id:DB.uid("att"), ownerId, ownerType, name, mime, blob, label:label||"Document", createdAt:Date.now() };
    await DB.put("attachments", att); return att;
  },
  async attachmentsFor(ownerId) { return DB.byIndex("attachments","ownerId",ownerId); },

  // ---------- activity ----------
  async logActivity(data) { const a = { id:DB.uid("act"), date:Date.now(), ...data }; await DB.put("activity", a); return a; },
  async recentActivity(limit=12) { const all = await DB.getAll("activity"); return all.sort((a,b)=>b.date-a.date).slice(0,limit); },

  // ---------- meta ----------
  async getSetting(key, fallback=null) { const r = await DB.get("meta",key); return r?r.value:fallback; },
  async setSetting(key, value) { await DB.put("meta",{key,value}); },

  // ---------- backup / restore ----------
  async exportAll() {
    const [borrowers,loans,payments,attachments,activity,schedules] = await Promise.all([
      DB.getAll("borrowers"),DB.getAll("loans"),DB.getAll("payments"),DB.getAll("attachments"),DB.getAll("activity"),DB.getAll("schedules")]);
    const attSafe = await Promise.all(attachments.map(async a => {
      let dataUrl = null; if (a.blob) dataUrl = await Utils.blobToDataURL(a.blob);
      return { ...a, blob:undefined, dataUrl };
    }));
    return { app:"Utanginamo", version:DB_VERSION, exportedAt:Date.now(), borrowers, loans, payments, attachments:attSafe, activity, schedules };
  },
  /** All-or-nothing restore: one transaction. Any failure rolls back, leaving existing data untouched.
      mode "replace" clears first; skipExisting (merge) only adds ids not already present. */
  async importAll(json, { mode="merge", skipExisting=false }={}) {
    if (!json || !Array.isArray(json.borrowers) || !Array.isArray(json.loans) || !Array.isArray(json.payments))
      throw new Error("Not a valid Utanginamo backup");
    const stores = ["borrowers","loans","payments","attachments","activity","schedules"];
    const data = {}; for (const s of stores) data[s] = json[s] || [];
    data.attachments = await Promise.all(data.attachments.map(async a => {   // decode blobs BEFORE opening the transaction
      const { dataUrl, ...rest } = a; return { ...rest, blob: dataUrl ? await Utils.dataURLToBlob(dataUrl) : (a.blob || null) };
    }));
    const have = {}; if (skipExisting && mode !== "replace") for (const s of stores) have[s] = new Set(await DB.getAllKeys(s));
    let added = 0;
    await atomic(stores, (st) => {
      if (mode === "replace") stores.forEach(s => st(s).clear());
      for (const s of stores) for (const rec of data[s]) { if (have[s] && have[s].has(rec.id)) continue; st(s).put(rec); added++; }
      st("activity").put({ id:DB.uid("act"), date:Date.now(), type:"restore", text:`Restored backup (${mode==="replace"?"replaced all":"added missing"}, ${added} records)` });
    });
    return { added };
  },
  async resetAll() { await atomic(["borrowers","loans","payments","attachments","activity","schedules"], (st) => ["borrowers","loans","payments","attachments","activity","schedules"].forEach(n => st(n).clear())); },

  // ---------- CSV export helpers ----------
  // Spreadsheets need machine-readable values: plain numbers (dot decimal, no symbol), ISO dates, and a Currency column.
  async exportLoansCSV() {
    const [loans,payments,borrowers] = await Promise.all([DB.listLoans(),DB.allPayments(),DB.listBorrowers({includeArchived:true})]);
    const cur = Utils.currencyCode || Utils.currencySymbol, iso = (t)=>t?Utils.toInputDate(t):"";
    const rows = [["Borrower","Currency","Principal","Interest Type","Interest Rate","Interest","Penalty","Total Due","Paid","Remaining","Status","Date Borrowed","Due Date","Notes"]];
    for (const l of loans) {
      const b = borrowers.find(x=>x.id===l.borrowerId);
      const c = Utils.computeLoan(l,payments.filter(p=>p.loanId===l.id));
      rows.push([b?.name||"",cur,l.principal,l.interestType,l.interestRate,c.interest,c.penalty,c.totalDue,c.paid,c.remaining,c.status,iso(l.dateBorrowed),iso(l.dueDate),l.notes||""]);
    }
    return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  },
  async exportPaymentsCSV() {
    const [all,borrowers,loans] = await Promise.all([DB.getAll("payments"),DB.listBorrowers({includeArchived:true}),DB.listLoans()]);
    const cur = Utils.currencyCode || Utils.currencySymbol;
    const byLoan = {}; for (const l of loans) byLoan[l.id] = Finance.compute(l, all.filter(p=>p.loanId===l.id));
    const rows = [["Date","Borrower","Currency","Amount","Method","Reference","Notes","Principal","Interest","Penalty","Voided","Void Reason"]];
    for (const p of all.sort((a,b)=>b.date-a.date)) {
      const b = borrowers.find(x=>x.id===p.borrowerId), a = byLoan[p.loanId]?.allocations[p.id] || {};
      rows.push([Utils.toInputDate(p.date),b?.name||"",cur,p.amount,p.method||"Cash",p.reference||"",p.notes||"",a.principal??"",a.interest??"",a.penalty??"",p.voidedAt?"Yes":"",p.voidReason||""]);
    }
    return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  },
};

window.DB = DB;
if (typeof module !== "undefined" && module.exports) module.exports = { DB, _setDb: (d) => { _db = d; } };
