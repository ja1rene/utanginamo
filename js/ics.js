/* ============================================================
   ics.js — "Add to calendar": standard .ics reminder files.
   Works offline, needs no server. Once imported, your phone's calendar app
   fires the alarms even when Utanginamo is closed. The file is a SNAPSHOT:
   it doesn't update if payments change; re-export to refresh (same UIDs
   replace the old events instead of duplicating them).
   ============================================================ */
const Ics = (() => {
  const CRLF = "\r\n", enc = new TextEncoder();
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const ymd = (ts) => Utils.toInputDate(ts).replace(/-/g, "");
  const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
  const stamp = (t = Date.now()) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  /** RFC 5545 line folding at 75 octets (counting UTF-8 bytes, never splitting a character). */
  function fold(line) {
    if (enc.encode(line).length <= 75) return line;
    const parts = []; let cur = "", bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { parts.push(cur); cur = ""; bytes = 0; limit = 74; }
      cur += ch; bytes += b;
    }
    parts.push(cur); return parts.join(CRLF + " ");
  }

  /**
   * items: [{ loan, borrower, c (Finance.compute result), sched (scheduleStatus rows) }]
   * opts : { name:bool, amount:bool, sameDay:bool, dayBefore:bool, now?:ms }
   */
  function events(items, opts = {}, now = Date.now()) {
    const out = [], today = Utils.startOfDay(now);
    const label = (base, who, amt) => `${base}${opts.name && who ? ": " + who : ""}${opts.amount && amt != null ? " (" + Utils.money(amt) + ")" : ""}`;
    for (const { loan, borrower, c, sched = [] } of items) {
      if (!c || (c.status !== "active" && c.status !== "overdue")) continue;
      const who = borrower && borrower.name, upcoming = sched.filter(s => s.status !== "paid" && Utils.startOfDay(s.dueDate) >= today);
      for (const s of upcoming) out.push({ uid: `${loan.id}-inst${s.index}@utanginamo`, date: s.dueDate, summary: label(`Installment ${s.index}/${s.totalInstallments} due`, who, s.balance) });
      const lastInst = sched.length ? sched[sched.length - 1].dueDate : null;
      const sameAsLast = lastInst && ymd(lastInst) === ymd(loan.dueDate);
      if (c.status === "overdue") out.push({ uid: `${loan.id}-overdue@utanginamo`, date: addDays(today, 1), summary: label("Follow up: overdue payment", who, c.remaining) });
      else if (!sameAsLast) out.push({ uid: `${loan.id}-due@utanginamo`, date: loan.dueDate, summary: label("Payment due", who, c.remaining) });
    }
    return out;
  }

  function build(items, opts = {}, now = Date.now()) {
    const evs = events(items, opts, now), seq = Math.floor(now / 60000);
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Utanginamo//Reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Utanginamo"];
    for (const e of evs) {
      L.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`, `SEQUENCE:${seq}`, `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(addDays(e.date, 1))}`,
        `SUMMARY:${esc(e.summary)}`, "DESCRIPTION:" + esc("Reminder from Utanginamo. Snapshot made " + Utils.fmtDate(now) + "; check the app for the current balance."), "TRANSP:TRANSPARENT");
      if (opts.dayBefore) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.summary)}`, "TRIGGER:-PT15H", "END:VALARM");   // 9:00 the day before
      if (opts.sameDay !== false) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.summary)}`, "TRIGGER:PT9H", "END:VALARM");   // 9:00 that day
      L.push("END:VEVENT");
    }
    L.push("END:VCALENDAR");
    return { text: L.map(fold).join(CRLF) + CRLF, count: evs.length };
  }

  /** Share sheet where supported (iOS/Android), else a normal download. */
  async function deliver(text, filename) {
    const file = (typeof File !== "undefined") ? new File([text], filename, { type: "text/calendar" }) : null;
    try { if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Utanginamo reminders" }); return "shared"; } }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" })), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    return "downloaded";
  }

  async function itemsFor(loanIds) {
    const [loans, payments, borrowers] = await Promise.all([DB.listLoans(), DB.allPayments(), DB.listBorrowers({ includeArchived: true })]);
    return loans.filter(l => !loanIds || loanIds.includes(l.id)).map(l => {
      const c = Utils.computeLoan(l, payments.filter(p => p.loanId === l.id));
      const sched = l.installments > 0 ? Finance.scheduleStatus(Finance.buildSchedule(l), Finance.toCents(c.principalPaid + c.interestPaid)) : [];
      return { loan: l, borrower: borrowers.find(b => b.id === l.borrowerId), c, sched };
    });
  }

  /** Options sheet. loanIds=null → every open loan. */
  async function openSheet(loanIds, title = "Add to calendar") {
    const items = await itemsFor(loanIds);
    const probe = events(items, { name: true, amount: true });
    if (!probe.length) { Toast.show("Nothing to remind about — no open payments ahead.", { type: "error" }); return; }
    Sheet.open({
      title,
      bodyHtml: `<p class="muted" style="font-size:14px;line-height:1.6;margin-top:0;">Creates a calendar file with reminders for <b>${probe.length}</b> upcoming payment${probe.length === 1 ? "" : "s"}. Open it to add them to your phone's calendar — they'll notify you even when Utanginamo is closed. No internet needed.</p>
        <div class="eyebrow" style="margin:14px 0 2px;">Alert me</div>
        <label class="check"><input type="checkbox" id="icSame" checked><span>On the day, 9:00 am</span></label>
        <label class="check"><input type="checkbox" id="icBefore" checked><span>The day before, 9:00 am</span></label>
        <div class="eyebrow" style="margin:14px 0 2px;">Show in the calendar event</div>
        <label class="check"><input type="checkbox" id="icName" checked><span>Borrower's name</span></label>
        <label class="check"><input type="checkbox" id="icAmt"><span>Amount<br><span class="faint" style="font-size:12.5px;">Off by default: calendars often sync to other devices and accounts.</span></span></label>
        <p class="faint" style="font-size:12.5px;line-height:1.6;margin-bottom:0;">It's a snapshot. If payments change, export again — events are replaced, not duplicated.</p>`,
      footHtml: `<button class="btn btn-ghost btn-block" id="icNo">Cancel</button><button class="btn btn-primary btn-block" id="icGo">${Icons.download}&nbsp;Create file</button>`,
      onMount: (sheet) => {
        const $ = (s) => sheet.querySelector(s);
        $("#icNo").onclick = () => Sheet.close();
        $("#icGo").onclick = async () => {
          const opts = { name: $("#icName").checked, amount: $("#icAmt").checked, sameDay: $("#icSame").checked, dayBefore: $("#icBefore").checked };
          if (!opts.sameDay && !opts.dayBefore) { Toast.show("Pick at least one alert time", { type: "error" }); return; }
          const { text, count } = build(await itemsFor(loanIds), opts);
          const r = await deliver(text, `utanginamo-reminders-${Utils.toInputDate(Date.now())}.ics`);
          if (r !== "cancelled") { Sheet.close(); Toast.show(r === "shared" ? "Choose Calendar to add the reminders" : `Saved ${count} reminder${count === 1 ? "" : "s"} — open the file to add them`, { type: "success", duration: 4500 }); }
        };
      },
    });
  }

  return { build, events, fold, esc, deliver, openSheet };
})();
window.Ics = Ics;
if (typeof module !== "undefined" && module.exports) module.exports = Ics;
