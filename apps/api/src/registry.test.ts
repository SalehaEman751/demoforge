import { describe, expect, it } from "vitest";
import {
  FUNCTION_PACKAGES,
  createRegistry,
  defaultLoaders,
  isNotImplemented,
  type FnName,
  type Loaders,
} from "./registry.js";

/** Loaders whose real and mock functions are tagged so tests can tell which one ran. */
const fakeLoaders = (real: Partial<Record<FnName, () => Promise<unknown>>> = {}): Loaders => {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(FUNCTION_PACKAGES)) {
    out[name] = {
      real: real[name as FnName] ?? (async () => () => `real:${name}`),
      mock: async () => () => `mock:${name}`,
    };
  }
  return out as Loaders;
};
const call = (fn: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args);

describe("registry", () => {
  it("uses the real function when it imports", async () => {
    const reg = await createRegistry({ useMocks: false, loaders: fakeLoaders() });
    expect(await call(reg.planDemo)).toBe("real:planDemo");
    expect(reg.status().every((s) => s.source === "real")).toBe(true);
  });

  it("uses every mock when USE_MOCKS=1, without importing the real packages", async () => {
    let imported = false;
    const loaders = fakeLoaders({ runPlan: async () => ((imported = true), () => "real") });
    const reg = await createRegistry({ useMocks: true, loaders });
    expect(await call(reg.runPlan)).toBe("mock:runPlan");
    expect(imported).toBe(false);
    expect(reg.status().every((s) => s.source === "mock" && s.reason === "USE_MOCKS=1")).toBe(true);
  });

  it("falls back to the mock when the real import fails", async () => {
    const loaders = fakeLoaders({
      runPlan: async () => {
        throw new Error("Cannot find package 'playwright-core'");
      },
    });
    const reg = await createRegistry({ useMocks: false, loaders });
    expect(await call(reg.runPlan)).toBe("mock:runPlan");
    expect(await call(reg.planDemo)).toBe("real:planDemo");
    const s = reg.status().find((x) => x.name === "runPlan")!;
    expect(s.source).toBe("mock");
    expect(s.reason).toMatch(/import failed: .*playwright-core/);
  });

  it("treats a real export identical to the mock as the mock", async () => {
    const shared = () => "same";
    const loaders = fakeLoaders();
    loaders.repairStep = { real: async () => shared as never, mock: async () => shared as never };
    const reg = await createRegistry({ useMocks: false, loaders });
    expect(reg.status().find((x) => x.name === "repairStep")?.source).toBe("mock");
  });

  it("switches to the mock when the real function throws NOT_IMPLEMENTED (async)", async () => {
    const logs: string[] = [];
    const loaders = fakeLoaders({
      launchProject: async () => async () => {
        throw Object.assign(new Error("not built"), { code: "NOT_IMPLEMENTED" });
      },
    });
    const reg = await createRegistry({ useMocks: false, loaders, log: (m) => logs.push(m) });
    expect(await call(reg.launchProject)).toBe("mock:launchProject");
    expect(reg.status().find((x) => x.name === "launchProject")?.source).toBe("mock");
    expect(logs.some((l) => l.includes("launchProject") && l.includes("NOT_IMPLEMENTED"))).toBe(true);
  });

  it("switches to the mock when a sync real function throws NOT_IMPLEMENTED", async () => {
    const loaders = fakeLoaders({
      computeMetrics: async () => () => {
        throw new Error("NOT_IMPLEMENTED");
      },
    });
    const reg = await createRegistry({ useMocks: false, loaders });
    expect(call(reg.computeMetrics)).toBe("mock:computeMetrics");
  });

  it("rethrows other errors from the real function", async () => {
    const loaders = fakeLoaders({
      planDemo: async () => async () => {
        throw new Error("model unreachable");
      },
    });
    const reg = await createRegistry({ useMocks: false, loaders });
    await expect(call(reg.planDemo)).rejects.toThrow("model unreachable");
    expect(reg.status().find((x) => x.name === "planDemo")?.source).toBe("real");
  });

  it("prints the active module list", async () => {
    const logs: string[] = [];
    await createRegistry({ useMocks: true, loaders: fakeLoaders(), log: (m) => logs.push(m) });
    expect(logs.join("\n")).toContain("Active modules:");
    for (const name of Object.keys(FUNCTION_PACKAGES)) expect(logs.join("\n")).toContain(name);
  });

  it("detects NOT_IMPLEMENTED by code, name or message", () => {
    expect(isNotImplemented(Object.assign(new Error("x"), { code: "NOT_IMPLEMENTED" }))).toBe(true);
    expect(isNotImplemented(new Error("NOT_IMPLEMENTED: launcher"))).toBe(true);
    expect(isNotImplemented(new Error("boom"))).toBe(false);
    expect(isNotImplemented(undefined)).toBe(false);
  });

  it("loads the workspace mocks with the default loaders", async () => {
    const reg = await createRegistry({ useMocks: true, loaders: defaultLoaders });
    const { info } = await reg.launchProject({ source: "./samples/taskly" });
    expect(info.baseUrl).toMatch(/^http/);
  });
});
