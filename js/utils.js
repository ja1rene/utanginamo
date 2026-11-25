/* ============================================================
   utils.js v3 — formatting, dates, UI helpers.
   ALL loan math lives in finance.js (Finance). computeLoan is a thin wrapper.
   ============================================================ */
const Utils = {
  // ---------- currency (centralized; change here to support other regions) ----------
  currencySymbol: "₱",
  locale: "en-PH",
  money(n) {
    n = Number(n) || 0;
    const sign = n < 0 ? "-" : "";
    return `${sign}${Utils.currencySymbol}${Math.abs(n).toLocaleString(Utils.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  moneyShort(n) {
    n = Number(n) || 0;
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}${Utils.currencySymbol}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${n < 0 ? "-" : ""}${Utils.currencySymbol}${(abs / 1_000).toFixed(1)}K`;
    return Utils.money(n);
  },

  // ---------- dates ----------
  DAY: 86400000,
  startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); },
  daysBetween(a, b) { return Math.round((Utils.startOfDay(b) - Utils.startOfDay(a)) / Utils.DAY); },
  fmtDate(ts, opts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString(Utils.locale, opts || { month: "short", day: "numeric", year: "numeric" });
  },
  fmtDateTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString(Utils.locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  },
  fmtRelative(ts) {
    const d = Utils.daysBetween(Date.now(), ts);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d === -1) return "Yesterday";
    if (d > 1) return `In ${d} days`;
    return `${Math.abs(d)} days ago`;
  },
  toInputDate(ts) {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  fromInputDate(str) {
    if (!str) return Date.now();
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  },

  // ---------- loan math: delegated to the single source of truth ----------
  computeLoan(loan, payments = [], asOf = Date.now()) { return Finance.compute(loan, payments, asOf); },

  // ---------- trust rating ----------
  trustRating(loans, payments) {
    if (!loans.length) return { stars: 0, label: "No history yet", pct: 0 };
    let completed = 0, late = 0, totalDelay = 0, totalDue = 0, totalPaid = 0;
    for (const loan of loans) {
      const pmts = payments.filter(p => p.loanId === loan.id && !p.voidedAt);
      const c = Utils.computeLoan(loan, pmts);
      totalDue += c.totalDue; totalPaid += c.paid;
      if (c.status === "paid") {
        completed++;
        const lastPay = pmts.slice().sort((a,b)=>b.date-a.date)[0];
        if (lastPay && Utils.startOfDay(lastPay.date) > Utils.startOfDay(loan.dueDate)) {
          late++; totalDelay += Utils.daysBetween(loan.dueDate, lastPay.date);
        }
      } else if (c.isOverdue) {
        late++; totalDelay += c.daysOverdue;
      }
    }
    const repaymentPct = totalDue > 0 ? Math.min(1, totalPaid / totalDue) : 0;
    const lateRate = loans.length ? late / loans.length : 0;
    const avgDelay = late ? totalDelay / late : 0;
    let score = 5;
    score -= lateRate * 2.2;
    score -= Math.min(1.3, avgDelay / 30);
    score += Math.min(0.6, completed * 0.08);
    score += repaymentPct * 0.4;
    score = Math.max(1, Math.min(5, score));
    const stars = Math.round(score);
    const labels = {
      1: "High risk — frequent late or missed payments",
      2: "Below average — notable delays",
      3: "Fair — occasional late payments",
      4: "Good — mostly on-time, reliable",
      5: "Excellent — consistently on-time",
    };
    return { stars, label: labels[stars], pct: Math.round(repaymentPct * 100), lateRate, completed };
  },
  starString(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); },

  // ---------- misc helpers ----------
  initials(name) {
    if (!name) return "?";
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
  },
  escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
  },
  debounce(fn, wait = 250) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; },
  blobToDataURL(blob) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
  },
  async dataURLToBlob(dataUrl) { const res = await fetch(dataUrl); return res.blob(); },
  vibrate(pattern = 12) { if (navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {} },

  // ---------- coin ring SVG ----------
  coinRing(pct, size = 56, stroke = 6, color = "var(--gold)") {
    pct = Math.max(0, Math.min(100, pct));
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, offset = c - (pct / 100) * c;
    return `
      <div class="coin-ring" style="width:${size}px;height:${size}px;" role="img" aria-label="${Math.round(pct)}% complete">
        <svg width="${size}" height="${size}">
          <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--surface-3)" stroke-width="${stroke}" fill="none"/>
          <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
        </svg>
        <div class="center"><span class="pct" style="font-size:${size*0.24}px;">${Math.round(pct)}%</span></div>
      </div>`;
  },
};

