# everyscreen

by [SAITS](https://saits.ai)

Every screen of your Expo Router app on one canvas you can pan, zoom and
comment on.

- **Screens and arrows come from your code.** `everyscreen` reads the `app/`
  routes and finds `router.push` / `replace` / `navigate` / `dismissTo`,
  `<Link href>`, `<Redirect>`, tab bars, and bottom sheets or dialogs, even
  when the call sits in a shared component or hook.
- **Screenshots come from your devices.** It opens each screen by deep link
  on an Android phone, emulator or iOS simulator and files the screenshot.
- **Your team reviews in the browser.** Pinned comments and issues, with
  status, severity, assignees and CSV export.
- **Built for agents too.** Every command has `--json`, and `everyscreen mcp`
  lets Claude Code, Cursor or any MCP client set up a canvas and capture the
  screens, looking at the device as it goes.

It runs locally (a small Node server with SQLite). No account needed.

## Quick start

In your app's folder (the one with `app/` and `package.json`):

```
npx everyscreen init                       # writes .everyscreen/config.json
npx everyscreen build --device "Pixel 8"   # scans the code, makes a canvas
npx everyscreen capture --missing          # screenshots every screen a deep link opens
npx everyscreen serve --open               # http://localhost:4173
```

`init` takes the name, routes folder, deep-link scheme and app id from
`app.json` / `app.config.*`. Requires Node 22.12 or newer. `ffmpeg` is
optional; it's used for thumbnails and video posters.

To see a finished canvas first, clone this repo and run
`npx everyscreen serve --project examples/trailmix`.

## Use it with an AI agent

Add the MCP server in your app's folder:

```
claude mcp add everyscreen -- npx -y everyscreen mcp            # Claude Code
```

```json
// .cursor/mcp.json, or any MCP client
{ "mcpServers": { "everyscreen": { "command": "npx", "args": ["-y", "everyscreen", "mcp"] } } }
```

Then ask, for example: *"Set up everyscreen for this app and capture every
screen on my phone."* The server tells the agent how to work through it:

| Tool | What it does |
|---|---|
| `status` | Is there a project here; its config and canvases with capture progress |
| `init`, `scan`, `build_board` | Set up, check what the code scan found, build or update a canvas |
| `list_screens` | Screens with capture status, deep link, route params, source file, and which screens link to it |
| `list_devices` | Android devices and emulators, booted iOS simulators |
| `capture_missing` | Captures everything a deep link can open; lists what needs navigating by hand |
| `capture_screen` | Captures one screen (opening its link, or what's on screen now) as a named state; returns the image |
| `device_screenshot`, `device_elements` | Look at the device: the screen as an image, and the elements on it |
| `device_open`, `device_tap`, `device_type`, `device_key`, `device_scroll` | Navigate to screens a deep link can't reach (sheets, dialogs, screens behind a form) |
| `add_capture` | File an image or clip that already exists |
| `start_viewer` | Start the web app and get its URL for the user |

Without MCP, agents can use the CLI: every command takes `--json` and prints
one JSON object, errors included (`{"error", "kind"}`). The exit code is 2
for usage errors and 1 for everything else.

## Commands

```
everyscreen init [dir]                 set up .everyscreen/ (--name --scheme --app-id --app-dir --force)
everyscreen scan                       what the code scan finds (--verbose: unfollowed calls, unreachable screens)
everyscreen build                      build or update a canvas (--board --device --os --resolution --title --force)
everyscreen boards                     list canvases
everyscreen screens                    a canvas's screens and capture status (--missing)

everyscreen capture <slug>             open a screen by deep link and capture it
                                       --param id=42  --state "error"  --no-link  --replace
everyscreen capture --missing          capture every screen a deep link opens on its own
everyscreen add <slug> <file>          add a screenshot or clip you took (--state --replace)
everyscreen ingest <dir>               add a folder of <slug>.png / <slug>--02-name.png files
everyscreen device list|shot|dump|tap|type|key|scroll|open

everyscreen serve                      run the web app (--port --host --open)
everyscreen mcp                        MCP server on stdio
```

Commands find `.everyscreen/` in the current folder or a parent
(`--project <dir>` to point elsewhere), and use the only or newest canvas
unless you pass `--board`.

### Canvases

A canvas (board) is the routes of one checked-out commit plus the captures
from one device. `build` names it after the release tag on that commit, else
the branch, else `current`:

- **Branch boards** follow your code. Rebuild them as often as you like.
- **Tag boards** (e.g. `v1.4.0`) are snapshots. Rebuilding one from other
  code is refused unless you pass `--force`, because its captures belong to
  that release.

Device fields and `--title` are remembered on later builds.

### Captures

Every screen has a slug (`tabs--profile`, `trail--_id_`). Captures live in
`.everyscreen/boards/<board>/screens/<slug>/`, one file per state, ordered by
name (`01-default.png`, `02-error.png`, `03-scroll.mp4`). You can also put
files there yourself and run `build`. Supported: PNG, JPEG and WebP stills,
MP4 and WebM clips, and HTML mockups (shown until there's a real capture).
Recordings that span several screens go in `screens/_flows/` with a
`flows.json`.

What `capture` can reach:
- **Routes with a deep link** open directly.
- **Dynamic routes** (`/trail/[id]`) need `--param id=<a real id>`.
- **Sheets, dialogs and screens behind a form** have no link of their own.
  Get there with `device tap/type/scroll` (or by hand), then
  `capture <slug> --no-link`.
- **Screens with `FLAG_SECURE`** capture as black, and are skipped.

### Devices

- **Android:** a phone with USB debugging, or an emulator, via `adb` on PATH
  or in `$ADB`. A phone on another machine works too: point adb at it with
  `ADB_SERVER_SOCKET`.
- **iOS simulators** (macOS): opening links and screenshots only. Navigate
  in the simulator yourself.

The device commands can only open links, read the screen, tap, swipe, type
and press keys. No command installs, uninstalls, clears app data, deletes
files or reboots, so it's safe to point an agent at your own phone.

## Configuration

`.everyscreen/config.json`. Every field is optional, and paths are relative
to the `.everyscreen/` folder:

| Field | Default | What it does |
|---|---|---|
| `name` | from `app.json` | Shown in the header, tab titles and CSV file names |
| `source` | `".."` | The app's folder |
| `appDir` | `"app"` | The Expo Router routes folder inside `source` |
| `scheme` | from `app.json` | Deep-link scheme (`myapp://`) |
| `appId` | from `app.json` | Android package / iOS bundle id, so links open in your app |
| `repo` | the `origin` remote | `owner/name` on GitHub, for links to code lines and commits |
| `skipDirs` | `[]` | Extra folders to skip when scanning |
| `groupTitles` | auto | `{ "(tabs)": "Tabs" }` |
| `titles` | from file names | `{ "/trail/[id]": "Trail" }` |
| `sheets` | `{ "dir": "components", "skip": [] }` | Where `*Sheet`, `*Modal`, `*Dialog`, `*Drawer`, `*Overlay` components count as screens; `skip` lists generic building blocks; `false` turns it off |
| `inPlace` | none | A component that swaps its content by name (`case 'grid': return <Grid />`): `{ "file": "components/AddSheet.tsx", "title": "Add sheet", "parent": "(tabs)", "calls": ["pushScreen"] }` |

Commit `config.json` and `boards/`. `init` writes a `.gitignore` that keeps
the comment database (`data/`) and generated thumbnails out of git.

## Reviewing

`serve` runs the web app. Drag to pan, and zoom with the wheel or a pinch.
`O` toggles the outline, `/` searches, `F` zooms to a screen, `0` fits
everything, and `?` lists every shortcut. Clicking a screen opens its panel:
route, deep link, source file, captures, and the code line of every link in
and out. Press `C` and click a screen to pin a comment or an issue (title,
severity, assignee, status). `/issues` lists all of them across canvases.
The download button exports the canvas as one large PNG.

Comments live in `.everyscreen/data/board.sqlite`. It's the only copy, so
back it up.

### Sharing with a team

`serve` listens on localhost only, and names are typed, not checked. To
share it, run it on a server behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/)
and set `CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com` and
`CF_ACCESS_AUD=<audience tag>`. The API then verifies the Access token on
every request and posts as the signed-in email. Run with `--host 0.0.0.0` only
behind such a proxy.

## Limits

- Expo Router only. The code scan is a fast tokenizer plus an import graph,
  not a type checker, so routes built at runtime stay unresolved. `scan
  --verbose` lists them, and each arrow says whether it's certain, guessed
  or inferred.
- Screens that need app state (logged in, data loaded, a form filled) need
  that state on the device before you capture them.
- iOS simulators: links and screenshots only.

## Contributing

```
npm install
npm run build && npm test     # builds the web app and CLI, runs the CLI tests against a fake phone
npm run dev                   # the web app with hot reload, on the example project
node dist/cli.js <command>    # the built CLI
```

`src/core/` is the code scan and canvas builder, `src/capture/` the device
layer, `src/server/` the web server and comments API, `src/mcp.ts` the MCP
server, and `ui/` the web app (React, React Flow). The example app's mockup
screenshots are rendered by `examples/trailmix/mockups/render.mjs`.

## License

[MIT](LICENSE)
