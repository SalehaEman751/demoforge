# DemoForge audit

Read-only audit of the merged repo, 2026-10-10. The only file created is this one. Commands were run in a Linux cloud workspace (Node 22.22.0, ffmpeg 6.1.1, Playwright Chromium at `/opt/pw-browsers`, **no Ollama**, no display).

## (a) Summary

1. The build is green after a clean reinstall: `npm run typecheck` passes in all 10 workspaces, `npm test` gives 49 files and 534 tests passed, nothing skipped; Taskly Playwright tests give 3/3 smoke and 6/6 a11y.
2. Wiring works: the API registry loads the real function from all six packages, and a real job (launch, inspect, cached plan, run, metrics) finishes with 8/8 steps ok and a 128 KB video served over HTTP.
3. The biggest gap is **E3-5**: the inspector never signs up, so `/dashboard` is a redirect with 0 elements, and `validatePlan` rejects the shipped Taskly plan against the real inventory. Live model planning on Taskly is therefore likely to fail.
4. Two HTTP bugs break documented commands: a relative project path (`samples/taskly`) resolves from `apps/api` and fails with `NOT_FOUND`, and `?variant=renamed` is never stripped, so the pitch's self-heal moment and `npm run eval -- --variant renamed` cannot work as written.
5. Not verified here: anything needing Ollama (live planning, repair stage 2, `eval:planner`); `npm run verify` and CI do not exist; `eval/report.md` does not exist, so the pitch numbers are still placeholders.

## (b) Build health

| Check | Command | Result | Evidence |
|---|---|---|---|
| Clean install | `rm -rf node_modules && npm install` | OK, exit 0 | npm reports **15 vulnerabilities (5 moderate, 7 high, 3 critical)** |
| Typecheck | `npm run typecheck` | OK, exit 0, 10 workspaces, 0 `error TS` | inspector, launcher, metrics, planner, repair, runner, shared, api, web, sample-taskly |
| Typecheck `eval/` (outside workspaces) | `cd eval && npx tsc -p tsconfig.json` | OK | not covered by `npm run typecheck` |
| Unit and integration tests | `DEMOFORGE_HEADLESS=1 npx vitest run` (same as `npm test`) | **49 files, 534 tests passed, 0 failed, 0 skipped**, 409 s | ffmpeg present, so `runner.test.ts` and `mock-video.e2e.test.ts` `skipIf(!hasFfmpeg)` tests ran; `taskly-regression.test.ts` `skipIf(problem)` ran |
| Taskly smoke | `npm run test:smoke -w @demoforge/sample-taskly` | 3 passed | includes `?variant=renamed on /signup survives redirect` |
| Taskly a11y | `npm run test:a11y -w @demoforge/sample-taskly` | 6 passed | |
| `npm run verify` | | **Does not exist** | no `verify` key in root `package.json`; no `.github/` folder |
| Setup check | `npm run setup:check` | 2 checks failed: Ollama not reachable, model not checked | all other checks green (Node, git, ffmpeg, Chromium, ports 3000/3100/4000, disk) |

Conditionally skipped tests (skip did not trigger here): `packages/runner/src/runner.test.ts:84,301,315` and `apps/api/src/mock-video.e2e.test.ts:64,82` skip without ffmpeg; `packages/runner/src/taskly-regression.test.ts:79` skips when Chromium or the Taskly dev server cannot start. Tests that need Ollama: none; the planner and repair tests use fake servers (`plan-demo.integration.test.ts`, `repair.test.ts > counts a give-up when ... stage 2 is down`).

## (c) Ticket table

Ticket texts are not in the repo, so status is judged from code, tests, READMEs and `NOTES/contract-issues.md`. "Done" means the behaviour exists and a test or runnable demo covers it.

