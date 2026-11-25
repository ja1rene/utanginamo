/* ============================================================
   security.js — PIN lock, throttling, auto-lock.
   HONEST LIMITS: the PIN only hides the app screen. It does NOT encrypt
   the IndexedDB data on this device. A 4–6 digit PIN can't resist an
   offline attack on stored data; the lockout only slows on-screen guessing.
   ============================================================ */
const Security = (() => {
  const FREE_TRIES = 5, MAX_LOCK_S = 900, ITER = 210000;
  const te = new TextEncoder();
  const hasCrypto = () => !!(globalThis.crypto && globalThis.crypto.subtle);
  const toB64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const legacyHash = (pin) => { let h = 5381; for (const c of String(pin)) h = ((h << 5) + h) + c.charCodeAt(0); return (h >>> 0).toString(16); };
  const rand = (n) => { const a = new Uint8Array(n); if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); return a; };

  async function hashPin(pin, saltB64) {
    if (!hasCrypto()) return "L:" + legacyHash(pin);   // insecure-context fallback (e.g. plain http)
    const key = await crypto.subtle.importKey("raw", te.encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(saltB64), iterations: ITER, hash: "SHA-256" }, key, 256);
    return toB64(bits);
  }
  async function getState() {
    const [enabled, salt, hash2, legacy, length, fails, lockUntil] = await Promise.all(
      ["pinEnabled", "pinSalt", "pinHash2", "pinHash", "pinLength", "pinFails", "pinLockUntil"].map(k => DB.getSetting(k, null)));
    return { enabled: !!enabled, salt, hash2, legacy, length: length || 4, fails: fails || 0, lockUntil: lockUntil || 0 };
  }
  async function isEnabled() { const s = await getState(); return s.enabled && !!(s.hash2 || s.legacy); }
  function isWeak(pin) {
    const p = String(pin);
    if (/^(\d)\1+$/.test(p)) return true;
    const d = [...p].map(Number);
    return d.every((x, i) => i === 0 || x === d[i - 1] + 1) || d.every((x, i) => i === 0 || x === d[i - 1] - 1);
  }
  async function setPin(pin) {
    const salt = toB64(rand(16));
    await DB.setSetting("pinSalt", salt);
    await DB.setSetting("pinHash2", await hashPin(pin, salt));
    await DB.setSetting("pinHash", null);
    await DB.setSetting("pinLength", String(pin).length);
    await DB.setSetting("pinFails", 0); await DB.setSetting("pinLockUntil", 0);
    await DB.setSetting("pinEnabled", true);
  }
  async function disablePin() {
    for (const k of ["pinHash2", "pinSalt", "pinHash"]) await DB.setSetting(k, null);
    await DB.setSetting("pinEnabled", false); await DB.setSetting("pinFails", 0); await DB.setSetting("pinLockUntil", 0);
    stopWatch();
  }
  /** Returns {ok} | {ok:false, locked, remainingMs} | {ok:false, attemptsLeft}. Lockout survives reloads (stored). */
  async function verify(pin) {
    const st = await getState(), now = Date.now();
    if (st.lockUntil > now) return { ok: false, locked: true, remainingMs: st.lockUntil - now };
    let ok = false;
    if (st.hash2) ok = (await hashPin(pin, st.salt)) === st.hash2;
    else if (st.legacy) { ok = legacyHash(pin) === st.legacy; if (ok) await setPin(pin); }   // silent upgrade to salted PBKDF2
    if (ok) { if (st.fails || st.lockUntil) { await DB.setSetting("pinFails", 0); await DB.setSetting("pinLockUntil", 0); } return { ok: true }; }
    const fails = st.fails + 1;
    await DB.setSetting("pinFails", fails);
    if (fails >= FREE_TRIES) {
      const secs = Math.min(MAX_LOCK_S, 30 * 2 ** (fails - FREE_TRIES));
      await DB.setSetting("pinLockUntil", now + secs * 1000);
      return { ok: false, locked: true, remainingMs: secs * 1000 };
    }
    return { ok: false, locked: false, attemptsLeft: FREE_TRIES - fails };
  }

  // ---------- UI: keypad ----------
  function pinPad(host, { length = 4, onComplete }) {
    let entry = "", len = length, disabled = false;
    host.innerHTML = `<div class="pin-dots" style="display:flex;justify-content:center;gap:14px;margin-bottom:22px;" aria-hidden="true"></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:264px;margin:0 auto;width:100%;">
        ${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k => k === "" ? `<span></span>` : `<button type="button" class="btn btn-ghost" data-k="${k}" aria-label="${k === "⌫" ? "Delete" : k}" style="font-size:22px;font-weight:700;padding:14px;min-height:56px;">${k}</button>`).join("")}
      </div><div class="pin-msg" role="alert" style="text-align:center;margin-top:16px;font-size:13px;min-height:20px;"></div>`;
    const dotsEl = host.querySelector(".pin-dots"), msgEl = host.querySelector(".pin-msg");
    const paint = () => { dotsEl.innerHTML = Array.from({ length: len }).map((_, i) => `<div style="width:16px;height:16px;border-radius:50%;border:2px solid var(--border-strong);background:${i < entry.length ? "var(--green)" : "transparent"};"></div>`).join(""); };
    const press = (k) => {
      if (disabled) return;
      if (k === "⌫") { entry = entry.slice(0, -1); paint(); return; }
      if (entry.length >= len) return;
      entry += k; paint();
      if (entry.length === len) { const e = entry; setTimeout(() => onComplete(e), 60); }
    };
    host.querySelectorAll("[data-k]").forEach(b => b.onclick = () => press(b.dataset.k));
    const onKey = (e) => { if (!host.isConnected) { document.removeEventListener("keydown", onKey); return; } if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("⌫"); };
    document.addEventListener("keydown", onKey); paint();
    return {
      reset() { entry = ""; paint(); },
      setMsg(t, err) { msgEl.textContent = t; msgEl.style.color = err ? "var(--red)" : "var(--text-dim)"; },
      setDisabled(v) { disabled = v; host.querySelectorAll("[data-k]").forEach(b => b.disabled = v); },
      setLength(n) { len = n; entry = ""; paint(); },
    };
  }
  function fmtWait(ms) { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; }
  function lockoutUI(pad, ms) {
    pad.setDisabled(true); const end = Date.now() + ms;
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) { pad.setDisabled(false); pad.setMsg("You can try again.", false); return; }
      pad.setMsg(`Too many wrong attempts. Try again in ${fmtWait(left)}.`, true); setTimeout(tick, 500);
    };
    tick();
  }
  function handleFail(pad, r) {
    pad.reset();
    if (r.locked) lockoutUI(pad, r.remainingMs);
    else pad.setMsg(`Incorrect PIN. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left before a temporary lock.`, true);
  }

  // ---------- UI: lock screen ----------
  let locking = null;
  function showLock() {
    if (locking) return locking;
    locking = new Promise(async (resolve) => {
      if (window.Sheet && Sheet.current) Sheet.close();
      const st = await getState();
      const overlay = document.createElement("div");
      overlay.id = "pinOverlay"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "App locked");
      overlay.style.cssText = "position:fixed;inset:0;background:var(--bg);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;overflow-y:auto;";
      const main = () => {
        overlay.innerHTML = `<div style="width:34px;height:34px;color:var(--green);margin-bottom:10px;">${Icons.lock}</div>
          <div class="h-display" style="font-size:22px;margin-bottom:6px;">Utanginamo</div>
          <div class="muted" style="font-size:13px;margin-bottom:26px;">Enter your PIN to continue</div>
          <div id="lockPad" style="width:100%;max-width:300px;"></div>
          <button class="btn btn-ghost btn-sm" id="forgotPin" style="margin-top:14px;border:none;background:none;color:var(--text-dim);">Forgot PIN?</button>`;
        const pad = pinPad(overlay.querySelector("#lockPad"), { length: st.length, onComplete: async (pin) => {
          const r = await verify(pin);
          if (r.ok) { overlay.remove(); locking = null; resolve(true); }
          else { handleFail(pad, r); overlay.style.animation = "shake .3s ease"; setTimeout(() => overlay.style.animation = "", 300); }
        } });
        overlay.querySelector("#forgotPin").onclick = forgot;
        if (st.lockUntil > Date.now()) lockoutUI(pad, st.lockUntil - Date.now());
      };
      const forgot = () => {
        overlay.innerHTML = `<div style="max-width:320px;width:100%;">
          <div class="h-display" style="font-size:20px;margin-bottom:10px;">Forgot your PIN?</div>
          <p class="muted" style="font-size:13.5px;line-height:1.6;">The PIN can't be recovered. The only way back in is to <b>erase all data on this device</b> and remove the PIN. If you have a backup file, you can restore it afterwards.</p>
          <div class="field"><label for="erTxt">Type ERASE to confirm</label><input id="erTxt" autocomplete="off" autocapitalize="characters"></div>
          <button class="btn btn-danger btn-block" id="erGo" disabled>Erase data &amp; remove PIN</button>
          <button class="btn btn-ghost btn-block" id="erBack" style="margin-top:10px;">Back</button></div>`;
        const t = overlay.querySelector("#erTxt"), go = overlay.querySelector("#erGo");
        t.oninput = () => go.disabled = t.value.trim() !== "ERASE";
        overlay.querySelector("#erBack").onclick = main;
        go.onclick = async () => { await DB.resetAll(); await disablePin(); location.reload(); };
      };
      document.body.appendChild(overlay); main();
    });
    return locking;
  }

  // ---------- UI: set / confirm PIN ----------
  function openSetPin(onConfirm, { title = "Set PIN", onCancel } = {}) {
    let len = 4, first = "", step = "first", done = false;
    Sheet.open({
      title,
      bodyHtml: `<div class="seg" id="lenSeg" style="max-width:240px;margin:0 auto 14px;"><button type="button" data-l="4" class="active">4 digits</button><button type="button" data-l="6">6 digits</button></div>
        <p id="pinPrompt" class="muted" style="font-size:13.5px;text-align:center;margin:0 0 16px;">Choose a PIN. 6 digits is harder to guess.</p><div id="padHost"></div>
        <p class="faint" style="font-size:11.5px;text-align:center;margin-top:14px;line-height:1.5;">The PIN hides the app on this device. It does not encrypt your data.</p>`,
      onClose: () => { if (!done && onCancel) onCancel(); },
      onMount: (sheet) => {
        const prompt = sheet.querySelector("#pinPrompt");
        const pad = pinPad(sheet.querySelector("#padHost"), { length: len, onComplete: async (e) => {
          if (step === "first") {
            if (isWeak(e)) { pad.reset(); pad.setMsg("Too easy to guess (repeats or a sequence). Pick another.", true); return; }
            first = e; step = "confirm"; prompt.textContent = "Enter it again to confirm"; pad.reset(); pad.setMsg("", false);
          } else if (e === first) { done = true; Sheet.close(); onConfirm(e, len); }
          else { step = "first"; first = ""; prompt.textContent = "Choose a PIN. 6 digits is harder to guess."; pad.reset(); pad.setMsg("PINs didn't match. Start again.", true); }
        } });
        sheet.querySelectorAll("#lenSeg button").forEach(b => b.onclick = () => {
          sheet.querySelectorAll("#lenSeg button").forEach(x => x.classList.remove("active")); b.classList.add("active");
          len = parseInt(b.dataset.l, 10); step = "first"; first = ""; pad.setLength(len); pad.setMsg("", false);
        });
      },
    });
  }
  /** Ask for the CURRENT PIN before a sensitive action. Resolves true/false. */
  function promptPin(title = "Enter PIN", desc = "Enter your PIN to continue.") {
    return new Promise(async (resolve) => {
      if (!(await isEnabled())) return resolve(true);
      const st = await getState(); let done = false;
      Sheet.open({
        title, bodyHtml: `<p class="muted" style="font-size:13.5px;text-align:center;margin:0 0 16px;">${Utils.escapeHtml(desc)}</p><div id="padHost"></div>`,
        onClose: () => { if (!done) { done = true; resolve(false); } },
        onMount: (sheet) => {
          const pad = pinPad(sheet.querySelector("#padHost"), { length: st.length, onComplete: async (pin) => {
            const r = await verify(pin);
            if (r.ok) { done = true; resolve(true); Sheet.close(); } else handleFail(pad, r);
          } });
          if (st.lockUntil > Date.now()) lockoutUI(pad, st.lockUntil - Date.now());
        },
      });
    });
  }

  // ---------- auto-lock ----------
  // autoLock setting: 0 = off, -1 = whenever I leave the app, N>0 = minutes of inactivity
  const watch = { timer: null, hiddenAt: 0, last: 0, mins: 0, on: false };
  const lockNow = () => { if (!locking) showLock(); };
  const onActivity = () => { const n = Date.now(); if (n - watch.last < 1000) return; watch.last = n; arm(); };
  const arm = () => { clearTimeout(watch.timer); if (watch.mins > 0) watch.timer = setTimeout(lockNow, watch.mins * 60000); };
  const onVis = () => {
    if (document.hidden) { watch.hiddenAt = Date.now(); return; }
    const away = watch.hiddenAt ? Date.now() - watch.hiddenAt : 0; watch.hiddenAt = 0;
    if (watch.mins === -1 || (watch.mins > 0 && away >= watch.mins * 60000)) lockNow(); else arm();
  };
  function stopWatch() {
    clearTimeout(watch.timer);
    if (watch.on) { ["pointerdown", "keydown", "touchstart"].forEach(e => document.removeEventListener(e, onActivity)); document.removeEventListener("visibilitychange", onVis); }
    watch.on = false;
  }
  async function startWatch() {
    stopWatch();
    if (!(await isEnabled())) return;
    watch.mins = Number(await DB.getSetting("autoLock", 5));
    if (!watch.mins) return;
    watch.on = true;
    ["pointerdown", "keydown", "touchstart"].forEach(e => document.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVis); arm();
  }

  async function checkPin() {
    if (!(await isEnabled())) return true;
    await showLock(); startWatch(); return true;
  }

  const api = { getState, isEnabled, isWeak, setPin, disablePin, verify, openSetPin, promptPin, showLock, startWatch, stopWatch, checkPin, FREE_TRIES };
  return api;
})();
window.Security = Security;
window.checkPin = Security.checkPin;
