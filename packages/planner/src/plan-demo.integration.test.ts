import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ElementInventorySchema, PlanSchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";
import { PLAN_JSON_SCHEMA, planDemo, type PlanLogEntry } from "./index.js";

// planDemo through the real Ollama client, against a fake Ollama server (no mocks inside the package).
let server: Server;
const bodies: any[] = [];
const good = loadFixture("plan.json", PlanSchema);

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: { role: "assistant", content: JSON.stringify(good) } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.DEMOFORGE_OLLAMA_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  delete process.env.DEMOFORGE_OLLAMA_URL;
});

it("plans end to end: prompt out, schema-constrained request, validated plan back, raw text logged", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const entries: PlanLogEntry[] = [];
  const plan = await planDemo({
    brief: loadFixture("brief.json", ProjectBriefSchema),
    inventory: loadFixture("element-inventory.json", ElementInventorySchema),
    instructions: "Show a new user signing up and adding their first task.",
    onLog: (e) => entries.push(e),
  });
  expect(plan).toEqual(good);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ stream: false, format: PLAN_JSON_SCHEMA, options: { temperature: 0.2, num_ctx: 8192 }, keep_alive: "10m" });
  expect(bodies[0].messages[0].role).toBe("system");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.response).toBe(JSON.stringify(good)); // exactly what the server sent
  expect(entries[0]!.prompt).toEqual(bodies[0].messages); // exactly what was sent
});