| ID | Status | Evidence | Note |
|---|---|---|---|
| E0-5 | Unclear | `tsconfig.base.json`, `.nvmrc`, `engines.node >=20`, `apps/api/src/app.ts` `installCrashGuards` | No ticket text or reference anywhere in the repo; cannot map it |
| E1-1..E1-4 | Done | `samples/taskly/app/{page,signup/page,dashboard/page}.tsx`; `tests/smoke.pw.ts > sign up and add one task`; `tests/a11y.pw.ts` (6) | Pages, localStorage, a11y names all covered |
| E1-5 | Done | `samples/taskly/lib/variant.ts`; `smoke.pw.ts > ?variant=renamed on /signup survives redirect` | Flag works in the app; passing it through the API does not (see (d)) |
| E2-1 | Done | `launch.ts`, `launch.test.ts`; `npm run demo:launcher` ran | Local folder launch |
| E2-2 | Done | `resolve-source.ts`, `resolve-source.test.ts > git clone > CLONE_FAILED and removes the partial folder` | https and git@ only |
| E2-3 | Done | `detect.ts`, `detect.test.ts` (35), `command.test.ts` (54) | Detect, start, health poll |
| E2-4 | Done | `errors.ts`, `classify.test.ts` (32) | Codes do not match the API's list (see (d)) |
| E3-1 | Done | `brief.ts`, `brief.test.ts > reads the Taskly sample` | |
| E3-2, E3-3 | Done | `crawl.ts`, `crawl.test.ts > crawl: one page (E3-2)`, `crawl: many pages (E3-3)` | No `heading` entries, unlike the fixture |
| E3-4 | Unclear | `inspect.ts`, `npm run demo:inspector` runs | No reference to E3-4 in the repo |
| E3-5 | **Missing** | `grep allowAuthProbe packages/inspector` finds nothing; live inventory: `/dashboard -> /signup (0 el)` | API passes `allowAuthProbe` (`pipeline.test.ts > does not allow the auth probe unless the job opted in`) but the inspector ignores it |
| E4-1 | Done | `ollama.ts`, `ollama.test.ts` (17) | Against a fake server only |
| E4-2 | Done | `prompt.ts`, `prompt.test.ts` (8) | |
| E4-3 | Done | `plan-demo.ts`, `validate.ts`, `plan-demo.test.ts` (12), `validate.test.ts` (21) | Validator rejects valid Taskly plans with the real inventory (risk 1) |
| E4-4, E4-5 | Done (mapping inferred) | `eval.ts`, `eval-cli.ts`, `eval.test.ts` (6), `npm run eval:planner` | Not run: no Ollama |
| E4-6 | Done | `plan-demo.ts:41` `cachedPlan`, `cached-plan.test.ts` (6), `apps/api/src/fallback.test.ts` | Empty instruction works: `prompt.ts:60`, `prompt.test.ts:64`, `instructions.e2e.test.ts`. **No empty-instruction case** in `eval.ts:7-20` |
| E5-1..E5-5 | Done | `runner.ts`, `actions.ts`, `overlay.ts`, `recording.ts`, `inventory.ts`; `runner.test.ts`, `demo-site.test.ts`, `overlay.test.ts`, `inventory.test.ts` | `demo:runner` works only with `DEMOFORGE_HEADLESS=1` on a machine without a display |
| E6-1..E6-4 | Partial | `stage1.ts`, `stage2.ts`, `stats.ts`, `repair.test.ts`, `stage1.test.ts`; `npm run demo:repair`: 6 of 8 fixed in stage 1 | Stage 2 (Ollama) only tested with Ollama down; never run against a model here |
| E7-1..E7-4 | Done | `server.ts`, `store.ts`, `registry.ts`, `events.ts`, `pipeline.ts`; `server.test.ts`, `registry.test.ts > uses every mock when USE_MOCKS=1`, `events.test.ts > replays history`, `mocks.e2e.test.ts > a late SSE client gets every earlier event` | `stop()` always runs: `pipeline.ts:196-201`, `mocks.e2e.test.ts > stop() is called for a failure in every stage after launch` |
| E7-5 | Partial | `failure.ts`, `failure.test.ts` | Real launcher codes `NO_START_SCRIPT`, `NOT_FOUND`, `NEEDS_BACKEND`, `INVALID_ARGS`, `INVALID_PACKAGE_JSON` missing from `FAILURE_MESSAGES`; planner errors have no code |
| E7-6 | Done | `health.ts`, `health.test.ts` (9); live `GET /api/health` returned 4 items plus `mocks` | |
| E7-7 | Done | `settings.ts`, `fallback.test.ts` (12) | Cached plan is only `PlanSchema`-checked (`pipeline.ts:50`) |
| E8-1..E8-6 | Done | `apps/web/lib/*.test.ts` (6 files, 50 tests), `npm run demo:web` served `/` and `/jobs/:id` with HTTP 200; `next build` succeeded | Components have no browser test |
| E9-1 | Done | `packages/metrics/src/compute.ts`, `metrics.test.ts` (10) | |
| E9-2 | Partial | `eval/src/cli.ts`, `client.test.ts` | Documented `--source samples/taskly` fails (`NOT_FOUND`); `--variant renamed` cannot work |
| E9-3 | Done | `eval/src/report.ts`, `report.test.ts` (13) | |
| E9-4 | Partial | `eval/baseline.md` | Baseline is still the 9000 s assumption; `eval/report.md` does not exist |
| E10-1 | Done | `scripts/check-setup.ts`, `scripts/setup.ts`; `setup:check` ran | No tests (runnable script) |
| E10-2 | Partial | `scripts/make-fallbacks.ts` | Fixed to send `source` in the merge; not run in this audit |
| E10-3 | Done | `README.md`; every `npm run` command in README, runbook and package READMEs exists (script check) | |
| E10-4 | Partial | `docs/pitch.md`, `docs/runbook.md` | 18 distinct placeholders; runbook `<API START COMMAND>` and a false claim (see (g)) |
| E11-1 | Partial | `runner.ts:59` and `health.ts:54` import Playwright lazily | `packages/inspector/src/crawl.ts:1` still imports `chromium` eagerly |
| E11-2 | Done | `packages/runner/src/overlay.test.ts` (5) | |
| E11-3 | Done | `runner/src/inventory.ts` `toElementInventory`, `inventory.test.ts`; NOTES E5-5 | |
| E11-4 | Done | `apps/api/src/instructions.e2e.test.ts` (5), `server.test.ts` | |
| E11-5 | **Missing** | no `verify` script, no `.github/workflows` | |
| E11-6 | Done | `packages/runner/src/taskly-regression.test.ts` (Case A and Case B passed) | |
| E11-7 | **Missing** | no test drives `apps/web` against the API; `mocks.e2e.test.ts` is API only | |
| INT-1..INT-6 | Unclear | no INT reference in the repo | Integration evidence from this audit: real-module registry, a real job done end to end, `demo:web` job done |

