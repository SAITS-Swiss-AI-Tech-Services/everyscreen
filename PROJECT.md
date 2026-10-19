# everyscreen

**What it does:** Shows every screen of an Expo Router app on one canvas you can pan, zoom and comment on. The screens and the arrows between them come from the app's code; the screenshots come from a phone, emulator or simulator. It also has an MCP server so AI agents can set it up and capture screens.
**Status:** internal tool
**Owner (dev):** Sahil

## Where it runs
- Server: none. It's a tool you run on your own machine.
- Folder on the server: none. It was built in `/home/deploy/sahils_space/2026_10_12_everyscreen` on lastos-dev; that folder was deleted on 19 Oct 2026 after everything was on GitHub.
- Containers: none

## Domains
- none

## Docker
- Dockerfile: none
- Image: none
- compose file: none
- Published ports: none. `everyscreen serve` starts a small local web server on `127.0.0.1:4173` (or the next free port).

## Data
- Databases: one SQLite file per app being reviewed, at `.everyscreen/data/board.sqlite` inside that app's folder (can be moved with `EVERYSCREEN_DB`). Screenshots are files under `.everyscreen/` too.
- Volumes holding real data: none
- Is it backed up? no. The data lives on whoever runs the tool.

## Environment
- Env vars it needs (all optional, none are secrets): `EVERYSCREEN_PROJECT`, `EVERYSCREEN_DB`, `ADB`, `ANDROID_SERIAL`, `CHROME`, `DEBUG`
- Where the values live now: nowhere. Defaults work without any of them.

## To run it locally
- `npm ci && npm run build && npm test` (these are what GitHub CI runs; passing as of 19 Oct 2026)
- `npm run demo` opens the example canvas in `examples/trailmix` (not tested yet)
- Needs Node 22.12 or newer. `ffmpeg` is optional (thumbnails and video posters).

## Known issues / anything odd
- The README's quick start uses `npx everyscreen ...`, but the package is not published on npm yet (404 on 19 Oct 2026). Until it is, people have to clone the repo and build it.
- Version 0.1.0, only 2 commits so far.
- Capturing screenshots needs `adb` for Android, or a booted iOS simulator (macOS only).
