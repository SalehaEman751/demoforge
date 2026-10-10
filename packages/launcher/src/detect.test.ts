import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProject } from "./detect.js";
import { LaunchError } from "./errors.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "detect-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function project(
  pkg: object,
  files: Record<string, string> = {},
  dir = tmp,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), body);
  return dir;
}

async function codeOf(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(LaunchError);
  return (err as LaunchError).code;
}

describe("framework + default port", () => {
  it.each([
    ["next", { dependencies: { next: "14" } }, 3000],
    ["vite", { devDependencies: { vite: "5" } }, 5173],
    ["cra", { dependencies: { "react-scripts": "5" } }, 3000],
    ["unknown", { dependencies: { express: "4" } }, 3000],
  ] as const)("%s", async (framework, deps, port) => {
    const dir = await project({ ...deps, scripts: { dev: "x" } });
    const d = await detectProject({ projectDir: dir });
    expect(d.framework).toBe(framework);
    expect(d.port).toBe(port);
  });

  it("an explicit port overrides the default", async () => {
    const dir = await project({ devDependencies: { vite: "5" }, scripts: { dev: "vite" } });
    expect((await detectProject({ projectDir: dir, port: 4321 })).port).toBe(4321);
  });

  it.each([0, 70000, 1.5, -1])("rejects port %s", async (port) => {
    const dir = await project({ scripts: { dev: "x" } });
    expect(await codeOf(detectProject({ projectDir: dir, port }))).toBe("INVALID_ARGS");
  });
});

describe("package manager", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const)("%s -> %s", async (lock, pm) => {
    const dir = await project({ scripts: { dev: "x" } }, { [lock]: "" });
    expect((await detectProject({ projectDir: dir })).packageManager).toBe(pm);
  });

  it("defaults to npm without a lockfile", async () => {
    const dir = await project({ scripts: { dev: "x" } });
    expect((await detectProject({ projectDir: dir })).packageManager).toBe("npm");
  });

  it("finds a lockfile at the repo root for a subdir project", async () => {
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "");
    const sub = await project({ scripts: { dev: "x" } }, {}, path.join(tmp, "apps", "web"));
    expect((await detectProject({ projectDir: sub, rootDir: tmp })).packageManager).toBe("pnpm");
  });

  it("does not look above rootDir", async () => {
    await fs.writeFile(path.join(tmp, "yarn.lock"), "");
    const root = path.join(tmp, "repo");
    const sub = await project({ scripts: { dev: "x" } }, {}, path.join(root, "web"));
    expect((await detectProject({ projectDir: sub, rootDir: root })).packageManager).toBe("npm");
  });
});

describe("start command", () => {
  it("prefers dev over start", async () => {
    const dir = await project({ scripts: { dev: "node d.js", start: "node s.js" } });
    expect((await detectProject({ projectDir: dir })).startCommand).toBe("npm run dev");
  });

  it("falls back to start", async () => {
    const dir = await project({ scripts: { start: "node s.js" } });
    expect((await detectProject({ projectDir: dir })).startCommand).toBe("npm run start");
  });

  it("errors with NO_START_SCRIPT when neither exists", async () => {
    const dir = await project({ scripts: { build: "x" } });
    expect(await codeOf(detectProject({ projectDir: dir }))).toBe("NO_START_SCRIPT");
  });

  it("an accepted startCommand override is used as given (trimmed), without a port flag", async () => {
    const dir = await project({ dependencies: { next: "14" }, scripts: { dev: "next dev", "dev:fast": "next dev --turbo" } });
    const d = await detectProject({ projectDir: dir, startCommand: "  npm run dev:fast  ", port: 3100 });
    expect(d.startCommand).toBe("npm run dev:fast");
    expect(d.port).toBe(3100);
  });

  it("rejects an empty startCommand", async () => {
    const dir = await project({ scripts: { dev: "x" } });
    expect(await codeOf(detectProject({ projectDir: dir, startCommand: "  " }))).toBe("INVALID_ARGS");
  });

  it("next: passes -p after -- for npm", async () => {
    const dir = await project({ dependencies: { next: "14" }, scripts: { dev: "next dev" } });
    const d = await detectProject({ projectDir: dir, port: 3100 });
    expect(d.startCommand).toBe("npm run dev -- -p 3100");
  });

  it("vite: passes --port --strictPort, without -- for yarn and pnpm", async () => {
    const pkg = { devDependencies: { vite: "5" }, scripts: { dev: "vite" } };
    const y = await project(pkg, { "yarn.lock": "" }, path.join(tmp, "y"));
    const p = await project(pkg, { "pnpm-lock.yaml": "" }, path.join(tmp, "p"));
    expect((await detectProject({ projectDir: y })).startCommand).toBe("yarn run dev --port 5173 --strictPort");
    expect((await detectProject({ projectDir: p, port: 4000 })).startCommand).toBe(
      "pnpm run dev --port 4000 --strictPort",
    );
  });

  it("cra and wrapped scripts rely on the PORT env var (no flags)", async () => {
    const cra = await project({ dependencies: { "react-scripts": "5" }, scripts: { start: "react-scripts start" } }, {}, path.join(tmp, "c"));
    const wrapped = await project(
      { dependencies: { next: "14" }, scripts: { dev: 'concurrently "next dev" "tsc -w"' } },
      {},
      path.join(tmp, "w"),
    );
    expect((await detectProject({ projectDir: cra })).startCommand).toBe("npm run start");
    expect((await detectProject({ projectDir: wrapped })).startCommand).toBe("npm run dev");
  });
});

