import { describe, expect, it } from "vitest";
import {
  MIN_REFUSALS,
  classifyStartFailure,
  findBackendPort,
  installFailedError,
  missingEnvError,
  needsBackendError,
  noStartScriptError,
  portInUseError,
} from "./classify.js";
import { LaunchError, withOutput } from "./errors.js";

const repeat = (n: number, block: string[]) => Array.from({ length: n }, () => block).flat();

const nodeRefused = (port: number, host = "127.0.0.1") => [`Error: connect ECONNREFUSED ${host}:${port}`, "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)"];

// What Node 20 prints for a failed server-side fetch(): one error spread over many lines.
const undiciRefused = (port: number) => [
  "TypeError: fetch failed",
  "    at node:internal/deps/undici/undici:13502:13 {",
  `  [cause]: Error: connect ECONNREFUSED 127.0.0.1:${port}`,
  "      at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16) {",
  "    errno: -111,",
  "    code: 'ECONNREFUSED',",
  "    syscall: 'connect',",
  "    address: '127.0.0.1',",
  `    port: ${port}`,
  "  }",
  "}",
];

const craProxy = (appPort: number, backend: number) => [
  `Proxy error: Could not proxy request /api/tasks from localhost:${appPort} to http://localhost:${backend}/.`,
  "See https://nodejs.org/api/errors.html#errors_common_system_errors for more information (ECONNREFUSED).",
];

const viteProxy = (backend: number) => [
  "[vite] http proxy error: /api/tasks",
  `Error: connect ECONNREFUSED 127.0.0.1:${backend}`,
  "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)",
];

describe("findBackendPort", () => {
  it("finds a port with repeated refusals (Node style)", () => {
    expect(findBackendPort(repeat(MIN_REFUSALS, nodeRefused(4000)), 3000)).toBe(4000);
  });

  it.each([
    ["IPv6 loopback", nodeRefused(4000, "::1")],
    ["localhost name", nodeRefused(4000, "localhost")],
    ["Vite proxy", viteProxy(4000)],
    ["CRA proxy (port before the error, error on the next line)", craProxy(3000, 4000)],
    ["undici fetch failed (multi-line, counted once per error)", undiciRefused(4000)],
  ])("recognises: %s", (_name, block) => {
    expect(findBackendPort(repeat(MIN_REFUSALS, block), 3000)).toBe(4000);
  });

  it("needs repeated refusals, not one or two", () => {
    expect(findBackendPort(repeat(MIN_REFUSALS - 1, nodeRefused(4000)), 3000)).toBeUndefined();
    expect(findBackendPort(repeat(MIN_REFUSALS - 1, undiciRefused(4000)), 3000)).toBeUndefined();
  });

  it("counts a multi-line error once, so two undici errors are still not enough", () => {
    expect(findBackendPort(undiciRefused(4000).concat(undiciRefused(4000)), 3000)).toBeUndefined();
  });

  it("ignores refusals to the app's own port", () => {
    expect(findBackendPort(repeat(6, nodeRefused(3000)), 3000)).toBeUndefined();
  });

  it("ignores refusals to other machines", () => {
    expect(findBackendPort(repeat(6, nodeRefused(4000, "10.0.0.5")), 3000)).toBeUndefined();
    expect(findBackendPort(repeat(6, nodeRefused(4000, "10.0.0.0")), 3000)).toBeUndefined(); // not 0.0.0.0
    expect(findBackendPort(repeat(6, ["connect ECONNREFUSED api.example.com:443"]), 3000)).toBeUndefined();
  });

  it("ignores a localhost port that is merely mentioned", () => {
    expect(findBackendPort(repeat(6, ["API at http://localhost:4000 ready"]), 3000)).toBeUndefined();
  });

  it("picks the most-refused port when there are several", () => {
    const lines = [...repeat(3, nodeRefused(4000)), ...repeat(5, nodeRefused(5432))];
    expect(findBackendPort(lines, 3000)).toBe(5432);
  });

  it("sees through ANSI colours", () => {
    const red = (s: string) => `\u001b[31m${s}\u001b[39m`;
    expect(findBackendPort(repeat(3, [red("Error: connect ECONNREFUSED 127.0.0.1:4000")]), 3000)).toBe(4000);
  });

  it("is undefined for ordinary logs", () => {
    expect(findBackendPort(["ready - started server on 0.0.0.0:3000", "GET / 200 in 12ms"], 3000)).toBeUndefined();
    expect(findBackendPort([], 3000)).toBeUndefined();
  });
});

