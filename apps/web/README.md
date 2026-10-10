# @demoforge/web

Next.js (App Router, TypeScript, Tailwind) UI for DemoForge, port 3000.

## Run

```bash
npm install                                  # repo root
npm run demo:web                             # API on :4000 with USE_MOCKS=1, and web on :3000, together (repo root)
```

`demo:web` runs `scripts/demo-web.mjs`: plain Node, no extra dependency, same on macOS, Linux and Windows. It prefixes each server's output with `[api]` / `[web]`, and Ctrl+C (or one server exiting) stops both. To run them separately: `USE_MOCKS=1 npm run dev` (API) and `npm run dev -w @demoforge/web` (web).

`NEXT_PUBLIC_API_URL` sets the API base URL (default `http://localhost:4000`; see `.env.example`).

## E8-1 scaffold

- `lib/api.ts`: typed, Zod-checked client (`createJob`, `listJobs`, `getJob`, `getHealth`, URL helpers). Errors become `ApiError { status, code, message }`; network failures have status 0.
- `lib/job-event-stream.ts`: EventSource follower. Dedupes by SSE `id` (event index), reconnects once on a drop, closes itself after `done`/`error`.
- `lib/useJobEvents.ts`: React hook. Loads `GET /api/jobs/:id` first, then follows the stream (the server replays all past events, also for finished jobs). The job is refetched on every stage event and when the stream ends or is lost.

## Test

`npm test -w @demoforge/web` (vitest, no browser needed).

## E8-2: page `/`

`components/JobForm.tsx` (project, optional instructions with 3 example chips, collapsible Advanced, trust checkbox, Generate demo) and `components/RecentJobs.tsx` (5 newest jobs, polls every 3 s while one is running). The button stays disabled until Project is filled, the trust box is ticked and the port (if given) is 1-65535. Instructions are optional because the API accepts an empty value (E11-4). The form always sends `allowAuthProbe: true`.

## E8-3: page `/jobs/[id]`

- `lib/job-view.ts` (pure, tested) derives the stage stepper, the per-step statuses and the log lines from the events plus the job. Events win; the job's `status` and `run.results` fill any gap, so the page is right even if the stream is lost.
- Reloading mid-run: the job gives the plan and current stage, and the replayed events rebuild step icons and the log.
- Components: `StageStepper`, `StepList` (pending, running, ok, repaired, failed, skipped icons), `LiveLog` (collapsible, follows new lines while scrolled to the bottom).

## E8-4: results

When a job is done, `components/Results.tsx` shows the video player, a download button, three metric cards and an expandable plan JSON. Time to demo is the largest text on the page (full-width card, `text-6xl`/`7xl`) next to the manual baseline and the speedup; plan success rate is the second card; the third card, "Steps self-repaired", reads "No repairs needed" when no step was repaired or failed. Formatting lives in `lib/metrics-view.ts` (tested). Cached-video jobs have no metrics or plan, so only the video and download show.

## E8-5: states and polish

- **Error card** (`components/ErrorCard.tsx`): friendly title, the message, `Error code: XXX` and a **Try again** button. Used when submitting fails (the card replaces the form; Try again shows the form again with every value kept, focus on Project), when a job fails (message from `job.error`, code from the error event's `data.code`, `JOB_FAILED` if none), and when a job cannot be loaded (`not_found` offers "Start a new demo"; other errors reload the page).
- **Values kept** (`lib/draft.ts`, tested): the form is saved in `sessionStorage` on submit, so Try again on the job page returns to the form with project, instructions, start command, port, subfolder and the trust tick. The saved form is dropped when a job finishes successfully. A job opened from the recent list has no saved form: project and instructions come from the job and the trust box starts unticked.
- **Video not available** (`lib/video-probe.ts`, tested): `Results` asks the API with a `HEAD` request; only a 404 replaces the player and the download button with "Video not available". Metrics and plan still show. If the player itself errors, the check runs again.
- **Look**: one accent color, defined once in `tailwind.config.ts` as `accent` (teal). Red is used only for errors and setup problems; everything else is neutral gray. System fonts only, no images. Base text is 16 px, 18 px from 1024 px wide up, body text is never below 16 px, gray text is dark enough for a projector, and spacing is generous. Layout is a single column that works from 375 px up (no sideways scroll).

## E8-6: health banner

`GET /api/health` is called once when `/` loads (`lib/useHealth.ts`). For every red item, `components/HealthBanner.tsx` shows the problem (label and detail) and the exact fix command from the API in a code box with a **Copy** button. A fix like `ollama serve, then ollama pull <model>` is split into one box per command (`lib/health-view.ts`, tested). If the health request itself fails, the banner says the API is not responding and shows `npm run dev`. **Check again** re-runs the check. The form is never disabled: while a check is red a warning sits under the Generate demo button.

Note: the checks look at the real tools. With `USE_MOCKS=1`, Ollama and the model are not needed, but the banner still reports them if they are missing.
