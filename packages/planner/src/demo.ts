import { ElementInventorySchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";
import { OllamaError, PlanError, health, planDemo, planDemoMock, validatePlan } from "./index.js";

// Usage: npm run demo:planner -- "<instructions>" [--mock]
// Plans against fixtures/brief.json and fixtures/element-inventory.json, then validates the plan.
// Without --mock it uses the local Ollama model; with --mock it returns fixtures/plan.json after 1 second.
const DEFAULT_INSTRUCTIONS = "Show a new user signing up and adding their first task.";
const args = process.argv.slice(2);
const mock = args.includes("--mock");
const instructions = args.filter((a) => a !== "--mock").join(" ").trim() || DEFAULT_INSTRUCTIONS;

const brief = loadFixture("brief.json", ProjectBriefSchema);
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);
const baseUrl = `http://localhost:${brief.port}`;

console.log(`mode: ${mock ? "mock (fixtures/plan.json, no Ollama)" : "Ollama"}`);
console.log(`instructions: ${instructions}`);

if (!mock) {
  const h = await health();
  if (!h.ok) {
    console.log(h.error);
    process.exit(1);
  }
}

try {
  const plan = mock
    ? await planDemoMock({ brief, inventory, instructions })
    : await planDemo({
        brief,
        inventory,
        instructions,
        onLog: (e) => console.log(`[${e.stage}] ${e.response.length} chars back${e.problems.length ? `, problems: ${e.problems.join("; ")}` : ""}`),
      });
  console.log(JSON.stringify(plan, null, 2));
  console.log("validatePlan:", JSON.stringify(validatePlan(plan, inventory, baseUrl)));
} catch (e) {
  if (e instanceof PlanError) {
    console.log(`Planning failed: ${e.message}`);
    console.log(`Last model reply (${e.log.length} model calls):\n${e.log.at(-1)?.response ?? "(none)"}`);
    process.exit(1);
  }
  if (e instanceof OllamaError) {
    console.log(e.message);
    process.exit(1);
  }
  throw e;
}