## (d) Contract mismatches

| # | Mismatch | Evidence | Impact |
|---|---|---|---|
| 1 | Relative `source` is resolved against the API's working folder (`apps/api`), not the repo root | `resolve-source.ts:142` `path.resolve(source)`; live POST `samples/taskly` gave `Folder not found: .../apps/api/samples/taskly`, code `NOT_FOUND` | `npm run eval` with documented args, and any relative path typed into the web form, fail |
| 2 | `?variant=renamed` appended to `source` is never stripped | live POST `./samples/taskly?variant=renamed` gave `NOT_FOUND`; `grep variant apps/api/src packages/launcher/src` finds nothing | Pitch step 7 and eval seeded-failure batch cannot run |
| 3 | Inspector cannot see pages behind login, so the validator rejects correct Taskly plans | live: inventory `/, /dashboard -> /signup (0 el), /signup`; `validatePlan(docs/fallback/cached-plan.json)` returned `step 6: no textbox named "New task" on /signup`, `step 7: no button named "Add task"` | Live planning likely ends in `PlanError` (inferred; model not run) |
| 4 | API's cached plan is not validated against the page; the planner's cached plan is | `apps/api/src/pipeline.ts:50` (`PlanSchema` only) vs `packages/planner/src/plan-demo.ts:59` (`judge` with `validatePlan`) | Same env var, two behaviours; runbook claims the stricter one |
| 5 | Launcher error codes vs API messages | `launcher/src/errors.ts:1-13` vs `apps/api/src/failure.ts:31-45` (`NO_START_COMMAND`, `SOURCE_NOT_FOUND`) | Generic prefix plus raw message, e.g. "The project could not be started. Folder not found: ..." |
| 6 | Planner errors carry no `code`; `OllamaError` is not in `DOMAIN_ERROR_NAME` | `planner/src/ollama.ts:15`, `plan-demo.ts:17`, `failure.ts:90` | Code guessed from message text |
| 7 | `POST /api/jobs` body uses `source`; CONTRACTS documents `runJob({ projectSource })` | `apps/api/src/store.ts:17`, `CONTRACTS.md` mocks table, `apps/api/src/mock.ts:4` | eval and make-fallbacks fixed in the merge; CONTRACTS.md not updated |
| 8 | Job id field | API answers `201 { id }` (`server.ts:81`); eval accepts `id`/`jobId`, make-fallbacks `id`/`jobId`/`job.id`, web reads `id` | Consistent; no action |
| 9 | `InspectProjectFn` has no `allowAuthProbe` | `apps/api/src/registry.ts` local `InspectArgs`; NOTES E7-2 | Flag reaches nothing (row 3) |
| 10 | `Job` has no `errorCode` | NOTES E7-4 (2), E8-5 (2) | Code only in the SSE error event |
| 11 | `GET /api/health` shape not in CONTRACTS | `health.ts`; web normalises (`apps/web/lib/api.ts:38`) | Docs only |
| 12 | `PlanDemoFn` has no `baseUrl` | `plan-demo.ts:73` derives `http://localhost:<port>` | Fine for localhost |
| 13 | Inspector inventory has no `heading` entries; fixture does | NOTES E3-2/E3-3 | Fewer `assert_text` anchors for the model |
| 14 | `fixtures/metrics.json` `manualBaselineSec: 1800` vs default 9000 | NOTES E9-2; live mock eval headline said "about 30 minutes" | Mock-mode numbers disagree with real runs |
| 15 | `@demoforge/shared` root pulls in `node:fs` | NOTES E8-1 (2) | Web imports schemas by deep path |

