import { ElementInventorySchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";
import { VARIANTS, formatResultLine, formatSummary, runEval } from "./eval.js";
import { health, planDemo, warmUp } from "./index.js";

// Usage: npm run eval:planner. Needs `ollama serve` and the model pulled.
const brief = loadFixture("brief.json", ProjectBriefSchema);
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);

const h = await health();
if (!h.ok) {
  console.log(h.error);
  process.exit(1);
}

// Load the model first so the first variant's latency is not inflated by a cold start.
console.log(`Warm-up (model load): ${((await warmUp()) / 1000).toFixed(1)}s`);
console.log(`Running ${VARIANTS.length} instruction variants against fixtures/brief.json + element-inventory.json\n`);

const results = await runEval(VARIANTS, (instructions, onLog) => planDemo({ brief, inventory, instructions, onLog }), {
  onResult: (r) => console.log(formatResultLine(r)),
});
console.log("\n" + formatSummary(results));
