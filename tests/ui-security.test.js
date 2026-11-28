// Run: npm i fake-indexeddb jsdom && node tests/ui-security.test.js
require("fake-indexeddb/auto");
const { JSDOM } = require("jsdom"); const fs = require("fs"); const path = require("path"); const assert = require("assert");
const dom = new JSDOM(`<!DOCTYPE html><body><div id="appMain"></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window; w.indexedDB = global.indexedDB; w.IDBKeyRange = global.IDBKeyRange;
w.crypto = global.crypto; w.TextEncoder = global.TextEncoder; w.TextDecoder = global.TextDecoder; w.atob = global.atob; w.btoa = global.btoa;
w.Icons = new Proxy({}, { get: () => "<i></i>" }); w.Router = { go() {}, refresh() {}, stack: [], render() {}, updateBadge() {} };
const load = f => w.eval(fs.readFileSync(path.join(__dirname, "../js", f), "utf8")); w.Pages = {};
["finance.js", "utils.js", "db.js"].forEach(load);
w.eval(`window.emptyState=()=>"";window.statusTag=s=>s;window.loanRowHtml=()=>"";`);
["security.js", "backup.js", "install.js", "ics.js", "settings.js"].forEach(load);
const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));
const tap = async (root, digits) => { for (const d of digits) { root.querySelector(`[data-k="${d}"]`).click(); await wait(5); } await wait(500); };
(async () => {
  await w.DB.init(); w.Toast.init(); w.Sheet.init();
  let root = w.document.getElementById("appMain"); await w.Pages.settings(root);
  assert.ok(root.textContent.includes("does not encrypt") && root.textContent.includes("Last backup")); console.log("ok - settings renders with honest PIN + backup text");

  // enable PIN through the UI
  const tog = root.querySelector("#pinToggle"); tog.checked = true; tog.dispatchEvent(new w.Event("change")); await wait(100);
  let sheet = w.document.querySelector(".sheet"); assert.ok(sheet && sheet.textContent.includes("Choose a PIN"));
  await tap(sheet, "1111"); assert.ok(sheet.textContent.includes("Too easy")); console.log("ok - weak PIN blocked in UI");
  await tap(sheet, "7391"); assert.ok(sheet.textContent.includes("again")); await tap(sheet, "7391"); await wait(300);
  assert.equal(await w.Security.isEnabled(), true); console.log("ok - PIN set via UI");

  // lock screen
  const p = w.Security.showLock(); await wait(100);
  const ov = w.document.getElementById("pinOverlay"); assert.ok(ov && ov.getAttribute("role") === "dialog");
  await tap(ov, "0000"); assert.ok(ov.textContent.includes("4 tries left")); console.log("ok - wrong PIN shows tries left");
  for (let i = 0; i < 4; i++) await tap(ov, "0000");
  assert.ok(ov.textContent.includes("Too many wrong attempts") && ov.querySelector('[data-k="1"]').disabled); console.log("ok - keypad disabled during lockout");
  console.log("\nui security tests passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