Package imports: no package imports another epic's package (`grep` over `packages/*/src`: only `@demoforge/shared`; every `packages/*/package.json` depends only on `@demoforge/shared`). Exceptions by design: `apps/api/src/registry.ts` imports all six packages (E7-2 ticket, NOTES E7-2 (3)); `packages/shared/src/mocks.test.ts:13-19` imports each `mock.ts` by relative path (test only). Signatures: `inspectProject satisfies InspectProjectFn`, `computeMetrics: ComputeMetricsFn`, `repairStep: RepairStepFn`, `runPlan: RunPlanFn`, `validate.ts:127` `ValidatePlanFn`; `launchProject` and `planDemo` are checked through the typed loaders in `registry.ts`, which typecheck.

## (e) Ollama call map

Ollama was **not available** (`setup:check`: "Ollama reachable at http://localhost:11434: fetch failed"), so `npm run eval:planner -w @demoforge/planner` was not run, and `npm run demo:repair` ran with stage 2 failing: "Fixed 6 of 8 (stage 1: 6, stage 2: 0, gave up: 2)".

| Caller | Endpoint | Model / URL env | Timeout | Output format | Output validated | Ollama down | Model missing |
|---|---|---|---|---|---|---|---|
| `planner/src/plan-demo.ts:80` `planDemo` via `ollama.ts` `chatJsonRaw` | POST `/api/chat`, `stream:false`, temp 0.2, `num_ctx` 8192, `keep_alive` 10m | `DEMOFORGE_MODEL`, `DEMOFORGE_OLLAMA_URL` (`ollama.ts:20-21`) | 90 s per call (`CHAT_TIMEOUT_MS`), up to 3 calls | `format` = `PLAN_JSON_SCHEMA` | Yes: `PlanSchema`, then `validatePlan`; one retry and one re-plan, then `PlanError` | `OllamaError` "Ollama is not running: run ollama serve" | `OllamaError` "Model not found: run ollama pull ..." |
| `ollama.ts:125` `warmUp` (eval-cli) | POST `/api/chat`, `num_predict` 4 | same | 90 s | none | Reply shape only (`ChatReply`) | same | same |
| `ollama.ts:105` `health` (planner demo, eval-cli) | GET `/api/tags` | same | 5 s | n/a | `TagsReply` Zod | returns `{ ok:false }` | returns `{ ok:false }` |
| `repair/src/stage2.ts:24` `stage2Ask` | POST `/api/chat`, `format:"json"`, temp 0, `num_ctx` 8192, no `keep_alive` | yes (`stage2.ts:24,28`) | 60 s per call; runner allows 2 attempts per step (`runner.ts:22`) | JSON | Yes: Zod `Answer`, and the element must exist in the inventory | Returns `null` silently | Returns `null` silently |
| `apps/api/src/health.ts:81` `checkHealth` | GET `/api/tags` | yes (`health.ts:45-46`) | 3 s | n/a | Zod | Red item, fix `ollama serve` | Red item, fix `ollama pull` |
| `scripts/check-setup.ts:55` | GET `/api/tags` | yes (`:10-11`) | 5 s | n/a | yes | Red line | Red line |
| `scripts/setup.ts:18` | runs `ollama pull <model>` | `DEMOFORGE_MODEL` only | none | n/a | exit code | exits with hint | n/a |

