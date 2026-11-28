// Run: node tests/pwa-audit.test.js   — checks the things that stop browsers offering "Install", BEFORE you push to GitHub Pages.
const fs = require("fs"), path = require("path"); const root = path.join(__dirname, "..");
let failed = 0; const bad = (m) => { failed++; console.log("  ✗ " + m); }; const good = (m) => console.log("  ✓ " + m);
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
/** GitHub Pages is CASE-SENSITIVE (your Windows/Mac disk is not). Compare the real on-disk spelling. */
function existsExactCase(rel) { let cur = root; for (const part of rel.split("/").filter(Boolean)) { let names; try { names = fs.readdirSync(cur); } catch (e) { return false; } if (!names.includes(part)) return false; cur = path.join(cur, part); } return true; }
const png = (rel) => { const b = fs.readFileSync(path.join(root, rel)); if (b.slice(1, 4).toString() !== "PNG") return null; return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

console.log("Manifest");
let man; try { man = JSON.parse(read("manifest.json")); good("manifest.json is valid JSON"); } catch (e) { bad("manifest.json missing or invalid: " + e.message); process.exit(1); }
for (const k of ["name", "short_name", "start_url", "display", "icons"]) man[k] ? good(`has "${k}"`) : bad(`missing "${k}"`);
man.display === "standalone" ? good("display: standalone") : bad("display should be standalone");
existsExactCase(man.start_url.replace(/^\.\//, "").split("?")[0]) ? good(`start_url exists (${man.start_url})`) : bad("start_url file not found");
const sizesOk = { any: new Set(), maskable: new Set() };
for (const ic of man.icons) {
  const rel = ic.src.replace(/^\.\//, "");
  if (!existsExactCase(rel)) { bad(`icon not found (check spelling/capitalisation): ${ic.src}`); continue; }
  const d = png(rel); if (!d) { bad(`${ic.src} is not a real PNG`); continue; }
  const [w, h] = ic.sizes.split("x").map(Number);
  if (d.w !== w || d.h !== h) bad(`${ic.src}: manifest says ${ic.sizes} but the file is ${d.w}x${d.h} (Chrome rejects this)`); else good(`${ic.src} is ${ic.sizes}`);
  (ic.purpose || "any").split(/\s+/).forEach(p => sizesOk[p] && sizesOk[p].add(w));
}
[192, 512].forEach(s => sizesOk.any.has(s) ? good(`has a ${s}px "any" icon`) : bad(`needs a ${s}x${s} PNG icon with purpose "any"`));
sizesOk.maskable.size ? good("has a maskable icon") : bad("no maskable icon (Android shows a white box without it)");
for (const sc of man.shortcuts || []) for (const ic of sc.icons || []) existsExactCase(ic.src.replace(/^\.\//, "")) ? good(`shortcut icon ${ic.src}`) : bad(`shortcut icon missing: ${ic.src}`);

console.log("\nHTML");
const html = read("index.html");
/<link rel="manifest" href="\.\/manifest\.json">/.test(html) ? good("links the manifest") : bad("index.html must link ./manifest.json");
/name="viewport"/.test(html) ? good("viewport meta") : bad("missing viewport meta");
/beforeinstallprompt/.test(html) ? good("captures the install event early") : bad("install event is not captured early");
for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) existsExactCase(m[1]) ? 0 : bad(`index.html references a missing file: ${m[1]}`);
good("all files referenced by index.html exist (exact spelling)");
if (existsExactCase("icons/apple-touch-icon.png")) { const d = png("icons/apple-touch-icon.png"); d && d.w === 180 ? good("apple-touch-icon is 180x180 (iPhone home screen)") : bad("apple-touch-icon should be 180x180"); } else bad("icons/apple-touch-icon.png missing (iPhone icon)");
fs.existsSync(path.join(root, ".nojekyll")) ? good(".nojekyll present (GitHub Pages won't process files)") : bad("add an empty .nojekyll file");

console.log("\nService worker");
const sw = read("sw.js");
/addEventListener\("fetch"/.test(sw) ? good("has a fetch handler") : bad("service worker needs a fetch handler");
let CORE = [], OPT = []; try { CORE = new Function(sw.match(/const CORE = (\[[\s\S]*?\]);/)[1].replace(/^/, "return "))(); OPT = new Function(sw.match(/const OPTIONAL = (\[[\s\S]*?\]);/)[1].replace(/^/, "return "))(); } catch (e) { bad("could not read CORE/OPTIONAL lists from sw.js"); }
for (const f of CORE) { const rel = f === "./" ? "index.html" : f.replace(/^\.\//, ""); existsExactCase(rel) ? 0 : bad(`sw.js CORE lists a file that doesn't exist: ${f}  (install would FAIL)`); }
good(`all ${CORE.length} core files exist`);
const missingOpt = OPT.filter(f => !existsExactCase(f.replace(/^\.\//, ""))); missingOpt.length ? console.log("  ! optional files missing (app still works): " + missingOpt.join(", ")) : good(`all ${OPT.length} optional files exist`);
for (const f of fs.readdirSync(path.join(root, "js"))) if (f.endsWith(".js") && !CORE.includes("./js/" + f) && f !== "") console.log("  ! js/" + f + " is not in sw.js CORE (won't work offline)");
const css = read("css/styles.css"); for (const m of css.matchAll(/url\("\.\.\/([^"]+)"\)/g)) existsExactCase(m[1]) ? 0 : bad(`css references a missing font/file: ${m[1]}`);
good("fonts referenced by the stylesheet exist");

console.log(failed ? `\n${failed} problem(s) found — fix these before pushing.` : "\nPWA audit passed — browsers should offer Install once it's served over https.");
process.exit(failed ? 1 : 0);
