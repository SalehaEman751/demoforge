# DemoForge pitch (5 minutes)

Fill every `[PLACEHOLDER]` before demo day. The three numbers come from `eval/report.md` (does not exist yet: run the evaluation, then copy them in).

| Placeholder | Meaning | Source |
| --- | --- | --- |
| `[TIME_TO_DEMO]` | seconds from submit to finished video, vs `[MANUAL_BASELINE]` by hand | eval/report.md |
| `[PLAN_SUCCESS_RATE]` | share of planned steps that worked | eval/report.md |
| `[REPAIR_RECOVERY_RATE]` | share of broken steps the repair stage fixed (natural failures, not the seeded one) | eval/report.md |

Presenter: `[NAME]`. Team: `[NAMES AND ROLES]`.

## Script with speaker notes

### 0:00 The problem (40 s)
- Every product team needs demo videos: for launches, docs, investors, new hires.
- Recording one by hand means starting the app, rehearsing the clicks, fixing mistakes, re-recording. Our baseline: `[MANUAL_BASELINE]` for one demo. `[SAY WHERE THIS NUMBER COMES FROM]`
- It goes stale the moment the UI changes, so most teams just don't do it.

### 0:40 The solution (30 s)
- DemoForge: give it a project and one plain-English sentence. It starts the app, looks at what is really on the screen, plans the demo, drives a real browser, and hands back an MP4 with captions.
- Everything runs on this laptop with a local model. No cloud, no upload.
- Point at the diagram slide: launch, inspect, plan, run, repair, metrics.

### 1:10 Live demo (140 s)
1. Show the sample project (taskly) running. Say it has never been seen by the model. `[CONFIRM]`
2. Type the instruction: "Show a new user signing up and adding their first task."
3. Narrate the stages as they appear in the UI: launching, inspecting, planning, running.
4. Show the plan: steps are real buttons and fields from the page, not guesses.
5. While the browser runs: "Every action is captioned for the viewer."
6. Show the finished video playing.
7. Show the self-heal moment: rerun with the seeded rename (`?variant=renamed`, button "Add task" becomes "Add item"), the step fails, repair finds the new name, the demo finishes. Say it is a seeded rename (see question 2).
- If anything breaks: do not debug on stage, switch fallback (docs/runbook.md) and keep talking.

### 3:30 Impact numbers (50 s)
- Time to demo: `[TIME_TO_DEMO]` against `[MANUAL_BASELINE]` by hand.
- Plan success rate: `[PLAN_SUCCESS_RATE]` of steps worked first time.
- Repair recovery rate: `[REPAIR_RECOVERY_RATE]` of naturally broken steps fixed automatically.
- Say how many runs and projects the numbers come from: `[N RUNS, N PROJECTS]`.

### 4:20 Why it is real AI (30 s)
- The model decides which steps tell the story, which control matches each step, what to write in each caption, and how to fix a step that broke.
- Code decides everything safe: validation, the allowed site, timeouts, recording.
- The plan is checked against the live page before anything runs, so a bad answer is caught, not executed.

### 4:50 Close (10 s)
- "A demo video that stays current because it's regenerated, not re-recorded. Local, free, and repeatable." `[YOUR CLOSING LINE]`

## Slide outline (8 slides)

1. Title: DemoForge, one-line promise, `[TEAM NAME]`
2. The problem: hand-made demos cost `[MANUAL_BASELINE]` and go stale
3. The solution: input sentence in, MP4 out (one screenshot of the result)
4. How it works: the architecture diagram from README.md
5. Live demo (blank or a "switching to demo" slide)
6. Impact: three big numbers, `[TIME_TO_DEMO]`, `[PLAN_SUCCESS_RATE]`, `[REPAIR_RECOVERY_RATE]`
7. Why it is real AI, and where code takes over (small two-column table)
8. Limits and next steps, then thank you / contact `[CONTACT]`

## Prepared answers to likely judge questions

**1. Why local instead of an API?**
Privacy and cost. The project being demoed is often unreleased code, and we don't want it leaving the laptop. A local model also has no per-run cost, works with Wi-Fi off (important on conference networks), and gives repeatable setups. The price is a smaller model, which is why we validate plans against the live page and repair broken steps. `[ADD MODEL SPEED NUMBER IF MEASURED]`

**2. What happens when a step fails?**
The runner catches the failure, looks at what is actually on the page, and asks for a corrected step: first simple matching, then the model. The fixed step is re-run, and the run log records every step as ok, repaired, failed or skipped. To be plain about the live demo: the repair you watch on stage uses a seeded rename (the sample app relabels "Add task" to "Add item" on purpose) so it is reproducible. It is not a natural failure. Natural repair rates are reported separately in eval/report.md (`[REPAIR_RECOVERY_RATE]`), and they are lower than the staged one would suggest.

**3. What stops the AI visiting other sites?**
Two code checks, not the model's good behaviour. The planner's validation rejects any navigate step whose address is on another origin, and the runner refuses to navigate to a different origin than the app under test even if a plan got past validation. Limit to be honest about: that is navigation. A link inside the app that points elsewhere is not blocked by this check. `[CONFIRM BEFORE CLAIMING MORE]`

**4. How is this different from a screen recorder?**
A recorder captures what a person does once. DemoForge captures what the project does, from a sentence, with nobody clicking. When the UI changes, you rerun it instead of re-recording. It also adds captions and a log of what happened, and it can repair its own steps.

**5. What does the AI actually decide?**
The story (which steps, in what order), which on-screen control each step targets, the caption text, and the fix when a step breaks. Not decided by AI: what URL is allowed, whether a plan is valid, timeouts, how recording works, and the metrics.

**6. How do you handle login?**
Only simple flows: the plan can fill a signup or login form with values from the instructions, like any other step (taskly: sign up with a demo email and password). There is no stored credential vault, no SSO, no 2FA, no captcha. Projects that need a real backend or secrets are reported as failing to start rather than worked around.

**7. What are the limits?**
Local only. Standard npm web apps. Needs the app to run without a database or external services. Running a repo executes its code, so only use trusted projects. A 7B local model makes mistakes, plans are capped at 25 steps, and natural repair is far from perfect (`[REPAIR_RECOVERY_RATE]`). Tested on `[N]` projects, not thousands.

**8. What is the impact model?**
Time saved per demo = manual baseline minus time to demo, times how often a demo needs refreshing. The manual baseline is `[MANUAL_BASELINE]`, an estimate, `[STATE HOW YOU GOT IT]`, not a measured study. DemoForge's own time is measured per run. The plan success and repair recovery rates say how often a human still has to step in.

**9. What would you build next?**
`[CONFIRM WITH TEAM]` Ideas in order: voice-over from the captions, support for projects with a backend (docker compose), login with stored test accounts, scheduled regeneration on every release, a bigger evaluation set.

**10. How did you split the work?**
Epics with strict ownership and shared contracts: each person owned one package (launcher, inspector, planner, runner, repair, metrics, API/web, scripts and docs) and shipped a mock returning fixture data, so everyone could build in parallel and integrate late. `[REPLACE WITH REAL NAMES, WHO OWNED WHAT]`
