# Taskly (sample project)

Small Next.js (App Router, TypeScript) + Tailwind task app that DemoForge records demos against.
No database, env vars or external requests; data lives in `localStorage` (`taskly:user`, `taskly:tasks`).

## Run

```
npm run dev -w @demoforge/sample-taskly     # or `npm run dev` inside samples/taskly
```

Serves on **http://localhost:3100**.

## Expected demo flow

1. Open `/`. Headline "Simple tasks for busy people"; click the **Get started** link.
2. On `/signup`, type an email into **Email** (e.g. `demo@taskly.dev`).
3. Type a password of 6+ characters into **Password** (e.g. `demo-password-123`).
4. Click the **Create account** button. Invalid email or short password shows an inline `role="alert"` error instead.
5. You land on `/dashboard`: heading **Welcome, demo@taskly.dev**, section heading **Your tasks**, and the empty state **No tasks yet**.
6. Type a task into **New task** (placeholder "What needs doing?"), e.g. `Record the demo video`.
7. Click **Add task**. The task appears with a checkbox named after its text and a **Delete** button.
8. Optional: tick the checkbox, click **Delete** (accessible name `Delete <task text>`), or click **Log out** to return to `/signup`.

Visiting `/dashboard` while signed out redirects to `/signup`.

## Seeded failure: `?variant=renamed` (self-heal demo only)

Adding `?variant=renamed` to any URL (e.g. `/signup?variant=renamed`) relabels the dashboard button
**Add task** to **Add item**. The flag is read on any page and kept in `sessionStorage`
(`taskly:variant`), so it survives the `/signup` -> `/dashboard` redirect; it lasts for the browser tab session.
Any other `?variant=` value (e.g. `?variant=default`) clears it. Only the dashboard button changes; its
role, position and behaviour are identical.

**This exists only to trigger and demonstrate self-healing on demand. It is a deliberately seeded
failure and is labelled as such in the pitch; it is not a real product change.**

## Tests (Playwright, Chromium)

First time on a new machine: `npx playwright install chromium`.
Both commands start the app on 3100 automatically (or reuse one already running).

| Command | What it does |
| --- | --- |
| `npm run demo:taskly -w @demoforge/sample-taskly` | Smoke test: sign up and add one task; plus the `?variant=renamed` check |
| `npm run test:a11y -w @demoforge/sample-taskly` | Fails if a link, button or input has no accessible name, or two elements share a role+name, on `/`, `/signup` (also with an error showing) and `/dashboard` (empty and with tasks) |

The a11y test reads Chromium's accessibility tree, so it only runs on Chromium.

## Notes for the demo tool

- Every input has a `<label>`; role+name pairs are unique per page.
- Each task's Delete button has accessible name `Delete <task text>` (visible text "Delete") so names stay unique.
- Duplicate task text (case-insensitive) is rejected, so checkbox names stay unique.
- Password is `type="password"` (role-less in Playwright): find it with `getByLabel("Password")`.
- Next.js adds an empty `role="alert"` route announcer to every page; filter alert lookups by text.
