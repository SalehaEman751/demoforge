import type {
  ComputeMetricsFn,
  InspectProjectFn,
  LaunchProjectFn,
  PlanDemoFn,
  RepairStepFn,
  RunPlanFn,
} from "@demoforge/shared";

/** Which workspace package (folder name) provides each pipeline function. */
export const FUNCTION_PACKAGES = {
  launchProject: "launcher",
  inspectProject: "inspector",
  planDemo: "planner",
  runPlan: "runner",
  repairStep: "repair",
  computeMetrics: "metrics",
} as const;
export type FnName = keyof typeof FUNCTION_PACKAGES;
export type Source = "real" | "mock";

/** InspectProjectFn args plus the opt-in flag from the trust checkbox (not yet in the shared contract). */
export type InspectArgs = Parameters<InspectProjectFn>[0] & { allowAuthProbe?: boolean };
export type InspectFn = (args: InspectArgs) => ReturnType<InspectProjectFn>;

export type Fns = {
  launchProject: LaunchProjectFn;
  inspectProject: InspectFn;
  planDemo: PlanDemoFn;
  runPlan: RunPlanFn;
  repairStep: RepairStepFn;
  computeMetrics: ComputeMetricsFn;
};

export type ModuleStatus = { name: FnName; pkg: string; source: Source; reason: string };
export type Registry = Fns & {
  status(): ModuleStatus[];
  describe(): string;
};

export type Loaders = {
  [K in FnName]: {
    /** Import the real package and return the function (undefined if it is not exported). */
    real: () => Promise<Fns[K] | undefined>;
    /** Import the package's mock. */
    mock: () => Promise<Fns[K]>;
  };
};

type Log = (msg: string) => void;
type AnyFn = (...args: unknown[]) => unknown;

export const defaultLoaders: Loaders = {
  launchProject: {
    real: async () => (await import("@demoforge/launcher")).launchProject,
    mock: async () => (await import("@demoforge/launcher/src/mock.js")).launchProject,
  },
  inspectProject: {
    real: async () => (await import("@demoforge/inspector")).inspectProject,
    mock: async () => (await import("@demoforge/inspector/src/mock.js")).inspectProject,
  },
  planDemo: {
    real: async () => (await import("@demoforge/planner")).planDemo,
    mock: async () => (await import("@demoforge/planner/src/mock.js")).planDemo,
  },
  runPlan: {
    real: async () => (await import("@demoforge/runner")).runPlan,
    mock: async () => (await import("@demoforge/runner/src/mock.js")).runPlan,
  },
  repairStep: {
    real: async () => (await import("@demoforge/repair")).repairStep,
    mock: async () => (await import("@demoforge/repair/src/mock.js")).repairStep,
  },
  computeMetrics: {
    real: async () => (await import("@demoforge/metrics")).computeMetrics,
    mock: async () => (await import("@demoforge/metrics/src/mock.js")).computeMetrics,
  },
};

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** True for an error with code/name/message NOT_IMPLEMENTED (what a stubbed real module throws). */
export const isNotImplemented = (e: unknown): boolean => {
  if (!e || typeof e !== "object") return typeof e === "string" && e.includes("NOT_IMPLEMENTED");
  const { code, name, message } = e as { code?: unknown; name?: unknown; message?: unknown };
  return (
    code === "NOT_IMPLEMENTED" ||
    name === "NOT_IMPLEMENTED" ||
    (typeof message === "string" && message.includes("NOT_IMPLEMENTED"))
  );
};

const isPromise = (v: unknown): v is Promise<unknown> =>
  typeof (v as { then?: unknown } | null)?.then === "function";

async function resolveOne<K extends FnName>(
  name: K,
  loader: Loaders[K],
  useMocks: boolean,
  log: Log,
): Promise<{ fn: Fns[K]; status: ModuleStatus }> {
  const status: ModuleStatus = {
    name,
    pkg: `@demoforge/${FUNCTION_PACKAGES[name]}`,
    source: "mock",
    reason: "",
  };
  const mock = (await loader.mock()) as unknown as AnyFn;
  let real: AnyFn | undefined;

  if (useMocks) {
    status.reason = "USE_MOCKS=1";
  } else {
    try {
      const loaded = (await loader.real()) as unknown as AnyFn | undefined;
      if (typeof loaded !== "function") {
        status.reason = "package does not export it";
      } else if (loaded === mock) {
        status.reason = "package still exports its mock";
      } else {
        real = loaded;
        status.source = "real";
        status.reason = "imported";
      }
    } catch (e) {
      status.reason = `import failed: ${errMessage(e)}`;
    }
  }

  const call: AnyFn = (...args) => {
    if (!real || status.source === "mock") return mock(...args);
    const fallback = (err: unknown): unknown => {
      if (!isNotImplemented(err)) throw err;
      status.source = "mock";
      status.reason = "real function threw NOT_IMPLEMENTED";
      log(`${name}: ${status.pkg} threw NOT_IMPLEMENTED, switching to its mock`);
      return mock(...args);
    };
    try {
      const out = real(...args);
      return isPromise(out) ? out.catch(fallback) : out;
    } catch (e) {
      return fallback(e);
    }
  };
  return { fn: call as unknown as Fns[K], status };
}

export type CreateRegistryOptions = {
  /** Defaults to USE_MOCKS=1 in the environment. */
  useMocks?: boolean;
  log?: Log;
  loaders?: Loaders;
};

/**
 * Resolve each pipeline function to the real package or its mock.
 * Mock is used when USE_MOCKS=1, the real import fails, the package still just re-exports its mock,
 * or the real function throws NOT_IMPLEMENTED (checked per call, then it sticks to the mock).
 */
export async function createRegistry(opts: CreateRegistryOptions = {}): Promise<Registry> {
  const useMocks = opts.useMocks ?? process.env.USE_MOCKS === "1";
  const log = opts.log ?? (() => {});
  const loaders = opts.loaders ?? defaultLoaders;

  const names = Object.keys(FUNCTION_PACKAGES) as FnName[];
  const resolved = await Promise.all(names.map((n) => resolveOne(n, loaders[n], useMocks, log)));
  const fns: Record<string, unknown> = {};
  const statuses: ModuleStatus[] = [];
  for (const r of resolved) {
    fns[r.status.name] = r.fn;
    statuses.push(r.status);
  }

  const status = (): ModuleStatus[] => statuses.map((s) => ({ ...s }));
  const describe = (): string =>
    [
      "Active modules:",
      ...statuses.map(
        (s) => `  ${s.name.padEnd(15)} ${s.pkg.padEnd(22)} ${s.source}${s.reason ? ` (${s.reason})` : ""}`,
      ),
    ].join("\n");

  const registry = { ...(fns as Fns), status, describe };
  log(describe());
  return registry;
}
