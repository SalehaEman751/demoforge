# eval

Runs the same demo job N times through the **HTTP API only** and prints a report. No package of this repo besides `@demoforge/shared` (types) is imported.

```
npm run eval -- --runs 10 --source samples/taskly --instructions "Show how a user signs up and adds a task" [--api http://localhost:4000] [--variant renamed] [--dry] [--timeout 900]
```

(from the repo root; or `npm run eval -- ...` inside `eval/`). Defaults: `--runs 10`, `--api http://localhost:4000`, `--timeout 900` (seconds to wait for one job). The report goes to stdout, progress to stderr, and `eval/report.md` plus `eval/report.json` are written (see Report). The exit code is 0 whenever the batch ran and a report was written; 2 for bad arguments.

## What one run does

1. `POST /api/jobs` with `{ "source": <source>, "instructions": <text> }`. The id is read from `id` (or `jobId`) in the response.
2. `GET /api/jobs/:id/events` until an event of type `done` or `error`. Server-sent events (`data: {...}`) and one-JSON-event-per-line are both understood. If the endpoint is missing or drops, the eval polls step 3 instead.
3. `GET /api/jobs/:id`, validated against `JobSchema`. If the job is not `done`/`failed` yet, it is polled every second until `--timeout`.

Jobs run strictly one after another. A failed job, an HTTP error, an unreachable API or a timeout becomes a row in the report (`failed` / `error`) and the batch carries on.

## How `--variant renamed` works

The Taskly sample switches "Add task" to "Add item" when the page is opened with `?variant=renamed` (it remembers the flag for the browser tab session, so entering once is enough). The eval **appends `?variant=renamed` to the job's source string**: `samples/taskly` becomes `samples/taskly?variant=renamed` (`&variant=renamed` if the source already has a query), and that string is sent as `source`.

This only works if the API/launcher splits the query off the source before treating it as a path or URL, and carries it onto the first page the plan opens (for example `/signup?variant=renamed`). That is **an assumption about the API, which is not built yet** (see `NOTES/contract-issues.md`). The report guards against a silent miss: if `--variant renamed` was set and no step was repaired in any run, it prints a WARNING.

## Report

Every invocation runs one batch, either **natural** (no `--variant`) or **renamed** (`--variant renamed`, the seeded failure), and updates `eval/report.json` and `eval/report.md`:

- The batch of the same variant is replaced; the other variant's batch is kept. So run the command once without `--variant` and once with it to fill both tables.
- Natural and seeded-failure runs always get **separate tables**, so the self-heal number is never mixed with ordinary runs.
- A `--dry` batch and a real batch are never combined: if the existing report is of the other kind it is replaced (a note is printed).

`report.json` has `generatedAt`, `dry`, `batches` (per variant: source, instructions, api, runs requested) and `runs`. Each run has `run`, `variant`, `status` (`done` | `failed` | `error`), `timeToDemoSec`, `metrics` (the job's own `Metrics`, or null), `errorCode`, `error`, `jobId`, `wallSec`, `stepsNeedingRepair`.

`report.md` has, per variant, an aggregate table (runs, completion rate, mean and median time to demo, mean plan success rate, mean repair recovery rate), a failures-by-error-code table and the per-run rows, then a **Headline numbers** block with three ready-to-paste sentences (natural runs feed sentences 1 and 3, seeded-failure runs sentence 2; a missing group says so instead of inventing a number; dry sentences start with `[DRY RUN, FAKE DATA]`).

How the numbers are defined:
- *Completion rate*: jobs whose status is `done`, over all runs. A done job can still contain failed steps; that shows in the plan success rate.
- *Time to demo, plan success rate*: from the job's metrics, over completed runs that have metrics.
- *Mean repair recovery rate*: the mean of each run's recovery rate, over the runs where something needed repair only (a run with no repair would score 1 and flatter the number). The headline sentence 2 uses repaired steps / steps that needed repair, summed over the seeded-failure runs.
- *Manual baseline* in sentence 1 is the job's `manualBaselineSec`, an assumption (see `packages/metrics/README.md`).

Error codes: `api_unreachable`, `http_error`, `bad_response`, `timeout`, `eval_error` (eval side) and `launch_failed`, `inspect_failed`, `plan_failed`, `run_failed` (the API said the job failed; the stage is read from which parts of the `Job` exist: no `info` = launch, no `brief`/`inventory` = inspect, no `plan` = plan, otherwise run). The Job contract has no error code of its own, so this is an inference.

## Manual baseline

`baseline.md` is a template for timing one demo by hand and turning it into the value for `DEMOFORGE_MANUAL_BASELINE_SEC`.

## `--dry`

Fakes the jobs from `fixtures/job.json` with no API: every 5th job is a simulated `plan_failed`; natural jobs need no repair, renamed jobs repair one step; times are shifted by the run number. It exists to test the report generator. `--source` and `--instructions` may be left out with `--dry`.

## Tests

`npx vitest run eval` (a fake API on a local port covers success, HTTP 500, failed job, missing events endpoint, newline-delimited events, a hung job, and an unreachable API). `npm --prefix eval run typecheck` type-checks the folder (`eval/` is not an npm workspace).