describe("classifyStartFailure", () => {
  const base = { startCommand: "npm run dev", port: 3000, devLines: ["compiling..."], envVarsRequired: [] as string[] };

  it("dev server exited, nothing to blame -> START_FAILED, with command, status and output", () => {
    const err = classifyStartFailure({ ...base, failure: { kind: "exited", how: "exited with 1" } });
    expect(err.code).toBe("START_FAILED");
    expect(err.message).toMatch(/npm run dev/);
    expect(err.message).toMatch(/exited with 1/);
    expect(err.message).toMatch(/--- last output ---\ncompiling\.\.\./);
  });

  it("never answered -> START_TIMEOUT, with port and seconds", () => {
    const err = classifyStartFailure({ ...base, failure: { kind: "timeout", readyMs: 60_000 } });
    expect(err.code).toBe("START_TIMEOUT");
    expect(err.message).toMatch(/localhost:3000 within 60s/);
  });

  it("repeated refusals to another port -> NEEDS_BACKEND, on either failure kind", () => {
    const devLines = repeat(MIN_REFUSALS, nodeRefused(4000));
    for (const failure of [{ kind: "exited", how: "exited with 1" }, { kind: "timeout", readyMs: 5000 }] as const) {
      const err = classifyStartFailure({ ...base, devLines, failure });
      expect(err.code).toBe("NEEDS_BACKEND");
      expect(err.message).toMatch(/localhost:4000/);
    }
  });

  it("unset .env.example variables -> MISSING_ENV, naming them", () => {
    const err = classifyStartFailure({
      ...base,
      envVarsRequired: ["DATABASE_URL", "API_KEY"],
      failure: { kind: "exited", how: "exited with 1" },
    });
    expect(err.code).toBe("MISSING_ENV");
    expect(err.message).toMatch(/DATABASE_URL, API_KEY/);
    expect(err.message).toMatch(/\.env/);
  });

  it("MISSING_ENV also applies when the app just never answers", () => {
    const err = classifyStartFailure({ ...base, envVarsRequired: ["KEY"], failure: { kind: "timeout", readyMs: 1000 } });
    expect(err.code).toBe("MISSING_ENV");
  });

  it("direct evidence beats the env guess: NEEDS_BACKEND wins when both apply", () => {
    const err = classifyStartFailure({
      ...base,
      devLines: repeat(MIN_REFUSALS, nodeRefused(4000)),
      envVarsRequired: ["KEY"],
      failure: { kind: "exited", how: "exited with 1" },
    });
    expect(err.code).toBe("NEEDS_BACKEND");
  });
});

describe("every message is plain language that says what to do", () => {
  const tail = ["some output"];
  const errors: Array<[string, LaunchError]> = [
    ["NEEDS_BACKEND", needsBackendError(4000, 3000, tail)],
    ["MISSING_ENV", missingEnvError(["A"], tail)],
    ["PORT_IN_USE", portInUseError(3000)],
    ["NO_START_SCRIPT", noStartScriptError()],
    ["INSTALL_FAILED (exit)", installFailedError({ command: "npm install", how: "exited with 1", tail })],
    ["INSTALL_FAILED (timeout)", installFailedError({ command: "npm install", timedOutAfterSec: 120, tail })],
    ["START_FAILED", classifyStartFailure({ failure: { kind: "exited", how: "exited with 1" }, startCommand: "npm run dev", port: 3000, devLines: tail, envVarsRequired: [] })],
    ["START_TIMEOUT", classifyStartFailure({ failure: { kind: "timeout", readyMs: 60_000 }, startCommand: "npm run dev", port: 3000, devLines: tail, envVarsRequired: [] })],
  ];

  it.each(errors)("%s", (name, err) => {
    expect(err).toBeInstanceOf(LaunchError);
    expect(err.code).toBe(name.split(" ")[0]);
    // An instruction, not just a diagnosis ...
    expect(err.message).toMatch(/try again|then try|pass /i);
    // ... in words, not error-code jargon.
    expect(err.message).not.toMatch(/ECONNREFUSED|ENOENT|EADDRINUSE|\bcode \d+\b/);
  });

  it("INSTALL_FAILED says whether it timed out", () => {
    expect(installFailedError({ command: "npm install", timedOutAfterSec: 120, tail: [] }).message).toMatch(/timed out after 120s/);
    expect(installFailedError({ command: "pnpm install", how: "exited with 2", tail: [] }).message).toMatch(/pnpm install.*exited with 2/);
  });

  it("PORT_IN_USE names the port", () => {
    expect(portInUseError(5173).message).toMatch(/port 5173/);
  });
});

describe("withOutput", () => {
  it("adds nothing when there is no output", () => {
    expect(withOutput("msg", [])).toBe("msg");
  });
  it("keeps only the last 20 lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const out = withOutput("msg", lines);
    expect(out).toContain("line 49");
    expect(out).toContain("line 30");
    expect(out).not.toContain("line 29");
  });
});
