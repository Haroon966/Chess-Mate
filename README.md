# Chess Coach

A static, installable chess game with spoken AI coaches. It is plain HTML/JS/CSS (no build step for the app itself), runs entirely in the browser, and works offline as a PWA. Hosted on GitHub Pages it needs no backend.

The game lives in `game/`. `tts/` holds the offline tooling that generated the coach voices.

## Features
- Play against bots of different strengths, or pass-and-play with two players.
- Own chess engine and bot (runs in a Web Worker), game review / analysis.
- Lessons and an AI coach with four voices (Ali, Zeeshan, Shoaib, Sameer) in English and Urdu, with captions.
- Resume your last game, history, settings, backup/restore.
- Installable on Android and iOS; works offline after the first visit; optional offline voice download.

## Pages (`game/`)
| Page | Purpose |
| --- | --- |
| `index.html` | Home |
| `play.html` | Choose a bot / start a game |
| `game.html` | The board (resume game) |
| `learn.html` | Lessons with the coach |
| `two-player.html` | Local two-player |
| `coach.html` | Pick coach and voice |
| `settings.html` | Settings, data backup/restore, offline voices |
| `history.html` | Past games |
| `about.html` | About / credits |
| `offline.html`, `404.html` | Offline fallback and GitHub Pages 404 |

All pages share the scripts in `game/` (`app.js`, `engine.js`, `coach/*.js`, ...). Every page includes the PWA tags from `game/scripts/head-snippet.html`; `build.js` fails if one is missing. **Every URL is relative**, so the site works under any subpath.

PWA files: `manifest.webmanifest`, `sw.js` (service worker), `pwa.js` (registration, install prompt, update toast, `window.PWA` API), `icons/`.

## Run locally
The service worker only works on `https://` or `http://localhost`, and `fetch()` of JSON is blocked on `file://`, so use a server:

```sh
cd chess/game
python3 -m http.server 8000
# open http://localhost:8000/
```
To check it behaves under a subpath like GitHub Pages: `cd chess && python3 -m http.server 8000` and open `http://localhost:8000/game/index.html`.

In dev (source tree, no stamped version) the service worker still registers; if you edit files and see stale content, see Troubleshooting. Generate a precache list for local testing with `node game/scripts/build.js --write-manifest`.

## Build, check, test
```sh
node game/scripts/build.js --check          # validate + size report, writes nothing
node game/scripts/build.js --out dist       # clean deployable tree (CI uses _site)
node game/scripts/test-pwa.js               # Playwright end-to-end PWA test (needs global playwright + Chrome)
python3 -I game/scripts/make-icons.py       # regenerate icons from pieces/white_pawn.png (needs Pillow)
```
`build.js` checks: no root-absolute URLs (`src="/..."`, `url(/...)`, `fetch('/...')`, ...), every local reference exists, manifest icons exist with the right pixel size, every page has the PWA head tags, and prints a size report (warns above 1 GB or for files above 50 MB; errors above 100 MB). It stamps the service-worker `CACHE_VERSION` with a content hash and writes `precache-manifest.json`.

Not deployed (excluded): `scripts/`, `tools/`, `tests/`, `test_*.js`, `validate_*.js`, `build-worker.js`, all `*.md`, `SPEC.md`, `lessonhunt*`, `.gitignore`.
> The build scripts live in `scripts/` rather than `tools/` because the repo-root `.gitignore` ignores any directory named `tools/`.

If you edit `engine.js`/`bot.js`, re-run `node build-worker.js` (from `game/`) to refresh `worker-src.js`.

## Deploy to GitHub Pages
1. Push this repo to GitHub (branch `master`).
2. Repo **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
3. Push a change under `chess/game/`, or run the workflow manually (**Actions -> Deploy chess to GitHub Pages -> Run workflow**). The workflow `.github/workflows/pages.yml` runs `build.js --out _site` and deploys it.
4. The site appears at `https://<user>.github.io/<repo>/` (project site, so everything is under `/<repo>/`; that is why all URLs are relative).

