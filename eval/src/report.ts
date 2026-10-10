import { MetricsSchema } from "@demoforge/shared";
import { z } from "zod";
import type { RunRecord } from "./types.js";

/** "natural" = an ordinary run. "renamed" = the seeded failure (Taskly's button is renamed), the only runs that measure self-healing. */
export type Variant = "natural" | "renamed";
export const VARIANTS: Variant[] = ["natural", "renamed"];
const TITLES: Record<Variant, string> = { natural: "Natural runs (no seeded failure)", renamed: "Seeded-failure runs (variant renamed)" };

const ReportRunSchema = z.object({
  run: z.number().int().positive(),
  variant: z.enum(["natural", "renamed"]),
  status: z.enum(["done", "failed", "error"]),
  timeToDemoSec: z.number().nullable(),
  metrics: MetricsSchema.nullable(),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  wallSec: z.number(),
  stepsNeedingRepair: z.number().nullable(),
});
export type ReportRun = z.infer<typeof ReportRunSchema>;

const BatchSchema = z.object({
  variant: z.enum(["natural", "renamed"]),
  source: z.string(),
  instructions: z.string(),
  api: z.string(),
  runsRequested: z.number().int().positive(),
  generatedAt: z.string(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const ReportSchema = z.object({
  generatedAt: z.string(),
  /** True when the numbers come from --dry fixtures. A report never mixes dry and real batches. */
  dry: z.boolean(),
  batches: z.object({ natural: BatchSchema.optional(), renamed: BatchSchema.optional() }),
  runs: z.array(ReportRunSchema),
});
export type Report = z.infer<typeof ReportSchema>;

export function toReportRun(r: RunRecord, variant: Variant): ReportRun {
  return {
    run: r.run,
    variant,
    status: r.outcome,
    timeToDemoSec: r.metrics?.timeToDemoSec ?? null,
    metrics: r.metrics ?? null,
    errorCode: r.outcome === "done" ? null : (r.errorCode ?? "eval_error"),
    error: r.error ?? null,
    jobId: r.jobId ?? null,
    wallSec: r.wallSec,
    stepsNeedingRepair: r.stepsNeedingRepair ?? null,
  };
}

/**
 * Adds a batch to the report. The previous batch of the same variant is replaced; the other variant is kept.
 * A report that is invalid, or whose dry flag differs from the new batch, is dropped so fake and real numbers never meet.
 */
export function mergeBatch(previous: unknown, batch: Batch, records: RunRecord[], dry: boolean, now = new Date()): { report: Report; note?: string } {
  const parsed = ReportSchema.safeParse(previous);
  let note: string | undefined;
  let base: Report | undefined = parsed.success ? parsed.data : undefined;
  if (previous !== undefined && !parsed.success) note = "The existing report.json was not valid and was replaced.";
  if (base && base.dry !== dry) {
    note = `The existing report.json held ${base.dry ? "dry (fake)" : "real"} results and this batch is ${dry ? "dry (fake)" : "real"}, so it was replaced.`;
    base = undefined;
  }
  const kept = (base?.runs ?? []).filter((r) => r.variant !== batch.variant);
  const report: Report = {
    generatedAt: now.toISOString(),
    dry,
    batches: { ...(base?.batches ?? {}), [batch.variant]: batch },
    runs: [...kept, ...records.map((r) => toReportRun(r, batch.variant))].sort(
      (a, b) => VARIANTS.indexOf(a.variant) - VARIANTS.indexOf(b.variant) || a.run - b.run,
    ),
  };
  return { report, ...(note ? { note } : {}) };
}

/* ---------- statistics (one group = one variant) ---------- */

export type GroupStats = {
  runs: number;
  completed: number;
  completionRate: number | null;
  meanTimeToDemoSec: number | null;
  medianTimeToDemoSec: number | null;
  meanPlanSuccessRate: number | null;
  /** Mean of the per-run recovery rate, over the runs where something needed repair only. */
  meanRepairRecoveryRate: number | null;
  runsNeedingRepair: number;
  stepsRepaired: number;
  stepsNeedingRepair: number;
  failuresByCode: Record<string, number>;
  manualBaselineSec: number | null;
};

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;
const mean = (xs: number[]): number | null => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2, 1);
}

export function groupStats(all: ReportRun[], variant: Variant): GroupStats {
  const runs = all.filter((r) => r.variant === variant);
  const completed = runs.filter((r) => r.status === "done");
  const withMetrics = completed.filter((r) => r.metrics);
  const needingRepair = withMetrics.filter((r) => (r.stepsNeedingRepair ?? 0) > 0 || r.metrics!.stepsRepaired > 0);
  const failuresByCode: Record<string, number> = {};
  for (const r of runs) if (r.status !== "done") failuresByCode[r.errorCode ?? "eval_error"] = (failuresByCode[r.errorCode ?? "eval_error"] ?? 0) + 1;
  const times = withMetrics.map((r) => r.metrics!.timeToDemoSec);
  return {
    runs: runs.length,
    completed: completed.length,
    completionRate: runs.length ? round(completed.length / runs.length) : null,
    meanTimeToDemoSec: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length, 1) : null,
    medianTimeToDemoSec: median(times),
    meanPlanSuccessRate: mean(withMetrics.map((r) => r.metrics!.planSuccessRate)),
    meanRepairRecoveryRate: mean(needingRepair.map((r) => r.metrics!.repairRecoveryRate)),
    runsNeedingRepair: needingRepair.length,
    stepsRepaired: withMetrics.reduce((n, r) => n + r.metrics!.stepsRepaired, 0),
    stepsNeedingRepair: needingRepair.reduce((n, r) => n + (r.stepsNeedingRepair ?? r.metrics!.stepsRepaired), 0),
    failuresByCode,
    manualBaselineSec: withMetrics[0]?.metrics!.manualBaselineSec ?? null,
  };
}