Note: a slow model can stall a job for up to 4.5 minutes in planning (3 x 90 s) and up to 2 minutes per broken step in repair (2 x 60 s).

## (f) Safety findings

| Check | Result | Evidence |
|---|---|---|
| Validator limits navigation to the app origin | OK | `planner/src/validate.ts:91-92` |
| Runner limits navigation to the app origin | **Partial** | `runner/src/actions.ts:23-33` checks `navigate` steps only; no `context.route` or navigation guard in `runner/src` (grep). A click on an off-site link is not blocked; `docs/pitch.md` question 3 admits this |
| Inspector stays on origin | OK | `inspector/src/crawl.ts:94-106` aborts cross-origin requests and redirects |
| `startCommand` override restricted | OK | Only `npm|yarn|pnpm run <script>` with a known script (NOTES E2-4 (2)); `command.test.ts > a command with shell injection is refused without install, start or side effects` |
| Git clone accepts only https:// and git@ | OK | `resolve-source.ts:44-73`, plus `GIT_ALLOW_PROTOCOL: "https:ssh"` (`:38`) |
| Temp clone folders removed | OK | `resolve-source.ts:146-147`, `lifecycle.ts:99,109`; `resolve-source.test.ts > CLONE_FAILED and removes the partial folder` |
| Child processes killed (stop, SIGINT, SIGTERM, crash) | OK | `lifecycle.ts:8-30,59-77` (process-group kill, SIGKILL after grace); `launch.test.ts > cleanup when the host process dies` |
| API always calls `stop()` | OK | `apps/api/src/pipeline.ts:196-201`; `pipeline.test.ts > a failing stop() does not change the outcome` |
| No secrets or `.env` committed | OK | only `.env.example` and `apps/web/.env.example`; no key patterns found (grep) |
| `.gitignore` covers node_modules, .next, out/, .data/, .cache/, test-results/, .env | OK | `.gitignore` lines `node_modules/ .next/ out/ .data/ .cache/ test-results/ .env` |
| API CORS | OK | `server.ts:51-53` `origin: [WEB_ORIGIN]` |
| Video route path check | OK | `server.ts` serves only files inside the job folder plus `CACHED_VIDEO_FILE` (NOTES E7-4 (5)) |
| Dependencies | **Open** | `npm install`: 15 vulnerabilities (5 moderate, 7 high, 3 critical); not analysed |

## (g) Docs and demo readiness

| Item | Status | Evidence |
|---|---|---|
| Root README commands | OK | every `npm run` in README, runbook, `apps/*/README.md`, `eval/README.md` exists |
| README ports | OK | Taskly 3100, API 4000, web 3000 match `samples/taskly/package.json`, `apps/api` default `PORT`, `apps/web/package.json` |
| README "which parts exist" | OK | start table updated in the merge |
| README eval example | **Wrong** | `README.md:101` uses `--source samples/taskly`, which fails (mismatch 1) |
| `docs/pitch.md` placeholders | 18 remain | `[TIME_TO_DEMO]` x3, `[MANUAL_BASELINE]` x5, `[PLAN_SUCCESS_RATE]` x3, `[REPAIR_RECOVERY_RATE]` x5, `[NAME]`, `[NAMES AND ROLES]`, `[TEAM NAME]`, `[CONTACT]`, `[CONFIRM]`, `[CONFIRM WITH TEAM]`, `[CONFIRM BEFORE CLAIMING MORE]`, `[SAY WHERE THIS NUMBER COMES FROM]`, `[STATE HOW YOU GOT IT]`, `[N RUNS, N PROJECTS]`, `[YOUR CLOSING LINE]`, `[ADD MODEL SPEED NUMBER IF MEASURED]`, `[REPLACE WITH REAL NAMES, WHO OWNED WHAT]` |
| Pitch live-demo step 7 (seeded rename) | **Cannot work as written** | mismatch 2 |
| `docs/runbook.md` | **Stale** | `:85` `<API START COMMAND>` placeholder (should be `npm run dev`); `:80` claims the cached plan is validated against the live page (false, mismatch 4); restart is not needed because the API re-reads `.env` per job (NOTES E7-7 (2)); `fallback: "cached-video"` through the API is not mentioned |
| `docs/fallback/cached-plan.json` | Exists (1,105 bytes) | `fallback.test.ts > the shipped docs/fallback/cached-plan.json is a valid plan` |
| `docs/fallback/cached-demo.mp4` | Exists (120,279 bytes) | from E8 copy |
| `eval/report.md` | **Missing** | `ls eval/report.md`: no such file |