Verified under a simulated project subpath (`/REPO/`) and at a site root: all pages load without 404s, bots/review (Web Worker) work, the service worker scopes to the app folder, and everything except uncached voice clips works offline. GitHub Pages specifics: pages are served with `Cache-Control: max-age=600`, so a new deploy can take up to ~10 minutes to be picked up (the service worker script itself is always revalidated, then the "Update available" toast appears); `404.html` computes the right home link for project vs user sites; `localStorage` is per origin, so every project site under `USER.github.io` shares it (this app only uses keys starting with `chess`, and cache names starting with `chess-`). The first visit never downloads the ~180 MB of voice clips; they stream on demand (Pages supports HTTP Range).

Size notes: the coach audio is about 191 MB (5,264 mp3 clips). GitHub limits files to 100 MB (all are far below) and recommends published sites stay under about 1 GB, with a 100 GB/month soft bandwidth limit. Clips are fetched on demand, not at install, so visitors do not download the whole set unless they use "download voice".

## Install as an app
- **Android (Chrome):** open the site, use the in-app "Install" button or the browser menu -> *Install app* / *Add to Home screen*.
- **iOS (Safari):** tap Share -> **Add to Home Screen**. iOS has no install prompt, so the app shows a hint. Use Safari; other iOS browsers cannot install web apps (except in recent iOS versions where they may offer it too).
- **Desktop Chrome/Edge:** install icon in the address bar.

## Offline behaviour
- First visit precaches the app shell (pages, scripts, styles, piece images, icons, coach JSON; about 2 MB). After that every page works offline. Pages are fetched network-first (so updates arrive) with the cached copy as fallback; `offline.html` is shown for pages never cached.
- Coach voice clips are cached as they are played (cache-first, Range requests supported). In Settings you can pre-download a whole voice (one coach + one language, about 658 clips, ~25-45 MB) for fully offline coaching: `PWA.downloadVoice(coachId, lang, onProgress)`.
- When a new version is deployed you will see "Update available - Reload".
- JS API: `window.PWA` (`canInstall`, `install`, `isInstalled`, `isIOS`, `downloadVoice`, `cachedVoices`, `cacheSize`, `clearCaches`, `persist`, `update`, `swVersion`, `onChange`) and a `pwa-change` window event; see the header of `game/pwa.js`.
- Fonts from Google Fonts are cached after first use; without them Urdu text falls back to system fonts.

## Where your data is stored
Everything stays on your device; there is no server and no account. localStorage keys: `chessGameV1` (current game), `chessSettings`, `chessBot`, `chessColor`, `chessTc`, `chessMuted`, `chessCoach` and `chessCoachProgress` (coach settings and lesson progress); game history/larger data may use IndexedDB. Settings has backup (export) and restore (import). Clearing site data, uninstalling the app or using private browsing erases it, so export a backup first. iOS may purge storage of sites unused for weeks; installing to the Home Screen and `PWA.persist()` reduce that risk.

## Regenerate coach audio
```sh
cd chess/tts
python3 -m venv .venv
.venv/bin/pip install edge-tts
.venv/bin/python -I gen_coach_audio.py          # reads game/coach/lines.json + lessons.json, writes game/coach/audio/<coach>/<lang>/*.mp3 + manifest.json
```
Options: see `--help` in the script. Other TTS models (Kokoro/Piper/MMS) used for samples live in `tts/models/` and are gitignored. After regenerating, deploying again changes the service-worker version automatically. Read `NOTICE.md` about voice licensing first.

## Troubleshooting
- **Stale content / old version:** hard refresh (Ctrl+Shift+R), or DevTools -> Application -> Service Workers -> *Unregister*, then Storage -> *Clear site data*. In the app, "Clear offline data" calls `PWA.clearCaches()`.
- **Install button missing:** needs HTTPS (or localhost), a valid manifest, and not already installed. Chrome only fires the prompt after some engagement. iOS never shows one.
- **Works on localhost but not on GitHub Pages:** look for a root-absolute URL (`/foo`); run `node game/scripts/build.js --check`.
- **Voice silent offline:** that voice's clips were never downloaded or played online; download it in Settings.
- **Action shows 404 on deploy:** confirm Pages source is "GitHub Actions" and that `chess/game/scripts/` is committed (not hidden by `.gitignore`).
# Chess-Mate