/* ---------- markdown ---------- */

const pct = (x: number | null): string => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const num = (x: number | null, unit = ""): string => (x === null ? "n/a" : `${x}${unit}`);
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");

/** 24 -> "24 seconds", 204 -> "3.4 minutes", 9000 -> "2.5 hours". */
export function humanDuration(sec: number): string {
  const trim = (n: number) => String(round(n, 1));
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${trim(sec / 60)} minutes`;
  return `${trim(sec / 3600)} hours`;
}

function groupSection(report: Report, variant: Variant): string[] {
  const out: string[] = [`## ${TITLES[variant]}`, ""];
  const batch = report.batches[variant];
  const runs = report.runs.filter((r) => r.variant === variant);
  if (!batch || runs.length === 0) {
    out.push(variant === "natural" ? "No natural runs yet: run `npm run eval -- --runs 10 --source ... --instructions ...`." : "No seeded-failure runs yet: add `--variant renamed`.", "");
    return out;
  }
  const g = groupStats(report.runs, variant);
  out.push(`Source \`${batch.source}\` on ${batch.api}; ${batch.generatedAt}. Instructions: ${batch.instructions}`, "");
  out.push("| Metric | Value |", "|---|---|");
  out.push(`| Runs | ${g.runs} |`);
  out.push(`| Completion rate | ${pct(g.completionRate)} (${g.completed} of ${g.runs}) |`);
  out.push(`| Mean time to demo | ${num(g.meanTimeToDemoSec, " s")} |`);
  out.push(`| Median time to demo | ${num(g.medianTimeToDemoSec, " s")} |`);
  out.push(`| Mean plan success rate | ${pct(g.meanPlanSuccessRate)} |`);
  out.push(`| Mean repair recovery rate | ${pct(g.meanRepairRecoveryRate)}${g.runsNeedingRepair ? ` (${g.runsNeedingRepair} run(s) needed repair)` : " (no run needed repair)"} |`, "");

  out.push("Failures by error code", "", "| Error code | Runs |", "|---|---|");
  const codes = Object.entries(g.failuresByCode).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (codes.length === 0) out.push("| none | 0 |");
  for (const [code, n] of codes) out.push(`| ${code} | ${n} |`);
  out.push("");

  if (variant === "renamed" && g.completed > 0 && g.stepsRepaired === 0) {
    out.push("WARNING: no step was repaired in any run, so the rename probably never reached the app (see eval/README.md, \"How --variant works\").", "");
  }

  out.push("| # | job | status | wall s | demo s | ok | repaired | failed | planned | success | recovery | error code | error |");
  out.push("|---|-----|--------|--------|--------|----|----------|--------|---------|---------|----------|------------|-------|");
  for (const r of runs) {
    const m = r.metrics;
    out.push(
      `| ${[r.run, r.jobId ?? "-", r.status, r.wallSec, r.timeToDemoSec ?? "-", m?.stepsOk ?? "-", m?.stepsRepaired ?? "-", m?.stepsFailed ?? "-", m?.stepsPlanned ?? "-", m?.planSuccessRate ?? "-", m?.repairRecoveryRate ?? "-", r.errorCode ?? "-", cell(r.error ?? "")].join(" | ")} |`,
    );
  }
  out.push("");
  return out;
}

