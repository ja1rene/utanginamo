# Putting Utanginamo on GitHub Pages (and getting "Install" to appear)

## Upload
1. Create a repository, upload **everything in this folder** (including the hidden `.nojekyll` file, `icons/`, `fonts/`, `css/`, `js/`).
   Keep the folder structure exactly. File and folder names are **case-sensitive** on GitHub (`icons/icon-192.png` ≠ `Icons/Icon-192.png`).
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / folder `/ (root)` → Save.
3. Wait ~1 minute, open `https://<your-name>.github.io/<repo>/` (the trailing slash matters).

## Installing
* **Android / Chrome / Edge (desktop):** an "Install Utanginamo" banner appears, or open **Settings → Install app** inside the app and tap the button.
  Browser menu → *Install app* / *Add to Home screen* also works.
* **iPhone / iPad:** open the link in **Safari** → Share button → **Add to Home Screen**. (iOS never shows an install banner — this is how Apple does it.)
* If nothing appears, open **Settings → Install app → App health**. It tells you in plain words what is blocking it
  (not https, icons not loading, offline engine not running…).

## If it still won't install — checklist
| Symptom | Cause | Fix |
|---|---|---|
| Works in the browser tab but no install option | Old broken copy cached by the browser | Open DevTools → Application → *Service Workers* → **Unregister**, then *Clear site data*, reload |
| App health says "Icons load: Missing …" | Wrong file name / capital letters / folder not uploaded | Make names match `manifest.json` exactly; run `npm run audit` locally |
| Page shows but styles/fonts missing | A folder (`css/`, `fonts/`) wasn't uploaded | Re-upload; GitHub's web uploader skips empty/hidden items — drag the whole folder |
| 404 on the site | Pages not enabled, or you opened `…github.io/` without the repo name | Check Settings → Pages shows a green "live at" link |
| "Not secure" / no offline engine | Opened over `http://` | Use the `https://` address (GitHub Pages provides it) |
| Banner dismissed and never returns | The banner hides itself for 14 days after ✕ | Use **Settings → Install app** |
| Already installed, behaves old | The installed app updates when closed & reopened | Close it fully, reopen; accept the **Update available** banner |

## Before every push
`npm i` once, then `npm run audit` — it checks icon sizes, file names (exact capitalisation), the service-worker file list and the manifest.
`npm test` runs everything (finance, database, security, backup, calendar files, region formats, screens, PWA audit).
