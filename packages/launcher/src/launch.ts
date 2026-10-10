import { LaunchInfoSchema, type LaunchProjectFn } from "@demoforge/shared";
import { z } from "zod";
import { detectProject } from "./detect.js";
import { LaunchError } from "./errors.js";
import { createSession } from "./lifecycle.js";
import { resolveSource, type RunGit } from "./resolve-source.js";
import { startProject, type Timeouts } from "./starter.js";

export type LaunchOptions = {
  /** Every line of install / dev-server output. */
  onLog?: (line: string) => void;
  /** Override the 120s install / 60s ready timeouts (mainly for tests). */
  timeouts?: Partial<Timeouts>;
  /** Replace `git clone` (tests only). */
  runGit?: RunGit;
  /** Environment used for the .env.example check. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
};

const OverridesSchema = z.object({
  startCommand: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

/**
 * Resolve the source, detect how to run it, install, start it, wait until it answers.
 * Fits LaunchProjectFn; the optional second argument is extra.
 */
export async function launchProject(
  args: Parameters<LaunchProjectFn>[0],
  opts: LaunchOptions = {},
): ReturnType<LaunchProjectFn> {
  const overrides = OverridesSchema.safeParse({ startCommand: args.startCommand, port: args.port });
  if (!overrides.success) {
    throw new LaunchError("INVALID_ARGS", overrides.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const resolved = await resolveSource(
    { source: args.source, subdir: args.subdir },
    { runGit: opts.runGit },
  );
  // From here on a Ctrl-C, SIGTERM or crash kills the processes and deletes the clone.
  const session = createSession({ cleanupDir: resolved.cloned ? resolved.rootDir : undefined });

  try {
    const detected = await detectProject({
      projectDir: resolved.projectDir,
      rootDir: resolved.rootDir,
      startCommand: overrides.data.startCommand,
      port: overrides.data.port,
      env: opts.env,
    });
    await startProject({
      projectDir: resolved.projectDir,
      detected,
      session,
      onLog: opts.onLog,
      timeouts: opts.timeouts,
    });
    const info = LaunchInfoSchema.parse({
      baseUrl: `http://localhost:${detected.port}`,
      projectDir: resolved.projectDir,
      ...detected,
    });
    return { info, stop: () => session.stop() };
  } catch (err) {
    await session.stop();
    throw err;
  }
}
