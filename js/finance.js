/* ============================================================
   finance.js — single source of truth for ALL money math.
   Integer centavos internally; pesos only at the edges.
   Works in browser (window.Finance) and Node (tests).

   LOAN FORMULA
     totalDue   = principal + interest + penalty - waivers
     remaining  = principalRemaining + interestRemaining + penaltyRemaining
     status     = archived|cancelled (manual) | paid | overdue | active (derived)
   PENALTY (deterministic, one-time)
     Assessed once the due DAY has passed. Basis = (principal+interest)
     still unpaid at end of due day. percent => basis*rate%, fixed => rate.
     Later payments never shrink or grow it.
   ALLOCATION (default order: penalty -> interest -> principal)
     Replayed chronologically. Penalty can only be paid by payments dated
     after the due day. Valid manual breakdowns are honoured; otherwise auto.
     Overpayments are rejected at entry; legacy overpayments surface as `credit`.
   VOIDED payments (voidedAt set) are ignored everywhere.
   ============================================================ */
(function (g) {
  "use strict";
  const DAY = 86400000;
  const ORDER = ["penalty", "interest", "principal"];

  const toCents = (n) => { n = Number(n); if (!isFinite(n)) return 0; return Math.round(Math.abs(n) * 100 + 1e-7) * (n < 0 ? -1 : 1); };
  const fromCents = (c) => c / 100;
  const sod = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysBetween = (a, b) => Math.round((sod(b) - sod(a)) / DAY);

  // ---------- interest ----------
  function interestPeriods(loan) {
    const days = Math.max(0, daysBetween(loan.dateBorrowed, loan.dueDate));
    switch (loan.interestType) {
      case "flat": case "percent": return 1;
      case "monthly": return Math.max(1, Math.ceil(days / 30));
      case "weekly": return Math.max(1, Math.ceil(days / 7));
      case "daily": return Math.max(1, days);
      default: return 0;
    }
  }
  function interestCents(loan) {
    const t = loan.interestType;
    if (!t || t === "none") return 0;
    if (t === "fixed") return toCents(loan.interestFixedAmount);
    const rate = Number(loan.interestRate) || 0;
    return Math.round(toCents(loan.principal) * rate / 100 * interestPeriods(loan) + 1e-7);
  }
  function explainInterest(loan, fmt = (n) => n.toFixed(2)) {
    const t = loan.interestType, p = fmt(Number(loan.principal) || 0), r = Number(loan.interestRate) || 0;
    const n = interestPeriods(loan), amt = fmt(fromCents(interestCents(loan)));
    if (!t || t === "none") return "No interest";
    if (t === "fixed") return `Fixed interest ${amt}`;
    if (t === "flat" || t === "percent") return `${r}% one-time on ${p} = ${amt}`;
    const unit = { monthly: "month", weekly: "week", daily: "day" }[t];
    return `${r}% per ${unit} × ${n} ${unit}${n === 1 ? "" : "s"} on ${p} = ${amt}`;
  }

  // ---------- core compute ----------
  function compute(loan, payments = [], asOf = Date.now(), opts = {}) {
    const order = opts.order || ORDER;
    const valid = payments.filter((p) => !p.voidedAt).slice()
      .sort((a, b) => (a.date - b.date) || ((a.createdAt || 0) - (b.createdAt || 0)));
    const dueDay = sod(loan.dueDate);
    const pastDue = sod(asOf) > dueDay;

    const P = toCents(loan.principal);
    const I0 = interestCents(loan);
    const I = Math.max(0, I0 - toCents(loan.waivedInterest));

    let PEN = 0;
    if (pastDue && loan.penaltyType && loan.penaltyType !== "none") {
      const paidByDue = valid.filter((p) => sod(p.date) <= dueDay).reduce((s, p) => s + toCents(p.amount), 0);
      const basis = Math.max(0, P + I - paidByDue);
      const rate = Number(loan.penaltyRate) || 0;
      if (basis > 0) PEN = loan.penaltyType === "percent" ? Math.round(basis * rate / 100 + 1e-7)
        : loan.penaltyType === "fixed" ? toCents(rate) : 0;
      PEN = Math.max(0, PEN - toCents(loan.waivedPenalty));
    }

    const rem = { principal: P, interest: I, penalty: PEN };
    const paid = { principal: 0, interest: 0, penalty: 0 };
    const allocations = {};
    let credit = 0, paidTotal = 0;

    for (const p of valid) {
      const amt = toCents(p.amount);
      const avail = { principal: rem.principal, interest: rem.interest, penalty: sod(p.date) > dueDay ? rem.penalty : 0 };
      const man = { principal: toCents(p.principalPortion), interest: toCents(p.interestPortion), penalty: toCents(p.penaltyPortion) };
      const hasManual = man.principal + man.interest + man.penalty > 0;
      let a, manualOk = false;
      if (hasManual && man.principal + man.interest + man.penalty === amt &&
          man.principal <= avail.principal && man.interest <= avail.interest && man.penalty <= avail.penalty) {
        a = { ...man, credit: 0 }; manualOk = true;
      } else {
        a = { principal: 0, interest: 0, penalty: 0 }; let left = amt;
        for (const k of order) { const t = Math.min(left, avail[k]); a[k] = t; left -= t; }
        a.credit = left;
      }
      for (const k of ["principal", "interest", "penalty"]) { rem[k] -= a[k]; paid[k] += a[k]; }
      credit += a.credit; paidTotal += amt;
      allocations[p.id] = { ...a, manualRejected: hasManual && !manualOk };
    }

    const remaining = rem.principal + rem.interest + rem.penalty;
    const daysRemaining = daysBetween(asOf, loan.dueDate);
    let status;
    if (loan.status === "archived" || loan.status === "cancelled") status = loan.status;
    else if (remaining === 0) status = "paid";
    else status = pastDue ? "overdue" : "active";
    const isOverdue = status === "overdue";

    const out = {
      principal: fromCents(P), interest: fromCents(I), penalty: fromCents(PEN),
      totalDue: fromCents(P + I + PEN), paid: fromCents(paidTotal), remaining: fromCents(remaining),
      principalPaid: fromCents(paid.principal), interestPaid: fromCents(paid.interest), penaltyPaid: fromCents(paid.penalty),
      principalRemaining: fromCents(rem.principal), interestRemaining: fromCents(rem.interest), penaltyRemaining: fromCents(rem.penalty),
      credit: fromCents(credit), status, isOverdue, daysRemaining, daysOverdue: isOverdue ? -daysRemaining : 0,
      overdueAmount: isOverdue ? fromCents(remaining) : 0,
      allocations: {}, cents: { P, I, PEN, paid: paidTotal, remaining, credit, paidParts: paid, remParts: rem, alloc: allocations },
    };
    for (const id in allocations) { const a = allocations[id];
      out.allocations[id] = { principal: fromCents(a.principal), interest: fromCents(a.interest), penalty: fromCents(a.penalty), credit: fromCents(a.credit) }; }
    return out;
  }

  // ---------- payment validation (use BEFORE saving) ----------
  function validatePayment(loan, payments, cand, asOf = Date.now(), opts = {}) {
    const amt = toCents(cand.amount);
    if (!(amt > 0)) return { ok: false, error: "Enter an amount greater than zero." };
    const before = compute(loan, payments, asOf, opts);
    if (loan.status === "cancelled" || loan.status === "archived") return { ok: false, error: "This loan is closed. Reopen it before recording payments." };
    if (before.cents.remaining === 0) return { ok: false, error: "This loan is already fully paid." };
    const after = compute(loan, [...payments, { ...cand, id: "__new" }], asOf, opts);
    const a = after.cents.alloc.__new;
    const max = amt - a.credit;
    if (a.credit > 0) return { ok: false, error: `That is more than is owed. Maximum is ${fromCents(Math.max(0, max)).toFixed(2)}.`, maxAmount: fromCents(Math.max(0, max)) };
    if (a.manualRejected) return { ok: false, error: "Breakdown must add up to the payment and not exceed what is owed for each part." };
    return { ok: true, allocation: after.allocations.__new, remainingAfter: after.remaining, statusAfter: after.status };
  }

  // ---------- installment schedule ----------
  function addMonths(ts, n, anchorDay) {
    const d = new Date(ts), y = d.getFullYear(), m = d.getMonth() + n;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(anchorDay, last), 12).getTime();
  }
  function buildSchedule(loan) {
    const n = parseInt(loan.installments, 10) || 0; if (n <= 0) return [];
    const base = toCents(loan.principal) + Math.max(0, interestCents(loan) - toCents(loan.waivedInterest));
    const per = Math.floor(base / n), start = new Date(loan.dateBorrowed), anchor = start.getDate();
    const out = []; let used = 0;
    for (let i = 1; i <= n; i++) {
      const amt = i === n ? base - used : per; used += amt;
      let due;
      if (loan.installmentFreq === "weekly") due = new Date(start.getFullYear(), start.getMonth(), anchor + 7 * i, 12).getTime();
      else if (loan.installmentFreq === "biweekly") due = new Date(start.getFullYear(), start.getMonth(), anchor + 14 * i, 12).getTime();
      else due = addMonths(loan.dateBorrowed, i, anchor);
      out.push({ index: i, totalInstallments: n, dueDate: due, amountCents: amt, amount: fromCents(amt) });
    }
    return out;
  }
  /** Status is DERIVED from payments (principal+interest paid), never stored. */
  function scheduleStatus(schedule, paidBaseCents, asOf = Date.now()) {
    let left = paidBaseCents;
    return schedule.map((s) => {
      const p = Math.min(s.amountCents, left); left -= p;
      const status = p === s.amountCents ? "paid" : (sod(asOf) > sod(s.dueDate) ? "overdue" : (p > 0 ? "partial" : "pending"));
      return { ...s, paidCents: p, paid: fromCents(p), balance: fromCents(s.amountCents - p), status };
    });
  }

  // ---------- calendar periods ----------
  function period(key, now = Date.now(), custom) {
    const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
    const end = (yy, mm) => new Date(yy, mm, 1).getTime() - 1;
    switch (key) {
      case "month": return { from: new Date(y, m, 1).getTime(), to: end(y, m + 1) };
      case "lastMonth": return { from: new Date(y, m - 1, 1).getTime(), to: end(y, m) };
      case "quarter": { const q = Math.floor(m / 3) * 3; return { from: new Date(y, q, 1).getTime(), to: end(y, q + 3) }; }
      case "year": return { from: new Date(y, 0, 1).getTime(), to: end(y + 1, 0) };
      case "custom": return { from: sod(custom.from), to: sod(custom.to) + DAY - 1 };
      default: return { from: 0, to: Infinity };
    }
  }

  // ---------- reports ----------
  function summarize(loans, payments, range = { from: 0, to: Infinity }, asOf = Date.now()) {
    const s = { lent: 0, collected: 0, principalRecovered: 0, interestCollected: 0, penaltyCollected: 0,
      loansCreated: 0, outstandingPrincipal: 0, outstandingInterest: 0, outstandingPenalty: 0, overdueAmount: 0, overdueCount: 0, credit: 0 };
    const C = { ...s };
    for (const loan of loans) {
      if (loan.status === "cancelled") continue;
      const mine = payments.filter((p) => p.loanId === loan.id);
      const r = compute(loan, mine, asOf);
      if (loan.dateBorrowed >= range.from && loan.dateBorrowed <= range.to) { C.lent += r.cents.P; C.loansCreated++; }
      for (const p of mine) {
        if (p.voidedAt || p.date < range.from || p.date > range.to) continue;
        const a = r.cents.alloc[p.id]; if (!a) continue;
        C.collected += toCents(p.amount); C.principalRecovered += a.principal; C.interestCollected += a.interest; C.penaltyCollected += a.penalty;
      }
      if (r.status !== "archived") {
        C.outstandingPrincipal += r.cents.remParts.principal; C.outstandingInterest += r.cents.remParts.interest; C.outstandingPenalty += r.cents.remParts.penalty;
        if (r.isOverdue) { C.overdueAmount += r.cents.remaining; C.overdueCount++; }
      }
      C.credit += r.cents.credit;
    }
    const o = {}; for (const k in C) o[k] = (k === "loansCreated" || k === "overdueCount") ? C[k] : fromCents(C[k]);
    o.realizedIncome = fromCents(C.interestCollected + C.penaltyCollected);
    o.totalReceivables = fromCents(C.outstandingPrincipal + C.outstandingInterest + C.outstandingPenalty);
    return o;
  }

  const Finance = { toCents, fromCents, interestCents, explainInterest, compute, validatePayment, buildSchedule, scheduleStatus, period, summarize, ORDER, sod, daysBetween };
  if (typeof module !== "undefined" && module.exports) module.exports = Finance; else g.Finance = Finance;
})(typeof window !== "undefined" ? window : globalThis);
