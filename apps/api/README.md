# @demoforge/api

Fastify server on `http://localhost:4000` (CORS for `http://localhost:3000`).

## Run

| Command (repo root) | What it does |
| --- | --- |
| `npm run dev` | Starts the server with live reload. Reads the repo-root `.env`. |
| `npm run demo:api` | Starts it with `USE_MOCKS=1` on a free port and a temp data folder, creates a job from `fixtures/job.json`, prints every event, exits 0 when the job is done (1 on error or after 60 s). |

## Endpoints

| Route | Notes |
| --- | --- |
| `POST /api/jobs` | `{ source, instructions?, startCommand?, port?, subdir?, allowAuthProbe?, fallback? }` returns `201 { id }`. `instructions` is optional guidance: missing or whitespace-only is stored as `""` and passed to the planner as is. `source` is required. `fallback` is `"cached-plan"` or `"cached-video"`. |
| `GET /api/jobs` | All jobs, newest first. |
| `GET /api/jobs/:id` | One `Job`. |
| `GET /api/jobs/:id/events` | Server-sent events. Every client first gets all earlier events, then live ones. Each frame is `id: <n>` and `data: <JobEvent JSON>` (no `event:` name, so `EventSource.onmessage` gets them all). Supports `Last-Event-ID`. The stream closes after a `done` or `error` event. |
| `GET /api/jobs/:id/video` | The recorded `mp4`/`webm`. Supports `Range` (206, 416) and `HEAD`, so `<video>` can seek. 404 `not_available` until the run has a video. |
| `GET /api/jobs/:id/log` | The runner's `run.log` as text. 404 `not_available` until it exists. |
| `GET /api/health` | Always 200: `{ ok, items: [{ id, label, ok, detail, fix? }] }` for Ollama, the model, ffmpeg and Playwright Chromium. A red item has a `fix` command. |

Errors use `{ error: { code, message } }`.

## Mock mode video

With `USE_MOCKS=1`, startup makes sure `apps/api/.cache/demo.mp4` exists (a 5 s 1280x720 ffmpeg test clip, generated once). Each finished mock job gets a copy at `.data/jobs/<id>/out/demo.mp4`, and `run.videoPath` points to it, so `/video` plays and seeks like a real run. Without ffmpeg the server logs one warning, starts anyway, and mock jobs have no video (`/video` returns 404 `not_available`).

## Fallback switches (demo-day safety net)

Both are read when a job starts, so they work without restarting the server.

| Switch | What happens |
| --- | --- |
| `DEMOFORGE_CACHED_PLAN=<file>` in `.env`, or `fallback: "cached-plan"` in the request | Launch and inspect run as usual. The plan is read from the file (env var first, else `docs/fallback/cached-plan.json`) and the AI model is not called. Repair is off too, since it also calls the model. Playwright still records live. A `log` event says the cached plan was used. The file can be a `Plan` or the runner's `run-log.json`. |
| `fallback: "cached-video"` in the request | Nothing is launched, planned or recorded. The job's video is `docs/fallback/cached-demo.mp4` (with Range support), and a `log` event plus `run.log` say so. The job has no plan or metrics. Wins over the cached plan. |

Missing or broken fallback files fail the job with `CACHED_PLAN_MISSING`, `CACHED_PLAN_INVALID` or `CACHED_VIDEO_MISSING`.

`docs/fallback/cached-demo.mp4` is a real 14 s recording of `samples/taskly` made with `fixtures/plan.json` (same as `cached-plan.json`). Replace both with your best run before the demo.

## Failed jobs

A failed job has `status: "failed"` and a plain-language `error`. Its last event is:

```json
{ "type": "error", "stage": "launching", "message": "The port is already used by another program. ...", "data": { "code": "PORT_IN_USE", "stage": "launching", "detail": "<original error>" } }
```

Codes and their messages live in `src/failure.ts`. A failing job never stops the server; the next job still runs.
