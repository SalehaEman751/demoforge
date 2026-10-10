import { spawn } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline";
import type { Detected } from "./detect.js";
import {
  classifyStartFailure,
  findBackendPort,
  installFailedError,
  needsBackendError,
  portInUseError,
  type StartFailure,
} from "./classify.js";
import { groupAlive, signalGroup, terminateGroup, type Session } from "./lifecycle.js";

export type Timeouts = { installMs: number; readyMs: number };
export const DEFAULT_TIMEOUTS: Timeouts = { installMs: 120_000, readyMs: 60_000 };

const isWin = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TAIL_LINES = 200;

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** True if anything accepts connections on the port (IPv4 or IPv6 loopback). */
export async function isPortInUse(port: number): Promise<boolean> {
  const results = await Promise.all([canConnect("127.0.0.1", port), canConnect("::1", port)]);
  return results.some(Boolean);
}

type ExitInfo = { code: number | null; signal: NodeJS.Signals | null; error?: string };

function spawnLogged(
  command: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; session: Session; log: (line: string) => void },
): { pid: number | undefined; exited: Promise<ExitInfo> } {
  const child = spawn(command, {
    cwd: opts.cwd,
    env: opts.env,
    shell: true,
    detached: !isWin, // own process group, so the whole tree can be killed at once
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { pid } = child;
  if (pid !== undefined) opts.session.track(pid);

  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", opts.log);
  }

  const closed = new Promise<void>((r) => child.once("close", () => r()));
  const exited = new Promise<ExitInfo>((resolve) => {
    child.once("error", (err) => resolve({ code: null, signal: null, error: err.message }));
    child.once("exit", (code, signal) => {
      // Give the pipes a moment to flush so the log tail is complete.
      void Promise.race([closed, sleep(200)]).then(() => resolve({ code, signal }));
    });
  });
  return { pid, exited };
}

export async function startProject(args: {
  projectDir: string;
  detected: Detected;
  session: Session;
  onLog?: (line: string) => void;
  timeouts?: Partial<Timeouts>;
}): Promise<void> {
  const { projectDir, detected, session } = args;
  const { installMs, readyMs } = { ...DEFAULT_TIMEOUTS, ...args.timeouts };
  const { port } = detected;
  const baseUrl = `http://localhost:${port}`;

  // Install output and dev-server output are kept apart: only the dev server's output is used to
  // work out why a start failed (an install log must not look like a missing backend).
  const installLines: string[] = [];
  const devLines: string[] = [];
  const keep = (buf: string[], line: string) => {
    buf.push(line);
    if (buf.length > TAIL_LINES) buf.shift();
    args.onLog?.(line);
  };
  const installLog = (line: string) => keep(installLines, line);
  const devLog = (line: string) => keep(devLines, line);

  const assertPortFree = async () => {
    if (await isPortInUse(port)) {
      throw portInUseError(port);
    }
  };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    BROWSER: "none", // CRA: do not open a browser tab
    NEXT_TELEMETRY_DISABLED: "1",
  };

  // Fail fast, before spending time on an install.
  await assertPortFree();

  // ---- install ----
  const installCommand =
    detected.packageManager === "npm" ? "npm install --no-audit --no-fund" : `${detected.packageManager} install`;
  installLog(`$ ${installCommand}`);
  const install = spawnLogged(installCommand, { cwd: projectDir, env, session, log: installLog });
  let installTimedOut = false;
  const installTimer = setTimeout(() => {
    installTimedOut = true;
    if (install.pid !== undefined) void terminateGroup(install.pid, 2000);
  }, installMs);
  const installExit = await install.exited;
  clearTimeout(installTimer);
  if (install.pid !== undefined) {
    signalGroup(install.pid, "SIGKILL"); // sweep up anything the install left behind
    session.untrack(install.pid);
  }
  if (installTimedOut) {
    throw installFailedError({ command: installCommand, timedOutAfterSec: installMs / 1000, tail: installLines });
  }
  if (installExit.code !== 0) {
    const how = installExit.error ?? `exited with ${installExit.code ?? installExit.signal}`;
    throw installFailedError({ command: installCommand, how, tail: installLines });
  }

  // ---- start ----
  await assertPortFree(); // the install took a while; someone may have taken the port
  devLog(`$ ${detected.startCommand}`);
  const dev = spawnLogged(detected.startCommand, { cwd: projectDir, env, session, log: devLog });
  const state: { exit?: ExitInfo } = {};
  void dev.exited.then((info) => {
    state.exit = info;
    // Keep tracking while orphaned children are still running, so stop() can kill them.
    if (dev.pid !== undefined && !groupAlive(dev.pid)) session.untrack(dev.pid);
  });
  const classify = (failure: StartFailure) =>
    classifyStartFailure({
      failure,
      startCommand: detected.startCommand,
      port,
      devLines,
      envVarsRequired: detected.envVarsRequired,
    });
  const startFailed = (info: ExitInfo) =>
    classify({ kind: "exited", how: info.error ?? `exited with ${info.code ?? info.signal}` });

  // ---- health check: HTTP 200 with a non-empty body ----
  const deadline = Date.now() + readyMs;
  while (Date.now() < deadline) {
    if (state.exit) throw startFailed(state.exit);
    // Not healthy yet, but the logs already show it is waiting on a backend that is not there:
    // say so now instead of waiting out the full timeout.
    const backend = findBackendPort(devLines, port);
    if (backend !== undefined) throw needsBackendError(backend, port, devLines);
    try {
      const res = await fetch(baseUrl, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
      });
      if (res.status === 200 && (await res.text()).trim().length > 0) return;
      await res.body?.cancel();
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  if (state.exit) throw startFailed(state.exit);
  throw classify({ kind: "timeout", readyMs });
}