/** Three ready-to-paste sentences. Natural runs and seeded-failure runs feed different sentences. */
export function headlineSentences(report: Report): string[] {
  const nat = groupStats(report.runs, "natural");
  const ren = groupStats(report.runs, "renamed");
  const tag = report.dry ? "[DRY RUN, FAKE DATA] " : "";

  let s1: string;
  if (nat.runs === 0) s1 = "No natural runs recorded yet, so there is no completion or time number.";
  else if (nat.medianTimeToDemoSec === null) s1 = `DemoForge completed ${nat.completed} of ${nat.runs} demos.`;
  else {
    const manual = nat.manualBaselineSec === null ? "" : ` versus about ${humanDuration(nat.manualBaselineSec)} manually (an assumed baseline)`;
    s1 = `DemoForge completed ${nat.completed} of ${nat.runs} demos in a median of ${humanDuration(nat.medianTimeToDemoSec)}${manual}.`;
  }

  let s2: string;
  if (ren.runs === 0) s2 = "No seeded-failure runs recorded yet, so the self-heal number is not measured.";
  else if (ren.stepsNeedingRepair === 0) {
    s2 = `With a renamed button, no step needed repair in ${ren.runs} runs, so the self-heal rate could not be measured (check that the variant reached the app).`;
  } else {
    s2 = `With a renamed button (a seeded failure), DemoForge repaired ${ren.stepsRepaired} of ${ren.stepsNeedingRepair} broken steps (${pct(ren.stepsNeedingRepair ? ren.stepsRepaired / ren.stepsNeedingRepair : null)}) and completed ${ren.completed} of ${ren.runs} demos.`;
  }

  let s3: string;
  if (nat.runs === 0) s3 = "No natural runs recorded yet, so there is no plan success number.";
  else {
    const failed = nat.runs - nat.completed;
    const top = Object.entries(nat.failuresByCode).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const tail = failed === 0 ? "no run failed" : `${failed} run${failed === 1 ? "" : "s"} failed, most often with ${top![0]}`;
    s3 = `Across ${nat.runs} natural runs, ${pct(nat.meanPlanSuccessRate)} of planned steps succeeded on average, and ${tail}.`;
  }
  return [s1, s2, s3].map((s) => tag + s);
}

export function formatMarkdown(report: Report): string {
  const out: string[] = ["# DemoForge eval report", "", `Generated ${report.generatedAt}.`];
  if (report.dry) out.push("", "> DRY RUN: these numbers come from fixtures (`--dry`), not from the API. Do not quote them.");
  out.push("", "Natural runs and seeded-failure runs are reported separately; the self-heal numbers only come from the seeded-failure table.", "");
  for (const v of VARIANTS) out.push(...groupSection(report, v));
  out.push("## Headline numbers", "");
  headlineSentences(report).forEach((s, i) => out.push(`${i + 1}. ${s}`));
  out.push("");
  return out.join("\n");
}
