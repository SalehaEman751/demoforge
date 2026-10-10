import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan } from "@demoforge/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobEvents } from "./events.js";
import { findRepoRoot, Pipeline, planWithQuery, splitSourceQuery, withQuery } from "./pipeline.js";
import { createRegistry, type Registry } from "./registry.js";
import { JobStore } from "./store.js";

describe("splitSourceQuery (A2)", () => {
  it("splits a local path on the first ?", () => {
    expect(splitSourceQuery("samples/taskly?variant=renamed")).toEqual({ path: "samples/taskly", query: "?variant=renamed" });
    expect(splitSourceQuery("./app?a=1?b=2")).toEqual({ path: "./app", query: "?a=1?b=2" });
    expect(splitSourceQuery("/abs/app?variant=renamed")).toEqual({ path: "/abs/app", query: "?variant=renamed" });
  });

  it("leaves a source without a query alone, and drops an empty one", () => {
    expect(splitSourceQuery("samples/taskly")).toEqual({ path: "samples/taskly", query: "" });
    expect(splitSourceQuery("samples/taskly?")).toEqual({ path: "samples/taskly", query: "" });
  });

  it("never splits a git or https URL, even with a ?", () => {
    for (const url of ["https://github.com/acme/app.git?ref=main", "git@github.com:acme/app.git?x=1", "ssh://git@host/a?b"]) {
      expect(splitSourceQuery(url)).toEqual({ path: url, query: "" });
    }
  });
});

describe("withQuery / planWithQuery (A2)", () => {
  it("adds the query to relative and absolute URLs, keeping an existing query and hash", () => {
    expect(withQuery("/signup", "?variant=renamed")).toBe("/signup?variant=renamed");
    expect(withQuery("/signup?next=%2F", "?variant=renamed")).toBe("/signup?next=%2F&variant=renamed");
    expect(withQuery("/a#top", "?v=1")).toBe("/a?v=1#top");
    expect(withQuery("http://localhost:3000/", "?v=1")).toBe("http://localhost:3000/?v=1");
    expect(withQuery("/a", "")).toBe("/a");
  });

  it("puts the query on the first navigate step only", () => {
    const plan: Plan = {
      title: "t",
      steps: [
        { id: 1, action: "navigate", url: "/signup", caption: "a" },
        { id: 2, action: "click", target: { role: "button", name: "Go" }, caption: "b" },
        { id: 3, action: "navigate", url: "/dashboard", caption: "c" },
      ],
    };
    const out = planWithQuery(plan, "?variant=renamed");
    expect(out.steps.map((s) => s.url)).toEqual(["/signup?variant=renamed", undefined, "/dashboard"]);
    expect(plan.steps[0]!.url).toBe("/signup"); // input not mutated
    expect(planWithQuery(plan, "")).toBe(plan);
  });
});

describe("renamed variant through the pipeline (A2 integration, mock modules)", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "df-variant-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("launches the clean path, gives the query to the inspector and the first runner page, and keeps repair on with a cached plan", async () => {
    const store = new JobStore(dir);
    const events = new JobEvents((id) => store.jobDir(id));
    const base = await createRegistry({ useMocks: true });
    const seen: { source?: string; inspectBaseUrl?: string; firstUrl?: string; repair?: unknown; runBaseUrl?: string } = {};
    const registry: Registry = {
      ...base,
      launchProject: async (a) => ((seen.source = a.source), base.launchProject(a)),
      inspectProject: async (a) => ((seen.inspectBaseUrl = a.info.baseUrl), base.inspectProject(a)),
      runPlan: async (a) => (
        (seen.firstUrl = a.plan.steps[0]!.url), (seen.repair = a.repair), (seen.runBaseUrl = a.baseUrl), base.runPlan(a)
      ),
    };
    const root = findRepoRoot()!;
    const cachedPlan = join(root, "docs/fallback/cached-plan.json");
    const pipeline = new Pipeline({ store, events, registry, settings: () => ({ cachedPlan }) });
    const job = store.create({ source: "samples/taskly?variant=renamed", instructions: "" });
    pipeline.enqueue(job.id);
    await pipeline.idle();

    const done = store.get(job.id)!;
    expect(done.status).toBe("done");
    expect(seen.source).toBe(join(root, "samples/taskly")); // no query, resolved (A1)
    expect(seen.inspectBaseUrl).toBe(`${new URL(done.info!.baseUrl).origin}/?variant=renamed`);
    expect(done.info!.baseUrl).not.toContain("variant"); // stored LaunchInfo stays clean
    expect(seen.runBaseUrl).not.toContain("variant");
    expect(seen.firstUrl).toBe("/signup?variant=renamed");
    expect(done.plan!.steps[0]!.url).toBe("/signup?variant=renamed");
    expect(seen.repair).toBe(base.repairStep); // seeded run: repair stays on even with a cached plan
    expect(events.history(job.id).some((e) => e.type === "log" && /\?variant=renamed/.test(e.message ?? ""))).toBe(true);
  });

  it("a plain cached-plan job still runs without repair (E7-7 unchanged)", async () => {
    const store = new JobStore(dir);
    const events = new JobEvents((id) => store.jobDir(id));
    const base = await createRegistry({ useMocks: true });
    let repair: unknown = "unset";
    const registry: Registry = { ...base, runPlan: async (a) => ((repair = a.repair), base.runPlan(a)) };
    const cachedPlan = join(findRepoRoot()!, "docs/fallback/cached-plan.json");
    const pipeline = new Pipeline({ store, events, registry, settings: () => ({ cachedPlan }) });
    pipeline.enqueue(store.create({ source: "samples/taskly", instructions: "" }).id);
    await pipeline.idle();
    expect(repair).toBeUndefined();
  });
});
