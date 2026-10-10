import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobStore } from "./store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "df-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const req = { source: "./samples/taskly", instructions: "sign up" };

describe("JobStore", () => {
  it("creates a queued job and writes job.json", () => {
    const store = new JobStore(dir);
    const job = store.create({ ...req, port: 3100 });
    expect(job.status).toBe("queued");
    expect(job.id).toMatch(/^job_[a-f0-9]{8}$/);
    const onDisk = JSON.parse(readFileSync(join(dir, job.id, "job.json"), "utf8"));
    expect(onDisk).toEqual(job);
    expect(store.getRequest(job.id)?.port).toBe(3100);
  });

  it("lists newest first, even within the same millisecond", () => {
    const store = new JobStore(dir);
    const a = store.create(req);
    const b = store.create(req);
    const c = store.create(req);
    expect(store.list().map((j) => j.id)).toEqual([c.id, b.id, a.id]);
  });

  it("update persists and reloads at startup", () => {
    const store = new JobStore(dir);
    const job = store.create(req);
    store.update(job.id, { status: "done" });
    const reloaded = new JobStore(dir);
    expect(reloaded.load()).toBe(1);
    expect(reloaded.get(job.id)?.status).toBe("done");
    expect(reloaded.getRequest(job.id)?.source).toBe(req.source);
  });

  it("marks in-progress jobs failed on load", () => {
    const store = new JobStore(dir);
    const job = store.create(req);
    store.update(job.id, { status: "running" });
    const reloaded = new JobStore(dir);
    reloaded.load();
    const got = reloaded.get(job.id);
    expect(got?.status).toBe("failed");
    expect(got?.error).toMatch(/restart/);
  });

  it("skips corrupt job files and warns", () => {
    const store = new JobStore(dir);
    const good = store.create(req);
    mkdirSync(join(dir, "job_deadbeef"));
    writeFileSync(join(dir, "job_deadbeef", "job.json"), "{not json");
    const warnings: string[] = [];
    const reloaded = new JobStore(dir);
    expect(reloaded.load((m) => warnings.push(m))).toBe(1);
    expect(reloaded.get(good.id)).toBeDefined();
    expect(warnings).toHaveLength(1);
  });

  it("returns copies, not live references", () => {
    const store = new JobStore(dir);
    const job = store.create(req);
    job.status = "done";
    expect(store.get(job.id)?.status).toBe("queued");
  });
});
