# DemoForge

DemoForge turns a web project plus plain-English instructions into a recorded demo video. It starts the project, reads which pages and controls really exist, and asks a local model (Ollama) to write a step-by-step plan. A browser then follows the plan, repairing steps that break, and records an MP4 with captions.

## Architecture

```
 instructions + repo/folder
            |
            v
  launcher --> inspector --> planner --> runner --> metrics
  (start app)  (pages and   (Ollama     (Playwright  (time saved,
               controls)     writes plan) + ffmpeg)    success rates)
                                ^           |
                                +-- repair -+   failed step -> model fixes it
            |
   apps/api (HTTP, port 4000) <--> apps/web (UI, port 3000)
```

Each box is a package under `packages/` with a mock that returns fixture data (`CONTRACTS.md`).

## Prerequisites

- Node 20 or newer, git, ffmpeg
- [Ollama](https://ollama.com/download), running locally
- About 5 GB of free disk (browser and model)
- Free ports 3000 (web), 3100 (taskly sample), 4000 (API)

## Install

```
npm install
npm run setup          # downloads Playwright chromium and runs: ollama pull qwen2.5:7b-instruct
npm run setup:check    # green/red line per item, with the fix command for each red one
```

Settings live in `.env.example` (copy to `.env`). The main ones are `DEMOFORGE_MODEL` (default `qwen2.5:7b-instruct`) and `DEMOFORGE_OLLAMA_URL` (default `http://localhost:11434`).

## Start

| Part | Command | Status |
| --- | --- | --- |
| Ollama | `ollama serve` | works |
| Taskly sample app (port 3100) | `npm run dev -w @demoforge/sample-taskly` | works |
| API (port 4000) | `npm run dev` (real modules) or `USE_MOCKS=1 npm run dev` (fixtures); details in `apps/api/README.md` | works |
| Web UI (port 3000) | `npm run dev -w @demoforge/web`; details in `apps/web/README.md` | works |
| API + web together, mock mode | `npm run demo:web` | works |

You normally don't need to start taskly yourself: the launcher starts any project you give it. Start it by hand only to look at it.

## Run a demo

Pieces that work today:

```
npm run demo:launcher -- samples/taskly          # start a project and print how it was launched
npm run demo:runner -- http://localhost:3100     # record a plan against a running app (see packages/runner)
```

A full demo is one job through the API (or the web UI at http://localhost:3000): send the project (a folder or a git URL) and the instructions to `POST /api/jobs`, follow `GET /api/jobs/:id/events`, then fetch `GET /api/jobs/:id/video`. `npm run make:fallbacks` does exactly this for taskly. Videos and logs land under `out/`.

## Impact metrics

Every finished job reports three numbers (type `Metrics` in `CONTRACTS.md`):

1. **Time to demo**: seconds from submit to finished video, shown next to the manual baseline (`DEMOFORGE_MANUAL_BASELINE_SEC`, default 9000 s, i.e. 2.5 hours by hand).
2. **Plan success rate**: share of planned steps that ended up working.
3. **Repair recovery rate**: of the steps that broke, the share the repair stage fixed so the demo still finished.

`computeMetrics` is the real module (`packages/metrics/src/compute.ts`); the fixture version is still exported as `computeMetricsMock`. Details: `packages/metrics/README.md`. `npm run demo:metrics -w @demoforge/metrics` prints metrics computed from `fixtures/run-result.json`.

## Supported projects and honest limits

- **Local only.** Everything runs on your machine: the model, the browser and the recording. Nothing is uploaded.
- **Standard npm projects.** A `package.json` with a start or dev script (Next, Vite, CRA; other npm/yarn/pnpm projects are tried with the framework treated as unknown).
- **Web apps only.** The demo is driven through a browser. No mobile, desktop or CLI apps.
- **No backend or secrets.** Projects that need a database, another service, or env vars you haven't set will fail to start. DemoForge says so but can't fix it.
- **Running a repo executes its code.** Installing dependencies and starting the dev server runs whatever the project says to run. Only use projects you trust, ideally in a VM or container.
- **A small local model makes mistakes.** Plans are checked against the real page, and broken steps get a repair attempt, but some demos will still fail or look rough. Fewer than 25 steps per plan.
- **Start command override** accepts only `npm|yarn|pnpm run <script>`.

## Troubleshooting

Run `npm run setup:check` first; it prints these fixes for you.

| Problem | What you see | Fix |
| --- | --- | --- |
| Ollama not running | "Ollama is not running" / could not reach `localhost:11434` | `ollama serve`, or point `DEMOFORGE_OLLAMA_URL` at the right server |
| Model missing | model not found / not pulled | `ollama pull qwen2.5:7b-instruct` (or your `DEMOFORGE_MODEL`) |
| Port busy | `PORT_IN_USE`, or setup check shows a port in use | `lsof -i :3100`, then `kill <pid>` (Windows: `netstat -ano \| findstr :3100`) |
| ffmpeg missing | video saved as `.webm`, not `.mp4` | `brew install ffmpeg` / `sudo apt install ffmpeg` / `winget install ffmpeg`, then run again |
| Repo needs env vars | `MISSING_ENV` or the app starts then crashes | export the variables listed in the repo's `.env.example` before starting DemoForge (`.env` files in the repo are not read) |
| Browser missing | Playwright says the executable doesn't exist | `npm run setup` |
| Model too slow | planning times out | use the cached plan, see `docs/runbook.md` |

## Eval harness

`eval/` (from the teammate copy) runs the same demo job N times through the HTTP API only and writes `eval/report.md` and `eval/report.json`:

```
npm run eval -- --runs 10 --source samples/taskly --instructions "Show how a user signs up and adds a task" [--variant renamed] [--dry]
```

It needs the API running (`npm run dev`, port 4000); `--dry` works without it but writes fake numbers. Full details: `eval/README.md`; baseline notes: `eval/baseline.md`.

## Demo-day fallbacks

`npm run make:fallbacks` records a cached plan and video; `docs/runbook.md` explains how to switch to each.

## Tests

```
npm run typecheck
npm test
```
