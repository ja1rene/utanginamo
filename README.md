# Utanginamo — Lending Ledger (v3.2.0)

Offline-first personal lending ledger. Plain HTML/CSS/JS + IndexedDB. No framework, no build step, no dependencies.

## Run / deploy
Serve the folder over **https** (or `localhost`) — service workers and encryption need a secure context.
Quick local run:  `python3 -m http.server 8080`  then open http://localhost:8080
Any static host works (GitHub Pages, Netlify, Cloudflare Pages…). Put your PNGs in `icons/` (see icons/README.txt).

## Updating an existing install
1. In the current app: Settings → Export Backup (keep that file safe).
2. Replace ALL files with this folder's contents (keep your `icons/`).
3. Close the app completely (every tab / the installed app) and reopen — once or twice. Later updates show an "Update available" banner instead.
Your data lives in the browser's IndexedDB and is not touched by replacing files. No migration needed (database version is still 2).

## Files
index.html · manifest.json · sw.js · css/styles.css
js/finance.js   ALL money math (integer centavos): interest, penalty, payment allocation, status, installments, report totals
js/utils.js     formatting, dates, Toast/Sheet/confirm UI    js/db.js   IndexedDB layer, atomic writes, cascade delete, restore
js/security.js  PIN (salted PBKDF2), lockout, auto-lock      js/backup.js  export / encrypted backup / validate / preview / restore
js/helpers.js   shared rows/tags/empty states                js/icons.js
js/app.js       router, tabs, search, reminders, boot        js/updates.js  safe service-worker updates
js/dashboard.js borrowers.js loans.js payments.js calendar.js reports.js settings.js   screens
tests/          6 test suites (`npm i` then `npm test`)  — optional, not part of the app

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
* Reminders fire only while the app is open (no background push).

## What is NOT done (known limitations)
No cloud sync / multi-user / accounts. Currency symbol is configurable in utils.js (Utils.currencySymbol/locale) and the input prefix in
css (`--currency`) but there is no in-app currency picker yet. Date input follows the browser. Not legally reviewed for lending regulations.
