import { LaunchError, withOutput } from "./errors.js";

/** Refusals to the same port needed before we call it a missing backend. */
export const MIN_REFUSALS = 3;

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
// A loopback address (not preceded by a word character or dot, so `10.0.0.0` is not `0.0.0.0`), then a port.
const LOCAL = String.raw`(?<![\w.])(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)`;
const HOST_PORT = new RegExp(`${LOCAL}:(\\d{2,5})\\b`, "g");
// Node prints a failed connect as an object too: `code: 'ECONNREFUSED', ... address: '127.0.0.1', port: 4000`.
const ADDRESS_PORT = new RegExp(`address:\\s*'${LOCAL}'[^]*?port:\\s*(\\d{2,5})\\b`);
// That `code:` line trails an error whose first line was already counted.
const CODE_PROPERTY = /^\s*(?:\[?cause\]?:\s*)?code:\s*['"]ECONNREFUSED['"]/;
const PROPERTY_REACH = 8; // how many lines after an error its `code:` property can appear

/**
 * Looks for repeated ECONNREFUSED errors to a localhost port other than the app's own,
 * the sign that the app needs a separate backend (API, database) that is not running.
 * Handles the common shapes: `connect ECONNREFUSED 127.0.0.1:4000`, `ECONNREFUSED ::1:4000`,
 * CRA's "Could not proxy request ... to http://localhost:4000/ ... (ECONNREFUSED)" and Node's
 * `{ code: 'ECONNREFUSED', address: '127.0.0.1', port: 4000 }`.
 * Returns the port with at least MIN_REFUSALS refusals (the most frequent one), else undefined.
 */
export function findBackendPort(lines: readonly string[], appPort: number): number | undefined {
  const clean = lines.map((l) => l.replace(ANSI, ""));
  const counts = new Map<number, number>();
  let lastCounted = -Infinity;

  const portOn = (j: number): number | undefined =>
    [...(clean[j] ?? "").matchAll(HOST_PORT)].map((m) => Number(m[1])).find((p) => p !== appPort && p <= 65535);

  clean.forEach((line, i) => {
    if (!line.includes("ECONNREFUSED")) return;
    // One error often spans several lines; count it once (its trailing `code:` line is not a new error).
    if (CODE_PROPERTY.test(line) && i - lastCounted <= PROPERTY_REACH) return;

    // The port is on this line, or on the line before (CRA), or just after; nearest first.
    let port: number | undefined;
    for (const j of [i, i - 1, i + 1, i + 2, i + 3, i - 2]) {
      port = portOn(j);
      if (port !== undefined) break;
    }
    if (port === undefined) {
      const m = ADDRESS_PORT.exec(clean.slice(i, i + 4).join("\n"));
      const p = m ? Number(m[1]) : undefined;
      if (p !== undefined && p !== appPort && p <= 65535) port = p;
    }
    if (port === undefined) return;

    counts.set(port, (counts.get(port) ?? 0) + 1);
    lastCounted = i;
  });

  let best: number | undefined;
  for (const [port, n] of counts) {
    if (n >= MIN_REFUSALS && (best === undefined || n > (counts.get(best) ?? 0))) best = port;
  }
  return best;
}

export function needsBackendError(backendPort: number, appPort: number, tail: readonly string[]): LaunchError {
  return new LaunchError(
    "NEEDS_BACKEND",
    withOutput(
      `This app needs another service on localhost:${backendPort} (for example an API or a database), and nothing is listening there ` +
        `(connection refused). DemoForge only starts the app itself, not its backend. Start that service first, or change the app's ` +
        `settings to use a hosted address, then try again. (The app itself runs on port ${appPort}.)`,
      tail,
    ),
  );
}

export function missingEnvError(names: readonly string[], tail: readonly string[]): LaunchError {
  return new LaunchError(
    "MISSING_ENV",
    withOutput(
      `The app did not start, and its .env.example lists settings that are not set here: ${names.join(", ")}. ` +
        `That is the most likely cause. Create a .env file in the project folder (copy .env.example and fill in real values), ` +
        `or set them in your shell, then try again.`,
      tail,
    ),
  );
}

export function portInUseError(port: number): LaunchError {
  return new LaunchError(
    "PORT_IN_USE",
    `Something is already using port ${port}, and DemoForge will not attach to a server it did not start. ` +
      `Stop that program, or choose a different port, then try again.`,
  );
}

export function noStartScriptError(): LaunchError {
  return new LaunchError(
    "NO_START_SCRIPT",
    `package.json has no "dev" or "start" script, so DemoForge does not know how to start this app. ` +
      `Add one (for example "dev": "next dev"), or pass startCommand as \`npm run <script>\` for a script that exists.`,
  );
}

export function installFailedError(args: {
  command: string;
  /** Set when the install was killed for taking too long. */
  timedOutAfterSec?: number;
  /** e.g. "exited with 1"; used when it did not time out. */
  how?: string;
  tail: readonly string[];
}): LaunchError {
  const what =
    args.timedOutAfterSec !== undefined
      ? `timed out after ${args.timedOutAfterSec}s and was stopped`
      : (args.how ?? "failed");
  return new LaunchError(
    "INSTALL_FAILED",
    withOutput(
      `Installing the project's dependencies did not finish (\`${args.command}\` ${what}). ` +
        `Check your internet connection and that the project installs on its own: run that command in the project folder ` +
        `to see the full error, fix it, then try again.`,
      args.tail,
    ),
  );
}

export type StartFailure =
  | { kind: "exited"; how: string } // e.g. "exited with 1"
  | { kind: "timeout"; readyMs: number };

/**
 * Turns a failed start into the most useful error. Specific evidence beats a guess:
 * 1. NEEDS_BACKEND: repeated connection-refused errors to another localhost port in the logs.
 * 2. MISSING_ENV: the .env.example lists settings that are not set here (a heuristic; the app
 *    is only blamed on them because it failed).
 * 3. Otherwise START_FAILED (it exited) or START_TIMEOUT (it never answered).
 */
export function classifyStartFailure(args: {
  failure: StartFailure;
  startCommand: string;
  port: number;
  /** Output of the dev server only (not the install). */
  devLines: readonly string[];
  envVarsRequired: readonly string[];
}): LaunchError {
  const { failure, startCommand, port, devLines, envVarsRequired } = args;

  const backend = findBackendPort(devLines, port);
  if (backend !== undefined) return needsBackendError(backend, port, devLines);
  if (envVarsRequired.length > 0) return missingEnvError(envVarsRequired, devLines);

  if (failure.kind === "exited") {
    return new LaunchError(
      "START_FAILED",
      withOutput(
        `The app stopped right after starting (\`${startCommand}\` ${failure.how}) before it was ready. ` +
          `Run that command yourself in the project folder to see the full error, fix it, then try again.`,
        devLines,
      ),
    );
  }
  return new LaunchError(
    "START_TIMEOUT",
    withOutput(
      `The app did not answer at http://localhost:${port} within ${failure.readyMs / 1000}s. It may be slow to start, ` +
        `or it may be listening on a different port. Run \`${startCommand}\` in the project folder to see what it says; ` +
        `if it uses another port, pass that port, and if it is only slow, try again.`,
      devLines,
    ),
  );
}