describe("env vars from .env.example", () => {
  const example = [
    "# comment",
    "",
    "DATABASE_URL=postgres://x",
    "export API_KEY=",
    "  SPACED = 1",
    "ALREADY_SET=abc",
    "EMPTY_IN_ENV=foo",
    "DATABASE_URL=dup",
    "not a var line",
    "1BAD=x",
  ].join("\n");

  it("lists names that are unset or empty in the environment", async () => {
    const dir = await project({ scripts: { dev: "x" } }, { ".env.example": example });
    const d = await detectProject({
      projectDir: dir,
      env: { ALREADY_SET: "yes", EMPTY_IN_ENV: "" },
    });
    expect(d.envVarsRequired).toEqual(["DATABASE_URL", "API_KEY", "SPACED", "EMPTY_IN_ENV"]);
  });

  it("is empty without a .env.example", async () => {
    const dir = await project({ scripts: { dev: "x" } });
    expect((await detectProject({ projectDir: dir, env: {} })).envVarsRequired).toEqual([]);
  });

  it("is empty when everything is set", async () => {
    const dir = await project({ scripts: { dev: "x" } }, { ".env.example": "A=1\nB=2" });
    expect((await detectProject({ projectDir: dir, env: { A: "1", B: "2" } })).envVarsRequired).toEqual([]);
  });
});

describe("package.json problems", () => {
  it("invalid JSON -> INVALID_PACKAGE_JSON", async () => {
    await fs.writeFile(path.join(tmp, "package.json"), "{ nope");
    expect(await codeOf(detectProject({ projectDir: tmp }))).toBe("INVALID_PACKAGE_JSON");
  });

  it("wrong shape -> INVALID_PACKAGE_JSON", async () => {
    await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ scripts: { dev: 5 } }));
    expect(await codeOf(detectProject({ projectDir: tmp }))).toBe("INVALID_PACKAGE_JSON");
  });
});

describe("detector edge cases", () => {
  it("next wins when both next and vite are dependencies", async () => {
    const dir = await project({ dependencies: { next: "14" }, devDependencies: { vite: "5" }, scripts: { dev: "next dev" } });
    expect((await detectProject({ projectDir: dir })).framework).toBe("next");
  });

  it("finds the framework in devDependencies", async () => {
    const dir = await project({ devDependencies: { next: "14" }, scripts: { dev: "x" } });
    expect((await detectProject({ projectDir: dir })).framework).toBe("next");
  });

  it("with several lockfiles, pnpm beats yarn beats npm", async () => {
    const all = await project({ scripts: { dev: "x" } }, { "pnpm-lock.yaml": "", "yarn.lock": "", "package-lock.json": "" }, path.join(tmp, "all"));
    const yarnNpm = await project({ scripts: { dev: "x" } }, { "yarn.lock": "", "package-lock.json": "" }, path.join(tmp, "yn"));
    expect((await detectProject({ projectDir: all })).packageManager).toBe("pnpm");
    expect((await detectProject({ projectDir: yarnNpm })).packageManager).toBe("yarn");
  });

  it("reads .env.example with Windows line endings", async () => {
    const dir = await project({ scripts: { dev: "x" } }, { ".env.example": "A=1\r\nB=2\r\n" });
    expect((await detectProject({ projectDir: dir, env: {} })).envVarsRequired).toEqual(["A", "B"]);
  });

  it("NO_START_SCRIPT tells the user how to fix it", async () => {
    const dir = await project({ scripts: { build: "x" } });
    const err = await detectProject({ projectDir: dir }).then(() => null, (e: unknown) => e as LaunchError);
    expect(err?.code).toBe("NO_START_SCRIPT");
    expect(err?.message).toMatch(/no "dev" or "start" script/);
    expect(err?.message).toMatch(/startCommand/);
  });

  it("a rejected override fails even when a valid dev script exists (no silent fallback)", async () => {
    const dir = await project({ scripts: { dev: "node server.js" } });
    expect(await codeOf(detectProject({ projectDir: dir, startCommand: "node server.js" }))).toBe("INVALID_ARGS");
    expect(await codeOf(detectProject({ projectDir: dir, startCommand: "npm run nope" }))).toBe("NO_START_SCRIPT");
  });

  it("a bad port says what is wrong", async () => {
    const dir = await project({ scripts: { dev: "x" } });
    const err = await detectProject({ projectDir: dir, port: 70000 }).then(() => null, (e: unknown) => e as LaunchError);
    expect(err?.message).toMatch(/1 to 65535, got 70000/);
  });
});
