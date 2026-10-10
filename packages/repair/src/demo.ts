import { ElementInventorySchema, loadFixture, type Step } from "@demoforge/shared";
import { getRepairStats, repairStep, resetRepairStats } from "./index.js";

type Case = { label: string; step: Step; expect: { role: string; name: string } | null };
const click = (id: number, role: string, name: string): Step => ({ id, action: "click", target: { role, name }, caption: `Click ${name}` });
const fill = (id: number, role: string, name: string): Step => ({ id, action: "fill", target: { role, name }, value: "x", caption: `Fill ${name}` });

const cases: Case[] = [
  { label: "typo", step: fill(1, "textbox", "Emial"), expect: { role: "textbox", name: "Email" } },
  { label: "typo", step: click(2, "button", "Creat account"), expect: { role: "button", name: "Create account" } },
  { label: "wrong role", step: click(3, "link", "Create account"), expect: { role: "button", name: "Create account" } },
  { label: "wrong role", step: click(4, "button", "Sign up"), expect: { role: "link", name: "Sign up" } },
  { label: "rename (Add item)", step: click(5, "button", "Add item"), expect: { role: "button", name: "Add task" } },
  { label: "rename (New item)", step: fill(6, "textbox", "New item"), expect: { role: "textbox", name: "New task" } },
  { label: "wrong name", step: click(7, "button", "Register"), expect: { role: "button", name: "Create account" } },
  { label: "missing element", step: click(8, "button", "Export CSV"), expect: null },
];

const inventory = loadFixture("element-inventory.json", ElementInventorySchema);
const fmt = (t?: { role: string; name: string } | null): string => (t ? `${t.role} "${t.name}"` : "-");

resetRepairStats();
const rows: string[][] = [["#", "case", "broken target", "repaired to", "stage", "result"]];
const notFixed: string[] = [];
let fixedCount = 0;

for (const c of cases) {
  const before = getRepairStats();
  const out = await repairStep({ step: c.step, error: `Timeout waiting for ${fmt(c.step.target)}`, inventory, baseUrl: "http://localhost:3100" });
  const after = getRepairStats();
  const stage = after.stage1Fixes > before.stage1Fixes ? "1" : after.stage2Fixes > before.stage2Fixes ? "2" : "gave up";
  const right = out?.target?.role === c.expect?.role && out?.target?.name === c.expect?.name;
  if (out && right) fixedCount++;
  else if (c.expect) notFixed.push(`#${c.step.id} ${c.label}`);
  const result = right ? (c.expect ? "PASS" : "PASS (no fix possible)") : out ? "FAIL (wrong fix)" : "FAIL";
  rows.push([String(c.step.id), c.label, fmt(c.step.target), fmt(out?.target), stage, result]);
}

const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
rows.forEach((r, i) => {
  console.log(r.map((cell, j) => cell.padEnd(widths[j]!)).join("  "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("  "));
});

const stats = getRepairStats();
console.log(`\nFixed ${fixedCount} of ${cases.length} (stage 1: ${stats.stage1Fixes}, stage 2: ${stats.stage2Fixes}, gave up: ${stats.gaveUp}).`);
if (notFixed.length) console.log(`Not fixed: ${notFixed.join(", ")}.`);
if (stats.stage2Fixes === 0) console.log("Stage 2 asks the local Ollama model; none of the steps reached a fix there (is `ollama serve` running?).");
process.exitCode = fixedCount >= 6 ? 0 : 1;
