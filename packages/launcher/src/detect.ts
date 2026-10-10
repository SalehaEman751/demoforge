import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { LaunchInfo } from "@demoforge/shared";
import { noStartScriptError } from "./classify.js";
import { validateStartCommand } from "./command.js";
import { LaunchError } from "./errors.js";

type Framework = LaunchInfo["framework"];
type PackageManager = LaunchInfo["packageManager"];

export type Detected = Pick<
  LaunchInfo,
  "framework" | "packageManager" | "startCommand" | "port" | "envVarsRequired"
>;

const DEFAULT_PORTS: Record<Framework, number> = {
  next: 3000,
  vite: 5173,
  cra: 3000,
  unknown: 3000, // not in the ticket; 3000 is the common Node default
};

const PackageJsonSchema = z
  .object({
    scripts: z.record(z.string()).optional(),
    dependencies: z.record(z.string()).optional(),
    devDependencies: z.record(z.string()).optional(),
  })
  .passthrough();
type PackageJson = z.infer<typeof PackageJsonSchema>;

const PortSchema = z.number().int().min(1).max(65535);

export function detectFramework(pkg: PackageJson): Framework {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if ("next" in deps) return "next";
  if ("vite" in deps) return "vite";
  if ("react-scripts" in deps) return "cra";
  return "unknown";
}

const LOCKFILES: [file: string, pm: PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

/**
 * Looks for a lockfile in projectDir, then in each parent up to and including rootDir
 * (a monorepo subdir keeps its lockfile at the repo root). Defaults to npm.
 */
export async function detectPackageManager(
  projectDir: string,
  rootDir: string = projectDir,
): Promise<PackageManager> {
  let dir = projectDir;
  for (;;) {
    for (const [file, pm] of LOCKFILES) {
      if (await exists(path.join(dir, file))) return pm;
    }
    const parent = path.dirname(dir);
    if (dir === rootDir || parent === dir) return "npm";
    dir = parent;
  }
}

/** Names listed in .env.example (KEY=..., optional `export `) that are unset or empty in env. */
export async function detectEnvVars(
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(projectDir, ".env.example"), "utf8");
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const name = m?.[1];
    if (name && !names.includes(name) && !env[name]) names.push(name);
  }
  return names;
}

function buildStartCommand(
  pm: PackageManager,
  script: string,
  body: string,
  framework: Framework,
  port: number,
): string {
  const base = `${pm} run ${script}`;
  // Pass the port as a flag only when the script is a bare `next ...` / `vite ...`
  // call, where we know the flag is accepted. Everything else relies on the PORT env var.
  let flags = "";
  if (framework === "next" && /^\s*next\b/.test(body)) flags = `-p ${port}`;
  else if (framework === "vite" && /^\s*vite\b/.test(body)) flags = `--port ${port} --strictPort`;
  if (flags === "") return base;
  return pm === "npm" ? `${base} -- ${flags}` : `${base} ${flags}`;
}

export async function detectProject(args: {
  projectDir: string;
  rootDir?: string;
  startCommand?: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<Detected> {
  const { projectDir, rootDir, env } = args;

  const portCheck = PortSchema.optional().safeParse(args.port);
  if (!portCheck.success) {
    throw new LaunchError(
      "INVALID_ARGS",
      `The port must be a whole number from 1 to 65535, got ${String(args.port)}. Pass a valid port.`,
    );
  }

  let pkg: PackageJson;
  try {
    const raw = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
    const parsed = PackageJsonSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    pkg = parsed.data;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new LaunchError(
      "INVALID_PACKAGE_JSON",
      `Cannot read ${path.join(projectDir, "package.json")}: ${detail}. Fix the file so it is valid JSON with string scripts, then try again.`,
    );
  }

  const framework = detectFramework(pkg);
  const packageManager = await detectPackageManager(projectDir, rootDir);
  const port = args.port ?? DEFAULT_PORTS[framework];
  const envVarsRequired = await detectEnvVars(projectDir, env);

  let startCommand: string;
  if (args.startCommand !== undefined) {
    // Only `npm|yarn|pnpm run <script>` with a script that exists; checked before anything is spawned.
    // Used as given, so the port flag that is added to detected commands is not added here.
    startCommand = validateStartCommand(args.startCommand, pkg.scripts);
  } else {
    const scripts = pkg.scripts ?? {};
    const script = scripts.dev ? "dev" : scripts.start ? "start" : undefined;
    if (script === undefined) {
      throw noStartScriptError();
    }
    startCommand = buildStartCommand(packageManager, script, scripts[script] ?? "", framework, port);
  }

  return { framework, packageManager, startCommand, port, envVarsRequired };
}
