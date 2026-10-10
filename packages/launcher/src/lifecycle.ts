import { spawnSync } from "node:child_process";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";

const isWin = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Signals a whole process group (POSIX) or tree (Windows, via taskkill). Never throws. */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    else process.kill(-pid, signal);
  } catch {
    // group already gone
  }
}

/** True while any member of the group is still running. */
export function groupAlive(pid: number): boolean {
  try {
    process.kill(isWin ? pid : -pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** SIGTERM the group, wait up to graceMs, then SIGKILL whatever is left. */
export async function terminateGroup(pid: number, graceMs = 5000): Promise<void> {
  signalGroup(pid, "SIGTERM");
  let end = Date.now() + graceMs;
  while (groupAlive(pid) && Date.now() < end) await sleep(50);
  if (!groupAlive(pid)) return;
  signalGroup(pid, "SIGKILL");
  end = Date.now() + 2000;
  while (groupAlive(pid) && Date.now() < end) await sleep(50);
}

export type Session = {
  /** Remember a process group so stop() (and the signal handlers) can kill it. */
  track(pid: number): void;
  untrack(pid: number): void;
  /** Kills every tracked process tree, then deletes cleanupDir. Safe to call twice. */
  stop(): Promise<void>;
};

type Internal = { stop(): Promise<void>; stopSync(): void };

const sessions = new Set<Internal>();
let installed = false;

async function stopAll(): Promise<void> {
  await Promise.allSettled([...sessions].map((s) => s.stop()));
}

const onSignal = (signal: NodeJS.Signals) => {
  void stopAll().finally(() => process.exit(128 + (os.constants.signals[signal] ?? 0)));
};
const onSigint = () => onSignal("SIGINT");
const onSigterm = () => onSignal("SIGTERM");
const onUncaught = (err: unknown) => {
  console.error(err);
  void stopAll().finally(() => process.exit(1));
};
// Last resort for process.exit() elsewhere: synchronous, so no graceful wait.
const onExit = () => {
  for (const s of sessions) s.stopSync();
};

function installHandlers(): void {
  if (installed) return;
  installed = true;
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  // Unhandled promise rejections surface here too (Node's default is to throw them).
  process.on("uncaughtException", onUncaught);
  process.on("exit", onExit);
}

function removeHandlersIfIdle(): void {
  if (!installed || sessions.size > 0) return;
  installed = false;
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  process.off("uncaughtException", onUncaught);
  process.off("exit", onExit);
}

export function createSession(opts: { cleanupDir?: string } = {}): Session {
  const pgids = new Set<number>();
  let stopping: Promise<void> | undefined;

  const internal: Internal = {
    stop() {
      stopping ??= (async () => {
        try {
          await Promise.all([...pgids].map((pid) => terminateGroup(pid)));
          pgids.clear();
          if (opts.cleanupDir) await fs.rm(opts.cleanupDir, { recursive: true, force: true });
        } finally {
          sessions.delete(internal);
          removeHandlersIfIdle();
        }
      })();
      return stopping;
    },
    stopSync() {
      for (const pid of pgids) signalGroup(pid, "SIGKILL");
      if (opts.cleanupDir) rmSync(opts.cleanupDir, { recursive: true, force: true });
    },
  };

  sessions.add(internal);
  installHandlers();

  return {
    track: (pid) => void pgids.add(pid),
    untrack: (pid) => void pgids.delete(pid),
    stop: () => internal.stop(),
  };
}
