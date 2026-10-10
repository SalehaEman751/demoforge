# DemoForge runbook

## One-time setup

```
npm install
npm run setup          # Playwright chromium + the Ollama model
npm run setup:check    # one green/red line per item, with the fix command
```

`setup:check` verifies Node 20+, git, ffmpeg, Playwright chromium, Ollama at `DEMOFORGE_OLLAMA_URL` (default `http://localhost:11434`), the model in `DEMOFORGE_MODEL` (default `qwen2.5:7b-instruct`) pulled, ports 3000, 3100 and 4000 free, and 5 GB of free disk.

## Record the fallbacks (once, with everything working)

With the API running on port 4000:

```
npm run make:fallbacks
npm run make:fallbacks -- --api http://localhost:4000
```

It runs one demo against `samples/taskly` through the HTTP API only and writes `docs/fallback/cached-plan.json` (validated with `PlanSchema`) and `docs/fallback/cached-demo.mp4` (non-empty, real MP4). Commit both. Nothing is saved until it prints two green lines. Re-record them whenever the UI or the plan format changes.

## Start each service (one terminal each)

| Service | Command | Port |
| --- | --- | --- |
| Ollama | `ollama serve` | 11434 |
| Taskly sample app | `npm run dev -w @demoforge/sample-taskly` | 3100 |
| API | `[API START COMMAND: fill in when E7 lands]` | 4000 |
| Web UI | `[WEB START COMMAND: fill in when the web app lands]` | 3000 |

Warm the model once so the first live run is not slow: `ollama run qwen2.5:7b-instruct "hi"` (type `/bye` to leave).

## Demo-day checklist

### Night before
- [ ] `git pull`, `npm install`, `npm run setup:check` all green
- [ ] Fill every placeholder in `docs/pitch.md` (numbers from `eval/report.md`, names)
- [ ] Run `npm run make:fallbacks` and commit `docs/fallback/*`
- [ ] Play `docs/fallback/cached-demo.mp4` start to finish: does it show what you will say?
- [ ] Two full rehearsals with a timer, notes in the rehearsal log below
- [ ] Copy the repo and `docs/fallback/` to a USB stick or a second device
- [ ] Charge the laptop and any adapters (HDMI, USB-C); pack the power cable

### 1 hour before
- [ ] Apply the laptop settings below
- [ ] Start all four services, then `npm run setup:check` (ports will show busy now, that's expected; everything else must be green)
- [ ] Warm the model (command above)
- [ ] One complete live run end to end; watch the video
- [ ] Open the fallback pieces: a terminal tab with the cached-plan command typed but not run, and `cached-demo.mp4` open in the player, paused, in its own window
- [ ] Open the slides, check the numbers match `eval/report.md`
- [ ] Connect to the projector and check resolution

### 10 minutes before
- [ ] Power plugged in, Wi-Fi off, notifications off, other apps closed
- [ ] Services still running (taskly on 3100 responds, Ollama responds)
- [ ] Browser zoom set, tabs cleaned, demo window ready
- [ ] Reset taskly: clear its site data so signup starts fresh (open the app in a private window or clear `localStorage`)
- [ ] Water, phone on silent, slides on slide 1

## Laptop settings

- Disable sleep and screen lock (macOS: `caffeinate -d` in a spare terminal; Windows: Settings > Power > Screen and sleep > Never; Linux: `systemd-inhibit sleep infinity` or disable in Settings)
- Turn on Do Not Disturb / Focus; quit chat apps and mail
- Plug in power; set the power mode to best performance (the model is much slower on battery)
- Turn Wi-Fi off. Everything is local; this also proves it. (Turn it on beforehand only if you must `git pull`.)
- Close every other app, especially browsers with many tabs, Docker and video calls
- Set browser zoom (Ctrl/Cmd +) to 125% to 150% so the audience can read the page, and check the demo still fits on the screen
- Set the display scaling and resolution to match the projector; mirror, don't extend

## Fallback layers (in order)

Move down a layer as soon as the current one stalls for more than about 15 seconds. Do not debug on stage; say "let me show you a recorded run" and keep talking.

### Layer 1: live run
Normal flow: type the instruction in the UI, show stages, plan, video. Needs Ollama, taskly, API and web all up.

### Layer 2: cached plan (model slow or down)
Skips the model; everything else (launch, inspect, run, record) is still live. The cached plan is validated against the live page.

Switch (the command is already typed in the pre-opened terminal tab): stop the API with Ctrl+C, then

```
DEMOFORGE_CACHED_PLAN=docs/fallback/cached-plan.json <API START COMMAND>
```

Then submit the same instruction again. Restart time depends on how fast the API starts: **time this in rehearsal and write it in the log**. If it takes more than 10 seconds, treat layer 2 as too slow for the stage and go to layer 3.
Back to layer 1: restart the API without the variable.

### Layer 3: pre-recorded video (anything else broke)
Switch (under 10 seconds): switch to the pre-opened player window with `docs/fallback/cached-demo.mp4` and press play. No services needed. Say "this is a recording of the same run".
If the player window is lost: `open docs/fallback/cached-demo.mp4` (macOS), `xdg-open docs/fallback/cached-demo.mp4` (Linux), `start docs\fallback\cached-demo.mp4` (Windows).

Optional full-offline mode: `USE_MOCKS=1` makes every module return fixture data, so the UI still works with no browser or model, but it shows fixture data rather than a real run. Not a substitute for the video.

## Quick fixes

| Symptom | Command |
| --- | --- |
| Not sure what's wrong | `npm run setup:check` |
| Ollama down | `ollama serve` |
| Model missing | `ollama pull qwen2.5:7b-instruct` |
| Browser missing | `npm run setup` |
| Port busy | `lsof -i :3100` then `kill <pid>` |
| Video is `.webm` | install ffmpeg, rerun |

## Rehearsal log

| Date | Time taken (min:sec) | What broke | Fix / decision |
| --- | --- | --- | --- |
| `[DATE]` | `[MM:SS]` | `[ ]` | `[ ]` |
| `[DATE]` | `[MM:SS]` | `[ ]` | `[ ]` |
| `[DATE]` | `[MM:SS]` | `[ ]` | `[ ]` |
| | | | |
| | | | |

Also log: layer 2 switch time `[SECONDS]`, layer 3 switch time `[SECONDS]`.
