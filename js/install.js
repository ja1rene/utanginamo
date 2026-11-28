/* ============================================================
   install.js — "Install app" that actually works + self-diagnosis.
   The browser's install event fires ONCE and EARLY. index.html captures it
   into window.__bip before anything else runs, so it can't be missed (even
   behind the PIN screen). Settings always offers an Install button/instructions.
   ============================================================ */
const Install = (() => {
  const isStandalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const canPrompt = () => !!window.__bip;

  async function prompt() {
    const e = window.__bip; if (!e) return "unavailable";
    e.prompt(); const c = await e.userChoice; window.__bip = null; return c.outcome;
  }

  /** Read-only health check of everything the browser needs to offer installation. */
  async function diagnostics() {
    const d = { secure: !!window.isSecureContext, standalone: isStandalone(), ios: isIOS(), canPrompt: canPrompt(),
      swSupported: "serviceWorker" in navigator, sw: "none", controlled: false, cache: null, cachedFiles: 0, manifest: null, badIcons: [] };
    try {
      if (d.swSupported) {
        const r = await navigator.serviceWorker.getRegistration();
        if (r) d.sw = r.active ? "active" : (r.installing ? "installing" : (r.waiting ? "waiting" : "registered"));
        d.controlled = !!navigator.serviceWorker.controller;
      }
      if (window.caches) {
        const k = (await caches.keys()).find(x => x.startsWith("utanginamo-"));
        if (k) { d.cache = k; d.cachedFiles = (await (await caches.open(k)).keys()).length; }
      }
      const link = document.querySelector('link[rel="manifest"]');
      const res = await fetch(link.href, { cache: "no-store" });
      if (res.ok) {
        const m = await res.json(); d.manifest = { name: m.name, icons: (m.icons || []).length };
        for (const ic of m.icons || []) { try { const r = await fetch(new URL(ic.src, link.href), { cache: "no-store" }); if (!r.ok) d.badIcons.push(ic.src); } catch (e) { d.badIcons.push(ic.src); } }
      } else d.manifest = false;
    } catch (e) { if (d.manifest === null) d.manifest = false; }
    return d;
  }

  /** Plain-language "what do I do" for this device + the most likely blocker. */
  function advice(d) {
    if (d.standalone) return { state: "installed", text: "Utanginamo is installed on this device." };
    if (d.canPrompt) return { state: "ready", text: "Ready to install. Tap the button." };
    if (!d.secure) return { state: "blocked", text: "This page isn't served over https, so the browser won't allow installing. Use the https address of your site." };
    if (d.badIcons.length) return { state: "blocked", text: `The browser can't load these icons, so it won't offer install: ${d.badIcons.join(", ")}. Check the file names and capitalisation in your icons folder.` };
    if (d.manifest === false) return { state: "blocked", text: "The app manifest couldn't be loaded. Check that manifest.json is uploaded next to index.html." };
    if (d.swSupported && d.sw === "none") return { state: "blocked", text: "The offline engine (service worker) isn't running yet. Reload the page once, then check again." };
    if (d.ios) return { state: "manual", text: "On iPhone/iPad: open this page in Safari, tap the Share button, then “Add to Home Screen”." };
    return { state: "manual", text: "Open your browser menu (⋮ or ⋯) and choose “Install app” or “Add to Home screen”. If it isn't listed, the browser may have already installed it or may not support installing." };
  }

  // ----- small dismissible banner -----
  const DISMISS_KEY = "utang.installDismissedAt";
  const recentlyDismissed = () => { try { const t = +localStorage.getItem(DISMISS_KEY); return t && Date.now() - t < 14 * 864e5; } catch (e) { return false; } };
  function showBanner() {
    if (document.getElementById("installBanner") || isStandalone() || !canPrompt() || recentlyDismissed()) return;
    const el = document.createElement("div"); el.id = "installBanner"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Install app");
    el.style.cssText = "position:fixed;left:14px;right:14px;bottom:calc(140px + var(--safe-bottom));max-width:530px;margin:0 auto;background:var(--bg);border:1px solid var(--border-strong);border-radius:4px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:var(--sh-2);z-index:70;";
    el.innerHTML = `<div style="flex:1;"><div style="font-family:var(--font-display);font-size:18px;">Install Utanginamo</div><div class="muted" style="font-size:12.5px;">Open it like an app, even offline.</div></div>
      <button class="btn btn-primary btn-sm" id="installNow">Install</button><button class="icon-btn" id="dismissInstall" aria-label="Dismiss">${Icons.x}</button>`;
    document.body.appendChild(el);
    el.querySelector("#installNow").onclick = async () => { await prompt(); el.remove(); };
    el.querySelector("#dismissInstall").onclick = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {} el.remove(); };
  }
  window.addEventListener("utang:installable", showBanner);
  window.addEventListener("appinstalled", () => { window.__bip = null; const b = document.getElementById("installBanner"); if (b) b.remove(); });

  return { isStandalone, isIOS, canPrompt, prompt, diagnostics, advice, showBanner };
})();
window.Install = Install;