// ---------- Toast system ----------
const Toast = {
  host: null,
  init() {
    Toast.host = document.createElement("div");
    Toast.host.className = "toast-host";
    Toast.host.setAttribute("role", "status"); Toast.host.setAttribute("aria-live", "polite");
    document.body.appendChild(Toast.host);
  },
  show(text, { type = "default", duration = 2800, action = null } = {}) {
    if (!Toast.host) Toast.init();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${Utils.escapeHtml(text)}</span>${action ? `<span class="undo" role="button" tabindex="0">${Utils.escapeHtml(action.label)}</span>` : ""}`;
    if (action) el.querySelector(".undo").onclick = () => { action.onClick(); el.remove(); };
    Toast.host.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, action ? Math.max(duration, 6000) : duration);
  },
};

// ---------- Sheet (bottom modal) system ----------
const Sheet = {
  overlay: null, current: null, lastFocus: null,
  init() {
    Sheet.overlay = document.createElement("div");
    Sheet.overlay.className = "sheet-overlay";
    document.body.appendChild(Sheet.overlay);
    Sheet.overlay.addEventListener("click", () => Sheet.close());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && Sheet.current) Sheet.close(); });
  },
  open({ title, bodyHtml, footHtml = "", onMount = null, onClose = null, maxWidth }) {
    if (!Sheet.overlay) Sheet.init();
    if (Sheet.current) Sheet.current.remove(); else Sheet.lastFocus = document.activeElement;
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", title);
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head"><h3>${Utils.escapeHtml(title)}</h3>
        <button class="icon-btn" id="sheetClose" aria-label="Close">${Icons.x}</button>
      </div>
      <div class="sheet-body">${bodyHtml}</div>
      ${footHtml ? `<div class="sheet-foot">${footHtml}</div>` : ""}
    `;
    document.body.appendChild(sheet);
    Sheet.current = sheet; sheet._onClose = onClose;
    sheet.querySelector("#sheetClose").onclick = () => Sheet.close();
    requestAnimationFrame(() => { Sheet.overlay.classList.add("open"); sheet.classList.add("open"); });
    if (onMount) onMount(sheet);
    return sheet;
  },
  close() {
    if (!Sheet.current) return;
    Sheet.overlay.classList.remove("open");
    Sheet.current.classList.remove("open");
    const el = Sheet.current;
    Sheet.current = null;
    if (el._onClose) { try { el._onClose(); } catch (e) {} }
    setTimeout(() => el.remove(), 280);
    try { Sheet.lastFocus && Sheet.lastFocus.focus && Sheet.lastFocus.focus(); } catch (e) {}
  },
};

// ---------- Confirm dialog (uses Sheet) ----------
function confirmAction({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    Sheet.open({
      title,
      bodyHtml: `<p class="muted" style="font-size:14px;line-height:1.6;">${Utils.escapeHtml(message)}</p>`,
      footHtml: `
        <button class="btn btn-ghost btn-block" id="cAbort">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" id="cOk">${Utils.escapeHtml(confirmLabel)}</button>`,
      onMount: (sheet) => {
        sheet.querySelector("#cAbort").onclick = () => { Sheet.close(); resolve(false); };
        sheet.querySelector("#cOk").onclick = () => { Sheet.close(); resolve(true); };
      },
    });
  });
}

window.Utils = Utils;
window.Toast = Toast;
window.Sheet = Sheet;
window.confirmAction = confirmAction;
