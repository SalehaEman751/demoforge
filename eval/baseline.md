# Manual baseline: timing one demo by hand

DemoForge reports "time to demo" next to `DEMOFORGE_MANUAL_BASELINE_SEC`. The default, 9000 s (2.5 hours), is an **assumption**. This page is how to replace it with a number you measured.

## What to time

Make the same demo DemoForge makes, by hand: **a new user signs up on Taskly and adds a task**, as a captioned video (about 1280x720, like the DemoForge output). Time everything from "nothing recorded yet" to "finished file with captions":

1. **Record**: open the app, rehearse if you need to, record the full walkthrough.
2. **Retake**: every re-recording after a slip (a wrong click, a typo, a pause). Log each retake as its own row.
3. **Trim**: cut dead time at the start and end, remove mistakes.
4. **Captions**: write and place a caption for each step (the plan has 8 steps), then check timing.
5. **Export**: render and open the final file to check it plays.

Start the timer when you open your recording tool; stop it when the final file plays correctly. Do not count time spent before that (installing tools, starting Taskly) or breaks. Do count time spent fixing the video.

## Rules, so the number is fair

- Use the tools you would normally use (screen recorder, editor, caption tool). Write them down.
- Do it at normal speed, not rushed and not slowed down. Do not look at the DemoForge output while you work.
- Time it **three times** on different days if you can, and use the **median** total. One run is one person's good or bad day.
- Use a stopwatch or the clock times below. Do not estimate afterwards.

## Fill in

Use 24-hour times (`14:05`). Minutes = end minus start. Add a row for every retake.

| Task | Start | End | Minutes | Tools used |
|------|-------|-----|---------|------------|
| Record walkthrough | | | | |
| Retake 1 | | | | |
| Retake 2 | | | | |
| Trim | | | | |
| Captions (all 8 steps) | | | | |
| Export and check | | | | |
| Other (say what) | | | | |
| **Total minutes** | | | **= sum of Minutes** | |
| **Total seconds** | | | **= Total minutes x 60** | |

Total seconds for this attempt: `______`

If you did three attempts, write each total here and take the middle one:

| Attempt | Date | Total seconds |
|---------|------|---------------|
| 1 | | |
| 2 | | |
| 3 | | |
| **Median (use this)** | | |

## Use the number

Paste the median total seconds into `DEMOFORGE_MANUAL_BASELINE_SEC` (whole seconds, a plain number, for example `5400`). It is read each time metrics are computed, so set it in the shell that runs the API:

```
export DEMOFORGE_MANUAL_BASELINE_SEC=5400
```

`.env.example` lists the variable with the 9000 default. A blank, non-numeric or negative value falls back to 9000, so check that a metrics result shows your number in `manualBaselineSec`. Then rerun `npm run eval` so `eval/report.md` quotes it; the headline sentence calls the baseline "assumed", so edit that wording by hand once the number is measured.

Also fill in who measured it and when:

- Measured by (role, experience with the tools): 
- Date: 
- Taskly version / plan used: 
