import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchProject } from "@demoforge/launcher";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobEvents } from "./events.js";
import { findRepoRoot, Pipeline, resolveProjectSource } from "./pipeline.js";
import { createRegistry } from "./registry.js";
import { JobStore } from "./store.js";

const ROOT = findRepoRoot()!;

describe("resolveProjectSource (A1)", () => {
  it("finds the repo root: the folder whose package.json has workspaces", () => {
    expect(ROOT).toBeTruthy();
    expect(resolveProjectSource("package.json", { initCwd: undefined })).toBe(join(ROOT, "package.json"));
  });

  it("(1) resolves samples/taskly to <repo>/samples/taskly, wherever the API runs", () => {
    expect(resolveProjectSource("samples/taskly", { initCwd: undefined })).toBe(join(ROOT, "samples/taskly"));
    expect(resolveProjectSource("./samples/taskly", { initCwd: join(ROOT, "apps/api") })).toBe(join(ROOT, "samples/taskly"));
  });

  it("prefers INIT_CWD when the folder exists there", () => {
    expect(resolveProjectSource("taskly", { initCwd: join(ROOT, "samples") })).toBe(join(ROOT, "samples/taskly"));
    // not there: falls back to the repo root
    expect(resolveProjectSource("samples/taskly", { initCwd: join(ROOT, "packages") })).toBe(join(ROOT, "samples/taskly"));
  });

  it("(2) leaves an absolute path unchanged", () => {
    const abs = join(ROOT, "samples/taskly");
    expect(resolveProjectSource(abs, { initCwd: "/somewhere/else" })).toBe(abs);
  });

  it("(3) leaves git and https URLs unchanged", () => {
    for (const url of ["https://github.com/acme/app.git", "git@github.com:acme/app.git", "ssh://git@host/acme/app"]) {
      expect(resolveProjectSource(url, { initCwd: "/tmp" })).toBe(url);
    }
  });
});

describe("relative source through the pipeline with the real launcher (A1)", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "df-src-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("(4) a missing folder still fails with NOT_FOUND, and the message has the resolved path", async () => {
    const store = new JobStore(dir);
    const events = new JobEvents((id) => store.jobDir(id));
    const registry = { ...(await createRegistry({ useMocks: true })), launchProject };
    const pipeline = new Pipeline({ store, events, registry, settings: () => ({}) });
    const job = store.create({ source: "samples/no-such-project", instructions: "" });
    pipeline.enqueue(job.id);
    await pipeline.idle();

    expect(store.get(job.id)?.status).toBe("failed");
    const error = events.history(job.id).find((e) => e.type === "error");
    const data = error?.data as { code: string; detail: string };
    expect(data.code).toBe("NOT_FOUND");
    expect(data.detail).toContain(join(ROOT, "samples/no-such-project"));
    expect(data.detail).not.toContain(join("apps", "api", "samples"));
  });
});
