/* ============================================================
   backup.js — export (optionally AES-GCM encrypted), validate, preview, restore.
   Encryption uses the browser's Web Crypto (PBKDF2-SHA256 → AES-256-GCM). No custom crypto.
   The PIN and app settings are NOT part of a backup.
   ============================================================ */
const Backup = (() => {
  const STORES = ["borrowers", "loans", "payments", "attachments", "activity", "schedules"];
  const ITER = 310000, te = new TextEncoder(), td = new TextDecoder();
  const toB64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hasCrypto = () => !!(globalThis.crypto && globalThis.crypto.subtle);
  const countOf = (d) => Object.fromEntries(STORES.map(s => [s, (d[s] || []).length]));
  async function sha256(str) {
    if (!hasCrypto()) return null;
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(str)))].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptText(text, password) {
    if (!hasCrypto()) throw new Error("Encryption isn't available in this browser context (needs https).");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(password, salt, ITER), te.encode(text));
    return { app: "Utanginamo", format: "utanginamo-encrypted", formatVersion: 1, kdf: "PBKDF2-SHA256", iterations: ITER, cipher: "AES-256-GCM", salt: toB64(salt), iv: toB64(iv), data: toB64(ct) };
  }
  async function decryptEnvelope(env, password) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, await deriveKey(password, fromB64(env.salt), env.iterations || ITER), fromB64(env.data));
      return JSON.parse(td.decode(pt));
    } catch (e) { throw new Error("WRONG_PASSWORD"); }
  }

  /** Build a backup object. Returns { obj, encrypted }. */
  async function create(password) {
    const raw = await DB.exportAll();
    const data = Object.fromEntries(STORES.map(s => [s, raw[s] || []]));
    const wrapper = { app: "Utanginamo", format: "utanginamo-backup", formatVersion: 3, dbVersion: raw.version, appVersion: window.APP_VERSION || "",
      exportedAt: Date.now(), counts: countOf(data), checksum: await sha256(JSON.stringify(data)), data };
    return password ? { obj: await encryptText(JSON.stringify(wrapper), password), encrypted: true } : { obj: wrapper, encrypted: false };
  }
  /** Parse file text. Returns {kind:"plain", wrapper} or {kind:"encrypted", envelope}. Throws friendly errors. */
  function parseText(text) {
    let obj; try { obj = JSON.parse(text); } catch (e) { throw new Error("That file isn't a valid backup (it can't be read as JSON)."); }
    if (!obj || typeof obj !== "object") throw new Error("That file isn't a Utanginamo backup.");
    if (obj.format === "utanginamo-encrypted") return { kind: "encrypted", envelope: obj };
    return { kind: "plain", wrapper: normalize(obj) };
  }
  async function normalizeChecked(obj) { const w = normalize(obj); await verifyChecksum(w); return w; }
  function normalize(obj) {
    if (obj.app !== "Utanginamo") throw new Error("That file isn't a Utanginamo backup.");
    if (obj.format === "utanginamo-backup") {
      if (!obj.data || typeof obj.data !== "object") throw new Error("The backup is missing its data section.");
      return obj;
    }
    if (Array.isArray(obj.borrowers)) {   // legacy export (before checksums)
      return { app: "Utanginamo", format: "legacy", exportedAt: obj.exportedAt, counts: null, checksum: null, data: Object.fromEntries(STORES.map(s => [s, obj[s] || []])) };
    }
    throw new Error("That file isn't a Utanginamo backup.");
  }
  async function verifyChecksum(w) {
    if (!w.checksum) return;
    const now = await sha256(JSON.stringify(w.data));
    if (now && now !== w.checksum) throw new Error("This backup looks damaged or was edited (checksum mismatch). It was not imported.");
  }
  async function open(text, password) {
    const p = parseText(text);
    if (p.kind === "encrypted") { if (!password) return { needsPassword: true, envelope: p.envelope }; return { wrapper: await normalizeChecked(await decryptEnvelope(p.envelope, password)) }; }
    await verifyChecksum(p.wrapper); return { wrapper: p.wrapper };
  }

  /** Structural + relational validation. existing = {borrowers:Set,loans:Set,...} of ids already on device. */
  function validate(data, existing = {}) {
    const errors = [], warnings = [];
    for (const s of ["borrowers", "loans", "payments"]) if (!Array.isArray(data[s])) errors.push(`Missing "${s}" list.`);
    if (errors.length) return { errors, warnings };
    const ids = {};
    for (const s of STORES) {
      const seen = new Set(); ids[s] = seen;
      (data[s] || []).forEach((r, i) => {
        if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id) errors.push(`${s}[${i}] has no valid id.`);
        else if (seen.has(r.id)) errors.push(`${s}: duplicate id ${r.id}.`); else seen.add(r.id);
      });
    }
    const num = (v) => typeof v === "number" && isFinite(v);
    const has = (s, id) => ids[s].has(id) || (existing[s] && existing[s].has(id));
    let orphanLoans = 0, orphanPays = 0;
    data.loans.forEach((l, i) => {
      if (!num(l.principal) || l.principal < 0) errors.push(`loans[${i}] has an invalid principal.`);
      if (!num(l.dateBorrowed) || !num(l.dueDate)) errors.push(`loans[${i}] has an invalid date.`);
      if (!has("borrowers", l.borrowerId)) orphanLoans++;
    });
    data.payments.forEach((p, i) => {
      if (!num(p.amount) || p.amount <= 0) errors.push(`payments[${i}] has an invalid amount.`);
      if (!num(p.date)) errors.push(`payments[${i}] has an invalid date.`);
      if (!has("loans", p.loanId)) orphanPays++;
    });
    data.borrowers.forEach((b, i) => { if (typeof b.name !== "string") errors.push(`borrowers[${i}] has no name.`); });
    if (orphanLoans) warnings.push(`${orphanLoans} loan(s) point to a borrower that isn't in the backup or on this device.`);
    if (orphanPays) warnings.push(`${orphanPays} payment(s) point to a loan that isn't in the backup or on this device.`);
    return { errors: errors.slice(0, 8), warnings, errorCount: errors.length };
  }
  async function existingIds() { const o = {}; for (const s of STORES) o[s] = new Set(await DB.getAllKeys(s)); return o; }

  /** Scan live data for problems. Read-only. */
  async function integrity() {
    const [borrowers, loans, payments] = await Promise.all([DB.getAll("borrowers"), DB.getAll("loans"), DB.getAll("payments")]);
    const bIds = new Set(borrowers.map(b => b.id)), lIds = new Set(loans.map(l => l.id)), issues = [];
    loans.forEach(l => { if (!bIds.has(l.borrowerId)) issues.push(`Loan ${l.id.slice(-6)} (${Utils.money(l.principal)}) has no borrower.`); if (!(l.principal >= 0)) issues.push(`Loan ${l.id.slice(-6)} has an invalid principal.`); });
    payments.forEach(p => { if (!lIds.has(p.loanId)) issues.push(`Payment of ${Utils.money(p.amount)} on ${Utils.fmtDate(p.date)} has no loan.`); if (!(Number(p.amount) > 0)) issues.push(`A payment on ${Utils.fmtDate(p.date)} has an invalid amount.`); });
    for (const l of loans) { const c = Finance.compute(l, payments.filter(p => p.loanId === l.id)); if (c.credit > 0) issues.push(`Loan ${l.id.slice(-6)} is overpaid by ${Utils.money(c.credit)}.`); }
    return { counts: { borrowers: borrowers.length, loans: loans.length, payments: payments.length }, issues };
  }

  // ---------- file helper ----------
  function save(obj, filename) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    return blob.size;
  }
  const fname = (enc, tag = "backup") => `utanginamo-${tag}-${Utils.toInputDate(Date.now())}${enc ? ".enc" : ""}.json`;
  const fmtBytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

  // ---------- UI: export ----------
  function exportFlow() {
    return new Promise((resolve) => {
      let settled = false; const end = (v) => { if (!settled) { settled = true; resolve(v); } };
      Sheet.open({
        title: "Export Backup",
        bodyHtml: `<div class="card" style="background:var(--surface-2);font-size:12.5px;line-height:1.6;margin-bottom:14px;">A backup contains <b>everything</b>: names, phone numbers, addresses, photos, loans and payments. Anyone who gets the file can read it — unless you set a password.</div>
          <div class="field"><label for="bkPw">Password (recommended)</label><input id="bkPw" type="password" autocomplete="new-password" placeholder="Leave empty for no encryption"></div>
          <div class="field hidden" id="bkPw2Wrap"><label for="bkPw2">Confirm password</label><input id="bkPw2" type="password" autocomplete="new-password"></div>
          <p class="faint" style="font-size:11.5px;line-height:1.5;margin:0;">If you forget the password, the backup <b>cannot</b> be opened — there is no recovery. Your PIN and settings are not included.</p>
          <div id="bkErr" role="alert" style="color:var(--red);font-size:13px;margin-top:10px;min-height:18px;"></div>`,
        footHtml: `<button class="btn btn-primary btn-block" id="bkGo">Download backup</button>`,
        onClose: () => end(false),
        onMount: (sheet) => {
          const $ = (s) => sheet.querySelector(s);
          $("#bkPw").oninput = () => $("#bkPw2Wrap").classList.toggle("hidden", !$("#bkPw").value);
          let busy = false;
          $("#bkGo").onclick = async () => {
            if (busy) return; const pw = $("#bkPw").value;
            if (pw && pw.length < 8) { $("#bkErr").textContent = "Use at least 8 characters."; return; }
            if (pw && pw !== $("#bkPw2").value) { $("#bkErr").textContent = "Passwords don't match."; return; }
            busy = true; $("#bkGo").disabled = true; $("#bkGo").textContent = pw ? "Encrypting…" : "Preparing…";
            try {
              const { obj, encrypted } = await create(pw);
              const size = save(obj, fname(encrypted));
              await DB.setSetting("lastBackupAt", Date.now());
              Toast.show(`Backup saved (${fmtBytes(size)})${encrypted ? " · encrypted" : ""}`, { type: "success" });
              end(true); Sheet.close();
            } catch (e) { console.error("[backup]", e.message); busy = false; $("#bkGo").disabled = false; $("#bkGo").textContent = "Download backup"; $("#bkErr").textContent = "Couldn't create the backup. Nothing was changed."; }
          };
        },
      });
    });
  }

  // ---------- UI: restore ----------
  function askPassword(text, envelope) {
    return new Promise((resolve) => {
      let settled = false; const end = (v) => { if (!settled) { settled = true; resolve(v); } };
      Sheet.open({
        title: "Encrypted Backup",
        bodyHtml: `<p class="muted" style="font-size:13.5px;line-height:1.6;margin-top:0;">This backup is password-protected. Enter the password you used when exporting it.</p>
          <div class="field"><label for="rsPw">Password</label><input id="rsPw" type="password" autocomplete="current-password"></div>
          <div id="rsErr" role="alert" style="color:var(--red);font-size:13px;min-height:18px;"></div>`,
        footHtml: `<button class="btn btn-primary btn-block" id="rsGo">Unlock</button>`,
        onClose: () => end(null),
        onMount: (sheet) => {
          const go = sheet.querySelector("#rsGo"), err = sheet.querySelector("#rsErr");
          go.onclick = async () => {
            go.disabled = true; go.textContent = "Checking…";
            try { const r = await open(text, sheet.querySelector("#rsPw").value); end(r.wrapper); Sheet.close(); }
            catch (e) { go.disabled = false; go.textContent = "Unlock"; err.textContent = e.message === "WRONG_PASSWORD" ? "Wrong password, or the file is damaged." : e.message; }
          };
        },
      });
    });
  }

  async function restoreFlow(file) {
    let text; try { text = await file.text(); } catch (e) { Toast.show("Couldn't read that file", { type: "error" }); return; }
    let wrapper;
    try {
      const r = await open(text);
      wrapper = r.needsPassword ? await askPassword(text, r.envelope) : r.wrapper;
    } catch (e) { Toast.show(e.message, { type: "error", duration: 5000 }); return; }
    if (!wrapper) return;

    const existing = await existingIds();
    const v = validate(wrapper.data, existing);
    if (v.errors.length) {
      Sheet.open({ title: "Can't use this backup", bodyHtml: `<p class="muted" style="font-size:13.5px;line-height:1.6;margin-top:0;">The file has problems, so nothing was imported:</p>
        <ul style="font-size:13px;line-height:1.7;padding-left:18px;">${v.errors.map(e => `<li>${Utils.escapeHtml(e)}</li>`).join("")}</ul>${v.errorCount > v.errors.length ? `<p class="faint" style="font-size:12px;">…and ${v.errorCount - v.errors.length} more.</p>` : ""}` });
      return;
    }
    const d = wrapper.data, rows = ["borrowers", "loans", "payments", "attachments"].map(s => {
      const list = d[s] || [], fresh = list.filter(r => !existing[s].has(r.id)).length;
      return `<div class="flex-between" style="padding:5px 0;font-size:13.5px;"><span class="muted" style="text-transform:capitalize;">${s}</span><span><b>${list.length}</b> <span class="faint">· ${fresh} new</span></span></div>`;
    }).join("");
    const cur = Object.fromEntries(["borrowers", "loans", "payments"].map(s => [s, existing[s].size]));

    Sheet.open({
      title: "Restore Preview",
      bodyHtml: `<div class="muted" style="font-size:12.5px;margin-bottom:8px;">Backup from ${Utils.fmtDateTime(wrapper.exportedAt)}${wrapper.format === "legacy" ? " · older format, no checksum" : " · checksum OK"}</div>
        <div class="card" style="background:var(--surface-2);">${rows}</div>
        <div class="faint" style="font-size:12px;margin:8px 0 12px;">On this device now: ${cur.borrowers} borrowers · ${cur.loans} loans · ${cur.payments} payments</div>
        ${v.warnings.length ? `<div class="card" style="background:var(--orange-soft);font-size:12.5px;line-height:1.6;margin-bottom:12px;">${v.warnings.map(w => `⚠ ${Utils.escapeHtml(w)}`).join("<br>")}</div>` : ""}
        <div class="field"><label>How to restore</label>
          <div class="seg" id="modeSeg"><button type="button" data-m="merge" class="active">Add missing</button><button type="button" data-m="replace">Replace all</button></div>
          <div class="hint" id="modeHint" style="line-height:1.5;">Adds only records that aren't already here. Nothing you have now is changed or deleted.</div></div>`,
      footHtml: `<button class="btn btn-ghost btn-block" id="rpNo">Cancel</button><button class="btn btn-primary btn-block" id="rpGo">Restore</button>`,
      onMount: (sheet) => {
        let mode = "merge"; const hint = sheet.querySelector("#modeHint"), go = sheet.querySelector("#rpGo");
        sheet.querySelectorAll("#modeSeg button").forEach(b => b.onclick = () => {
          sheet.querySelectorAll("#modeSeg button").forEach(x => x.classList.remove("active")); b.classList.add("active"); mode = b.dataset.m;
          hint.textContent = mode === "merge" ? "Adds only records that aren't already here. Nothing you have now is changed or deleted." : "Erases everything on this device and replaces it with the backup. A safety copy of your current data is downloaded first.";
          go.className = "btn btn-block " + (mode === "replace" ? "btn-danger" : "btn-primary"); go.textContent = mode === "replace" ? "Replace everything" : "Restore";
        });
        sheet.querySelector("#rpNo").onclick = () => Sheet.close();
        go.onclick = async () => {
          if (mode === "replace") {
            if (!(await Security.promptPin("Confirm with PIN", "Enter your PIN to replace all data."))) return;
            const ok = await confirmAction({ title: "Replace all data?", message: `This erases the ${cur.borrowers} borrowers, ${cur.loans} loans and ${cur.payments} payments on this device and replaces them with the backup. A safety copy of your current data will download first.`, confirmLabel: "Replace everything", danger: true });
            if (!ok) return;
            try { save((await create()).obj, fname(false, "before-restore")); } catch (e) { Toast.show("Couldn't create the safety copy — restore cancelled.", { type: "error" }); return; }
          }
          try {
            const r = await DB.importAll(d, { mode, skipExisting: mode === "merge" });
            Sheet.close(); Toast.show(`Restored ${r.added} record${r.added === 1 ? "" : "s"}`, { type: "success" });
            Router.stack = [{ view: "dashboard", params: {} }]; Router.render();
          } catch (e) { console.error("[restore]", e.message); Sheet.close(); Toast.show("Restore failed. Nothing was changed.", { type: "error", duration: 5000 }); }
        };
      },
    });
  }

  async function integrityFlow() {
    const r = await integrity();
    Sheet.open({ title: "Data Check", bodyHtml: `<p class="muted" style="font-size:13.5px;margin-top:0;">Checked ${r.counts.borrowers} borrowers, ${r.counts.loans} loans and ${r.counts.payments} payments.</p>
      ${r.issues.length ? `<div class="card" style="background:var(--orange-soft);font-size:13px;line-height:1.7;">${r.issues.slice(0, 20).map(i => `• ${Utils.escapeHtml(i)}`).join("<br>")}</div><p class="faint" style="font-size:12px;margin-top:10px;">Nothing was changed. Export a backup before fixing these by hand.</p>`
        : `<div class="card" style="background:var(--green-soft);font-size:13.5px;">✓ No problems found.</div>`}` });
  }

  const api = { create, open, parseText, validate, integrity, exportFlow, restoreFlow, integrityFlow, save, STORES };
  return api;
})();
window.Backup = Backup;
if (typeof module !== "undefined" && module.exports) module.exports = Backup;
