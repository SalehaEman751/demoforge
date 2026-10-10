import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE, applyVariant, parseCli } from "./args.js";
import { httpExecutor, runBatch } from "./client.js";
import { dryExecutor } from "./dry.js";
import { formatMarkdown, mergeBatch, type Variant } from "./report.js";

let args;
try {
  args = parseCli(process.argv.slice(2));
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n\nUsage: ${USAGE}`);
  process.exit(2);
}

const variant: Variant = args.variant ?? "natural";
const source = applyVariant(args.source, args.variant);
const execute = args.dry ? dryExecutor(variant) : httpExecutor({ api: args.api, timeoutMs: args.timeoutSec * 1000 });
console.error(`Running ${args.runs} ${variant} job(s) one after another against ${args.dry ? "fixtures (dry)" : args.api}, source "${source}"`);

const records = await runBatch({
  runs: args.runs,
  request: { source, instructions: args.instructions },
  execute,
  onRecord: (r) => console.error(`run ${r.run}/${args.runs}: ${r.outcome}${r.errorCode ? ` [${r.errorCode}]` : ""}${r.error ? ` (${r.error})` : ""} in ${r.wallSec}s`),
});

// eval/report.json and eval/report.md sit next to src/. Each run of the CLI replaces its own variant's batch and keeps the other.
const evalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = path.join(evalDir, "report.json");
let previous: unknown;
if (existsSync(jsonPath)) {
  try {
    previous = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    previous = null; // unreadable: mergeBatch replaces it
  }
}
const batch = { variant, source, instructions: args.instructions, api: args.dry ? "fixtures (dry)" : args.api, runsRequested: args.runs, generatedAt: new Date().toISOString() };
const { report, note } = mergeBatch(previous, batch, records, args.dry);
if (note) console.error(note);

const markdown = formatMarkdown(report);
writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
writeFileSync(path.join(evalDir, "report.md"), markdown);
console.log(markdown);
console.error("Wrote eval/report.json and eval/report.md");
