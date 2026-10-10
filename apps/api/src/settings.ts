import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/** Repo root (apps/api/src -> ../../..). */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const ENV_FILE = resolve(REPO_ROOT, ".env");

/** Default files for the fallback switches. */
export const CACHED_VIDEO_FILE = resolve(REPO_ROOT, "docs/fallback/cached-demo.mp4");
export const DEFAULT_CACHED_PLAN_FILE = resolve(REPO_ROOT, "docs/fallback/cached-plan.json");

/** Variables set in the shell when the server started. Those always win over .env, like before. */
const shellKeys = new Set(Object.keys(process.env));

/**
 * Read a setting fresh, so editing .env takes effect on the next job without a restart.
 * Order: the shell environment at startup, then the current .env file, then process.env.
 */
export function liveSetting(key: string, envFile = ENV_FILE): string | undefined {
  if (shellKeys.has(key)) return process.env[key];
  try {
    if (existsSync(envFile)) {
      const fromFile = parseEnv(readFileSync(envFile, "utf8"))[key];
      if (fromFile !== undefined) return fromFile;
    }
  } catch {
    // An unreadable .env falls through to process.env.
  }
  return process.env[key];
}

/** Resolve a path from .env or a request: relative paths are taken from the repo root. */
export const fromRepoRoot = (p: string): string => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export type FallbackSettings = {
  /** Absolute path of the plan file to use instead of calling the model, or undefined when off. */
  cachedPlan?: string;
};

/** DEMOFORGE_CACHED_PLAN, read live; empty means off. */
export function readFallbackSettings(): FallbackSettings {
  const raw = liveSetting("DEMOFORGE_CACHED_PLAN")?.trim();
  return raw ? { cachedPlan: fromRepoRoot(raw) } : {};
}
