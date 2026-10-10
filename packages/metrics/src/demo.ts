import { RunResultSchema, loadFixture } from "@demoforge/shared";
import { computeMetrics } from "./index.js";

const run = loadFixture("run-result.json", RunResultSchema);
const metrics = computeMetrics({ run, startedAt: run.startedAt, finishedAt: run.finishedAt });
console.log(JSON.stringify(metrics, null, 2));
