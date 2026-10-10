# DemoForge contracts

Human-readable copy of `packages/shared/src/schemas.ts` and `packages/shared/src/interfaces.ts`.
If this file and the code disagree, the code wins; log the mismatch in `NOTES/contract-issues.md`.
Sample data for every type lives in `fixtures/`.

## Data types

All types are exported from `@demoforge/shared` as a Zod schema (`XxxSchema`) and an inferred TypeScript type (`Xxx`).

```ts
type Step = {
  id: number;                       // positive integer
  action: "navigate" | "click" | "fill" | "wait" | "assert_text" | "scroll";
  url?: string;
  target?: { role: string; name: string };
  value?: string;
  text?: string;
  ms?: number;                      // >= 0
  caption: string;
};

type Plan = {
  title: string;
  steps: Step[];                    // 1 to 25 items; step ids must be exactly 1..n in order
};

type LaunchInfo = {
  baseUrl: string;
  projectDir: string;
  framework: "next" | "vite" | "cra" | "unknown";
  packageManager: "npm" | "yarn" | "pnpm";
  startCommand: string;
  port: number;                     // positive integer
  envVarsRequired: string[];
};

type ProjectBrief = {
  name: string;
  framework: string;
  routes: string[];
  readmeSummary: string;
  startCommand: string;
  port: number;
};

type ElementInventory = {
  pages: {
    url: string;
    title: string;
    redirectedTo?: string;
    elements: { role: string; name: string; placeholder?: string }[];
  }[];
};

type StepResult = {
  stepId: number;
  status: "ok" | "repaired" | "failed" | "skipped";
  error?: string;
  durationMs: number;
  repairAttempts: number;
};

type RunResult = {
  videoPath: string;
  logPath: string;
  results: StepResult[];
  startedAt: number;                // epoch ms
  finishedAt: number;               // epoch ms
};

type Metrics = {
  timeToDemoSec: number;
  manualBaselineSec: number;
  stepsPlanned: number;
  stepsOk: number;
  stepsRepaired: number;
  stepsFailed: number;
  planSuccessRate: number;          // 0 to 1
  repairRecoveryRate: number;       // 0 to 1
};

type JobEvent = {
  type: "stage" | "step" | "log" | "done" | "error";
  stage?: string;
  stepId?: number;
  message?: string;
  data?: unknown;
};

type Job = {
  id: string;
  status: "queued" | "launching" | "inspecting" | "planning" | "running" | "done" | "failed";
  projectSource: string;
  instructions: string;
  info?: LaunchInfo;
  brief?: ProjectBrief;
  inventory?: ElementInventory;
  plan?: Plan;
  run?: RunResult;
  metrics?: Metrics;
  error?: string;
  createdAt: number;                // epoch ms
};
```

### Step rules

`StepSchema` rejects a step missing the field its action needs:

| action | required |
| --- | --- |
| `navigate` | `url` |
| `click` | `target` |
| `fill` | `target`, `value` |
| `assert_text` | `text` |
| `wait` | `ms` |
| `scroll` | none |

`PlanSchema` rejects a plan whose step ids are not exactly `1..n` in order.

## Function signatures

```ts
type LaunchProjectFn = (args: {
  source: string;
  startCommand?: string;
  port?: number;
  subdir?: string;
}) => Promise<{ info: LaunchInfo; stop: () => Promise<void> }>;

type InspectProjectFn = (args: {
  info: LaunchInfo;
  allowAuthProbe?: boolean;         // opt-in: sign up with demo values to inventory pages behind a login redirect
}) => Promise<{ brief: ProjectBrief; inventory: ElementInventory }>;

type PlanDemoFn = (args: {
  brief: ProjectBrief;
  inventory: ElementInventory;
  instructions: string;
}) => Promise<Plan>;

type ValidatePlanFn = (
  plan: Plan,
  inventory: ElementInventory,
  baseUrl: string,
) => { ok: boolean; errors: string[] };

// Returns a corrected step, or null when no repair is possible.
type RepairStepFn = (args: {
  step: Step;
  error: string;
  inventory: ElementInventory;
  baseUrl: string;
}) => Promise<Step | null>;

type RepairFn = RepairStepFn;

type RunPlanFn = (args: {
  baseUrl: string;
  plan: Plan;
  outDir: string;
  repair?: RepairFn;
  onEvent?: (event: JobEvent) => void;
}) => Promise<RunResult>;

type ComputeMetricsFn = (args: {
  run: RunResult;
  startedAt: number;
  finishedAt: number;
}) => Metrics;
```

## Mocks

Every module ships `src/mock.ts` exporting the same function names and signatures as the real module,
returning data from `fixtures/` (no network, no browser). `src/index.ts` re-exports it.

| Package | Exports |
| --- | --- |
| `packages/launcher` | `launchProject` |
| `packages/inspector` | `inspectProject` |
| `packages/planner` | `planDemo`, `validatePlan` |
| `packages/repair` | `repairStep` |
| `packages/runner` | `runPlan` |
| `packages/metrics` | `computeMetrics` |
| `apps/api` | `runJob({ projectSource, instructions }) => Promise<Job>` (type `RunJobFn`, defined in the api package) |

`@demoforge/shared` also exports `loadFixture(name, schema)`, which reads `fixtures/<name>` from the repo root and validates it.
Each package has `src/demo.ts`, run with `npm run demo:<name> -w @demoforge/<name>` (uses `tsx`), which prints the mock result as JSON.

## Fixtures

| File | Schema |
| --- | --- |
| `fixtures/launch-info.json` | `LaunchInfo` |
| `fixtures/brief.json` | `ProjectBrief` |
| `fixtures/element-inventory.json` | `ElementInventory` |
| `fixtures/plan.json` | `Plan` |
| `fixtures/run-result.json` | `RunResult` |
| `fixtures/metrics.json` | `Metrics` |
| `fixtures/job.json` | `Job` (embeds all of the above) |
