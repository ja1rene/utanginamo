# Utanginamo — Lending Ledger (v3.3.0)

Offline-first personal lending ledger. Plain HTML/CSS/JS + IndexedDB. No framework, no build step, no dependencies.
Design: **Ledger + Tape** — warm paper, ink, serif figures and hairline rules for the app; monospace paper-roll "tape" panels for receipts,
calculations and payment previews; a charcoal tape-roll dark theme. Fonts (Newsreader, IBM Plex Sans/Mono, SIL OFL) are bundled, so it looks the same offline.

## Run / deploy
Serve the folder over **https** (or `localhost`). See **GITHUB-PAGES.md** for GitHub Pages + install troubleshooting.
Quick local run:  `python3 -m http.server 8080`  then open http://localhost:8080

## Updating an existing install
1. In the current app: Settings → Export Backup (keep that file safe).
2. Replace ALL files with this folder's contents. (Your data lives in the browser, not in the files.)
3. Close the app completely (every tab / the installed app) and reopen — once or twice. Later updates show an "Update available" banner.
No database migration needed (database version is still 2).

## New in 3.3
* **Region & currency** (Settings): 23 currencies + custom symbol, 4 number styles (1,234.56 · 1,23,456.78 · 1.234,56 · 1 234,56), 5 date styles.
  One formatter (`Utils.money` / `Utils.fmtDate`) drives every screen, receipt and print. Display only: stored amounts are never converted.
  CSV exports always use plain numbers + ISO dates + a Currency column so spreadsheets read them correctly.
* **Add to calendar** (loan page, and Settings for all loans): a standard `.ics` file with alerts at 9:00 on the day and/or the day before.
  Works offline, no server; your calendar app notifies you even when Utanginamo is closed. Name/amount in the event are optional (amount off by default).
  Re-exporting replaces events (stable IDs) instead of duplicating them.
* **Install fixed**: the browser's install event is captured before anything else runs (it used to be missed behind the PIN screen), Settings has an Install
  button + an "App health" checklist, the service worker no longer aborts if an icon is missing, and real default icons are included.

## Files
index.html · manifest.json · sw.js · css/styles.css · fonts/ · icons/ · favicon.ico · .nojekyll
js/finance.js   ALL money math (integer centavos): interest, penalty, payment allocation, status, installments, report totals
js/utils.js     formatting, dates, Toast/Sheet/confirm UI    js/db.js   IndexedDB layer, atomic writes, cascade delete, restore
js/security.js  PIN (salted PBKDF2), lockout, auto-lock      js/backup.js  export / encrypted backup / validate / preview / restore
js/helpers.js   shared rows/tags/empty states                js/icons.js
js/install.js   install prompt + app-health checks            js/ics.js      calendar reminder files (.ics)
js/app.js       router, tabs, search, reminders, boot        js/updates.js  safe service-worker updates
js/dashboard.js borrowers.js loans.js payments.js calendar.js reports.js settings.js   screens
tests/          9 test suites incl. PWA audit (`npm i` then `npm test`)  — optional, not part of the app

## Financial rules (finance.js)
* totalDue = principal + interest + penalty − waivers.  remaining = principal left + interest left + penalty left.
* Penalty is one-time, fixed on the day after the due date: % of (principal+interest) still unpaid at the end of the due day, or a fixed amount.
* Payments apply penalty → interest → principal. A penalty can only be paid by a payment dated after the due day. Overpayments are blocked.
* Status is derived (never stored): active / overdue (from the day AFTER the due date) / paid; archived and cancelled are manual.
* Installment status is derived from payments; the last installment absorbs rounding; monthly dates stay anchored to the borrowed day.
* Payments are never deleted to correct mistakes: Void (with reason) or Correct (void + new). Voided payments are kept for audit.
* Reports: income = interest + penalties actually collected. Principal recovered is not income. Periods are calendar-based.

## Security & privacy — honest limits
* The PIN hides the app; it does NOT encrypt stored data. Anyone with access to this browser profile's storage can read it.
* Wrong-PIN lockout slows on-screen guessing only. A forgotten PIN can't be recovered (erase data, then restore a backup).
* Backups contain personal details. Use a password when exporting (AES-256-GCM via Web Crypto); a lost password can't be recovered.
* Clearing browser data or uninstalling can erase everything. Your backup file is the safety net.
* In-app notifications fire only while the app is open. For alerts while it's closed, use Add to calendar.

## What is NOT done (known limitations)
No cloud sync / multi-user / accounts. Reminders while the app is closed rely on your calendar app (.ics file), not on push notifications (browsers can't do that reliably, least of all iPhone). Date pickers in forms follow the browser's own style. Currencies with no decimals (e.g. JPY) are not offered. Not legally reviewed for lending regulations — check your local rules before lending to other people.
