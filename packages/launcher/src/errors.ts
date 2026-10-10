export type LaunchErrorCode =
  // The seven user-facing failures from ticket E2-4.
  | "MISSING_ENV" // app did not start and .env.example lists settings that are not set
  | "INSTALL_FAILED" // install exited non-zero or timed out
  | "START_TIMEOUT" // dev server never answered HTTP 200 with a body in time
  | "NO_START_SCRIPT" // no scripts.dev / scripts.start, or startCommand names a script that does not exist
  | "NEEDS_BACKEND" // logs show repeated connection-refused errors to another localhost port
  | "NOT_FOUND" // bad source, missing folder / package.json / subdir, disallowed URL scheme
  | "PORT_IN_USE" // something is already listening on the port; we never attach to it
  // Internal codes kept from E2-1..E2-3.
  | "CLONE_FAILED" // git clone itself failed
  | "INVALID_ARGS" // bad port, or a startCommand that is not `npm|yarn|pnpm run <script>`
  | "INVALID_PACKAGE_JSON" // package.json is not valid JSON or has the wrong shape
  | "START_FAILED"; // dev server exited before it became healthy

/**
 * Every launch failure. `message` is plain language and says what to do next;
 * for failures that come with program output, the last lines follow a "--- last output ---" marker.
 */
export class LaunchError extends Error {
  readonly code: LaunchErrorCode;

  constructor(code: LaunchErrorCode, message: string) {
    super(message);
    this.name = "LaunchError";
    this.code = code;
  }
}

const TAIL_SHOWN = 20;

/** Appends the last lines of program output (if any) to a message. */
export function withOutput(message: string, lines: readonly string[]): string {
  if (lines.length === 0) return message;
  return `${message}\n--- last output ---\n${lines.slice(-TAIL_SHOWN).join("\n")}`;
}
