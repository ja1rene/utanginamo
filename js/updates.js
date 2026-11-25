/* ============================================================
   updates.js — safe service-worker updates.
   A new version waits in the background. The user chooses when to apply it,
   and it is never applied while a form/sheet is open. IndexedDB is untouched.
   ============================================================ */
window.APP_VERSION = "3.2.0";
(function () {
  if (!("serviceWorker" in navigator)) return;
  let applying = false;

  function banner(worker) {
    if (document.getElementById("updateBanner")) return;
    const el = document.createElement("div"); el.id = "updateBanner"; el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:14px;right:14px;bottom:calc(96px + var(--safe-bottom));max-width:530px;margin:0 auto;background:var(--surface);border:1px solid var(--border-strong);border-radius:18px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:var(--sh-2);z-index:70;";
    el.innerHTML = `<div style="flex:1;"><div style="font-weight:700;font-size:13.5px;">Update available</div>
      <div class="muted" style="font-size:12px;">Your data is kept. Apply it when you're not mid-entry.</div></div>
      <button class="btn btn-primary btn-sm" id="updNow">Update</button>
      <button class="icon-btn" id="updLater" style="width:34px;height:34px;" aria-label="Later">${Icons.x}</button>`;
    document.body.appendChild(el);
    el.querySelector("#updLater").onclick = () => el.remove();
    el.querySelector("#updNow").onclick = () => {
      if ((window.Sheet && Sheet.current) || document.getElementById("pinOverlay")) { Toast.show("Finish or close what you're doing, then tap Update", { duration: 3500 }); return; }
      applying = true; el.querySelector("#updNow").textContent = "Updating…";
      worker.postMessage({ type: "SKIP_WAITING" });
    };
  }

  function start() {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) banner(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) banner(w); });
      });
      const check = () => reg.update().catch(() => {});
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    }).catch((e) => console.error("[Utanginamo] service worker failed:", e && e.message));
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (applying) location.reload(); });  // only reload when the user asked
  }
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