## (h) WHAT IS LEFT

| # | Work | Files | Hours | Needs |
|---|---|---|---|---|
| 1 | Let the plan reach `/dashboard`: implement E3-5 (sign up with demo values when `allowAuthProbe`, then inventory the redirected pages), or as a stopgap make `validatePlan` skip the target check after a click when the inventory has redirected pages | `packages/inspector/src/inspect.ts`, `crawl.ts`; or `packages/planner/src/validate.ts`; `packages/shared/src/interfaces.ts` (`allowAuthProbe`) | 3-4 (stopgap 1) | Browser |
| 2 | Resolve a relative `source` against the repo root (or `INIT_CWD`) in the API | `apps/api/src/pipeline.ts` or `store.ts` | 0.5 | No |
| 3 | Strip `?variant=...` from `source` and add it to the first page the run opens | `apps/api/src/pipeline.ts`, maybe `packages/runner/src/runner.ts` | 1.5 | Browser |
| 4 | Full live run with Ollama on the demo laptop: `npm run eval:planner -w @demoforge/planner`, `npm run demo:repair`, one job through the web UI | none (testing) | 2 | Ollama, browser, person |
| 5 | Align error codes between launcher, planner and API | `apps/api/src/failure.ts`, `packages/planner/src/ollama.ts`, `plan-demo.ts` | 1 | No |
| 6 | Run the real eval (natural and `--variant renamed`) and write `eval/report.md` | `eval/` | 2 (mostly runtime) | Ollama, browser, person |
| 7 | Time one demo by hand and set `DEMOFORGE_MANUAL_BASELINE_SEC` | `eval/baseline.md`, `.env` | 2-3 | Person |
| 8 | Fill the 18 pitch placeholders and fix the runbook (`npm run dev`, cached-plan claim, no restart, `cached-video` switch) | `docs/pitch.md`, `docs/runbook.md`, `README.md:101` | 1 | Person |
| 9 | Add `npm run verify` (typecheck plus tests plus eval typecheck) and a CI workflow (E11-5) | root `package.json`, `.github/workflows/ci.yml` | 1.5 | No |
| 10 | API plus web end-to-end Playwright test with `USE_MOCKS=1` (E11-7) | `apps/web/tests/*.pw.ts`, `apps/web/playwright.config.ts` | 2-3 | Browser |
| 11 | Block off-origin navigation caused by clicks in the runner | `packages/runner/src/runner.ts` | 1 | Browser |
| 12 | Lazy-load Playwright in the inspector (E11-1) | `packages/inspector/src/crawl.ts` | 0.5 | No |
| 13 | Add an empty-instruction case to the planner eval | `packages/planner/src/eval.ts` | 0.25 | Ollama to run it |
| 14 | Agree contract additions (`allowAuthProbe`, `Job.errorCode`, `manualBaselineMeasured`), update `CONTRACTS.md` (`source` vs `projectSource`, health shape) | `packages/shared/src/*`, `CONTRACTS.md` | 1 | Person (owner decision) |
| 15 | Review the 15 npm audit findings | `package-lock.json` | 1 | No |

## (i) Top 5 risks for the demo (most likely to break first)

1. **Live planning on Taskly fails validation** (mismatch 3): the shipped plan itself is rejected against the real inventory; expect `PLAN_INVALID` on stage unless the cached plan is used.
2. **Seeded self-heal moment cannot be triggered** through the UI or eval (`?variant=renamed` gives `NOT_FOUND`), but pitch step 7 depends on it.
3. **A relative project path fails** (`samples/taskly` gives `NOT_FOUND`): a presenter typing a short path into the form gets an error.
4. **Ollama speed and availability are untested**: planning can take up to 4.5 minutes, repair up to 2 minutes per broken step, and no model run was verified.
5. **Fallback layer 2 instructions are wrong** (`<API START COMMAND>` placeholder, a false "validated against the live page" claim), so the switch may be slow or confusing under pressure.

Generated, git-ignored output left by the audit runs: `apps/api/.data/`, `samples/taskly/.next/`, `samples/taskly/test-results/`, `samples/taskly/tsconfig.tsbuildinfo`.
