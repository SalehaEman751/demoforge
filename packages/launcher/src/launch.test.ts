import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LaunchError } from "./errors.js";
import { launchProject } from "./launch.js";
import { isPortInUse } from "./starter.js";

const T = 40_000;
let tmp: string;
const stops: Array<() => Promise<void>> = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "launch-test-"));
});
afterEach(async () => {
  await Promise.all(stops.splice(0).map((s) => s()));
  await rm(tmp, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);

/** Server that writes its pid to pid.txt and answers `reply` (503 until `warmupMs` has passed). */
const SERVER = (reply = "hello from app", warmupMs = 0) => `
const http = require("http");
require("fs").writeFileSync("pid.txt", String(process.pid));
const t0 = Date.now();
console.log("server-boot-marker");
http.createServer((req, res) => {
  if (Date.now() - t0 < ${warmupMs}) { res.statusCode = 503; return res.end("warming up"); }
  res.end(${JSON.stringify(reply)});
}).listen(process.env.PORT);
`;

async function makeApp(
  dir: string,
  opts: { pkg?: object; server?: string } = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture-app", version: "1.0.0", scripts: { dev: "node server.js" }, ...opts.pkg }),
  );
  await writeFile(path.join(dir, "server.js"), opts.server ?? SERVER());
  return dir;
}

async function launch(args: Parameters<typeof launchProject>[0], opts?: Parameters<typeof launchProject>[1]) {
  const r = await launchProject(args, opts);
  stops.push(r.stop);
  return r;
}

async function failure(p: Promise<unknown>): Promise<LaunchError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(LaunchError);
  return err as LaunchError;
}

describe("happy path", () => {
  it("installs, starts with PORT set, waits for HTTP 200, returns LaunchInfo", async () => {
    const dir = await makeApp(path.join(tmp, "app"));
    const port = await freePort();
    const lines: string[] = [];
    const { info, stop } = await launch({ source: dir, port }, { onLog: (l) => lines.push(l) });

    expect(info).toMatchObject({
      baseUrl: `http://localhost:${port}`,
      projectDir: await (await import("node:fs/promises")).realpath(dir),
      framework: "unknown",
      packageManager: "npm",
      startCommand: "npm run dev",
      port,
      envVarsRequired: [],
    });
    const res = await fetch(info.baseUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from app");
    expect(lines).toContain("server-boot-marker"); // logs captured
    expect(lines.some((l) => l.startsWith("$ npm install"))).toBe(true);

    await stop();
    expect(await isPortInUse(port)).toBe(false);
  }, T);

  it("honours an explicit startCommand and reports envVarsRequired", async () => {
    const dir = await makeApp(path.join(tmp, "app"), { pkg: { scripts: { serve: "node server.js" } } });
    await writeFile(path.join(dir, ".env.example"), "SECRET_THING_FOR_TEST=1\n");
    const port = await freePort();
    const { info } = await launch({ source: dir, port, startCommand: "npm run serve" });
    expect(info.startCommand).toBe("npm run serve");
    expect(info.envVarsRequired).toEqual(["SECRET_THING_FOR_TEST"]);
  }, T);

  it("keeps polling past 503s until the app answers 200", async () => {
    const dir = await makeApp(path.join(tmp, "app"), { server: SERVER("ready now", 1500) });
    const { info } = await launch({ source: dir, port: await freePort() });
    expect(await (await fetch(info.baseUrl)).text()).toBe("ready now");
  }, T);

  it("supports subdir", async () => {
    await makeApp(path.join(tmp, "mono", "apps", "web"));
    const port = await freePort();
    const { info } = await launch({ source: path.join(tmp, "mono"), subdir: "apps/web", port });
    expect(info.projectDir.endsWith(path.join("apps", "web"))).toBe(true);
  }, T);
});

describe("failures", () => {
  it("PORT_IN_USE: never attaches to someone else's server, never installs", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      pkg: { scripts: { dev: "node server.js", preinstall: `node -e "require('fs').writeFileSync('marker','x')"` } },
    });
    const port = await freePort();
    const squatter = net.createServer((s) => {
      s.on("error", () => {}); // the probe connects and hangs up
      s.end("HTTP/1.1 200 OK\r\n\r\nsquatter");
    });
    await new Promise<void>((r) => squatter.listen(port, "127.0.0.1", r));
    try {
      const err = await failure(launchProject({ source: dir, port }));
      expect(err.code).toBe("PORT_IN_USE");
      expect(await exists(path.join(dir, "marker"))).toBe(false);
    } finally {
      await new Promise((r) => squatter.close(r));
    }
  }, T);

  it("INSTALL_FAILED on a non-zero install exit, with output in the message", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      pkg: { scripts: { dev: "node server.js", postinstall: `node -e "console.error('install-boom');process.exit(2)"` } },
    });
    const port = await freePort();
    const err = await failure(launchProject({ source: dir, port }));
    expect(err.code).toBe("INSTALL_FAILED");
    expect(err.message).toMatch(/install-boom/);
    expect(await isPortInUse(port)).toBe(false); // never got as far as starting
  }, T);

  it("INSTALL_FAILED on timeout and kills the install", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      pkg: { scripts: { dev: "node server.js", install: `node -e "setInterval(()=>{},1000)"` } },
    });
    const t0 = Date.now();
    const err = await failure(
      launchProject({ source: dir, port: await freePort() }, { timeouts: { installMs: 1500 } }),
    );
    expect(err.code).toBe("INSTALL_FAILED");
    expect(err.message).toMatch(/timed out/);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, T);

  it("START_FAILED when the dev server exits early, with its output", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      pkg: { scripts: { dev: `node -e "console.error('boom-marker');process.exit(3)"` } },
    });
    const err = await failure(launchProject({ source: dir, port: await freePort() }));
    expect(err.code).toBe("START_FAILED");
    expect(err.message).toMatch(/exited with 3/);
    expect(err.message).toMatch(/boom-marker/);
  }, T);

  it("START_TIMEOUT when nothing answers, and the process is killed", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      server: `require("fs").writeFileSync("pid.txt", String(process.pid)); setInterval(()=>{},1000);`,
    });
    const err = await failure(
      launchProject({ source: dir, port: await freePort() }, { timeouts: { readyMs: 1500 } }),
    );
    expect(err.code).toBe("START_TIMEOUT");
    const pid = Number(await readFile(path.join(dir, "pid.txt"), "utf8"));
    expect(alive(pid)).toBe(false);
  }, T);

  it("START_TIMEOUT when the app answers 200 with an empty body", async () => {
    const dir = await makeApp(path.join(tmp, "app"), { server: SERVER("") });
    const err = await failure(
      launchProject({ source: dir, port: await freePort() }, { timeouts: { readyMs: 2000 } }),
    );
    expect(err.code).toBe("START_TIMEOUT");
  }, T);

  it("INVALID_ARGS for a bad port, NO_START_SCRIPT without a script", async () => {
    const dir = await makeApp(path.join(tmp, "app"), { pkg: { scripts: {} } });
    expect((await failure(launchProject({ source: dir, port: 99999 }))).code).toBe("INVALID_ARGS");
    expect((await failure(launchProject({ source: dir, port: await freePort() }))).code).toBe(
      "NO_START_SCRIPT",
    );
  }, T);
});

describe("classified start failures", () => {
  /** Server whose every request needs a backend on `deadPort`, which nobody listens on. */
  const NEEDS_BACKEND_SERVER = (deadPort: number) => `
const http = require("http");
http.createServer((req, res) => {
  http.get({ host: "127.0.0.1", port: ${deadPort}, path: "/api" }, () => res.end("ok")).on("error", (e) => {
    console.error("Error: " + e.message);   // connect ECONNREFUSED 127.0.0.1:${deadPort}
    res.statusCode = 500;
    res.end("backend is down");
  });
}).listen(process.env.PORT);
`;

  it("NEEDS_BACKEND: repeated connection-refused to another localhost port, reported without waiting out the timeout", async () => {
    const deadPort = await freePort();
    const dir = await makeApp(path.join(tmp, "app"), { server: NEEDS_BACKEND_SERVER(deadPort) });
    const port = await freePort();
    const t0 = Date.now();
    const err = await failure(launchProject({ source: dir, port }, { timeouts: { readyMs: 30_000 } }));
    expect(err.code).toBe("NEEDS_BACKEND");
    expect(err.message).toMatch(new RegExp(`localhost:${deadPort}`));
    expect(err.message).toMatch(/Start that service first/);
    expect(Date.now() - t0).toBeLessThan(20_000); // far below readyMs: it did not wait for a timeout
    expect(await isPortInUse(port)).toBe(false); // and the app was stopped
  }, T);

  it("NEEDS_BACKEND also when the app exits because of the missing backend", async () => {
    const deadPort = await freePort();
    const dir = await makeApp(path.join(tmp, "app"), {
      server: `for (let i = 0; i < 3; i++) console.error("Error: connect ECONNREFUSED 127.0.0.1:${deadPort}"); process.exit(1);`,
    });
    const err = await failure(launchProject({ source: dir, port: await freePort() }));
    expect(err.code).toBe("NEEDS_BACKEND");
  }, T);

  it("refusals to the app's own port are not a missing backend", async () => {
    const port = await freePort();
    const dir = await makeApp(path.join(tmp, "app"), {
      server: `for (let i = 0; i < 5; i++) console.error("Error: connect ECONNREFUSED 127.0.0.1:${port}"); process.exit(1);`,
    });
    expect((await failure(launchProject({ source: dir, port }))).code).toBe("START_FAILED");
  }, T);

  it("MISSING_ENV: the app exits and .env.example lists a variable that is not set", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      server: `console.error("Error: SESSION_SECRET_FOR_TEST is required"); process.exit(1);`,
    });
    await writeFile(path.join(dir, ".env.example"), "SESSION_SECRET_FOR_TEST=changeme\nOTHER_KEY_FOR_TEST=\n");
    const err = await failure(launchProject({ source: dir, port: await freePort() }, { env: {} }));
    expect(err.code).toBe("MISSING_ENV");
    expect(err.message).toMatch(/SESSION_SECRET_FOR_TEST, OTHER_KEY_FOR_TEST/);
    expect(err.message).toMatch(/SESSION_SECRET_FOR_TEST is required/); // the app's own output is included
  }, T);

  it("MISSING_ENV also when the app never answers", async () => {
    const dir = await makeApp(path.join(tmp, "app"), { server: "setInterval(() => {}, 1000);" });
    await writeFile(path.join(dir, ".env.example"), "NEVER_SET_FOR_TEST=1\n");
    const err = await failure(
      launchProject({ source: dir, port: await freePort() }, { env: {}, timeouts: { readyMs: 1500 } }),
    );
    expect(err.code).toBe("MISSING_ENV");
  }, T);

  it("a launch that works is not blamed on .env.example variables", async () => {
    const dir = await makeApp(path.join(tmp, "app"));
    await writeFile(path.join(dir, ".env.example"), "OPTIONAL_THING_FOR_TEST=1\n");
    const { info } = await launch({ source: dir, port: await freePort() }, { env: {} });
    expect(info.envVarsRequired).toEqual(["OPTIONAL_THING_FOR_TEST"]);
  }, T);

  it("variables that are set do not turn a crash into MISSING_ENV", async () => {
    const dir = await makeApp(path.join(tmp, "app"), { server: "process.exit(1);" });
    await writeFile(path.join(dir, ".env.example"), "IS_SET_FOR_TEST=1\n");
    const err = await failure(
      launchProject({ source: dir, port: await freePort() }, { env: { IS_SET_FOR_TEST: "yes" } }),
    );
    expect(err.code).toBe("START_FAILED");
  }, T);

  it("install output never counts as backend evidence", async () => {
    const dir = await makeApp(path.join(tmp, "app"), {
      pkg: {
        scripts: {
          dev: "node server.js",
          postinstall: `node -e "for(let i=0;i<5;i++)console.log('connect ECONNREFUSED 127.0.0.1:4999')"`,
        },
      },
      server: "process.exit(1);",
    });
    expect((await failure(launchProject({ source: dir, port: await freePort() }))).code).toBe("START_FAILED");
  }, T);
});

describe("stop()", () => {
  it("kills the whole process tree (sh -> npm -> sh -> node)", async () => {
    const dir = await makeApp(path.join(tmp, "app"));
    const { info, stop } = await launch({ source: dir, port: await freePort() });
    const pid = Number(await readFile(path.join(dir, "pid.txt"), "utf8"));
    expect(alive(pid)).toBe(true);
    await stop();
    expect(alive(pid)).toBe(false);
    expect(await isPortInUse(info.port)).toBe(false);
  }, T);

  it("is idempotent and leaves a local folder alone", async () => {
    const dir = await makeApp(path.join(tmp, "app"));
    const { stop } = await launch({ source: dir, port: await freePort() });
    await stop();
    await stop();
    expect(await exists(path.join(dir, "package.json"))).toBe(true);
  }, T);

  it("deletes the temp clone", async () => {
    const src = await makeApp(path.join(tmp, "src"));
    const runGit = async (args: string[]) => {
      await cp(src, args[args.length - 1] as string, { recursive: true });
    };
    const { info, stop } = await launch(
      { source: "https://example.com/o/r.git", port: await freePort() },
      { runGit },
    );
    expect(path.basename(info.projectDir)).toMatch(/^demoforge-/);
    expect(path.dirname(info.projectDir)).toBe(await (await import("node:fs/promises")).realpath(os.tmpdir()));
    expect(await exists(info.projectDir)).toBe(true);
    await stop();
    expect(await exists(info.projectDir)).toBe(false);
  }, T);

  it("deletes the temp clone when the launch fails", async () => {
    const src = await makeApp(path.join(tmp, "src"), { pkg: { scripts: { dev: `node -e "process.exit(1)"` } } });
    let dest = "";
    const runGit = async (args: string[]) => {
      dest = args[args.length - 1] as string;
      await cp(src, dest, { recursive: true });
    };
    const err = await failure(
      launchProject({ source: "https://example.com/o/r.git", port: await freePort() }, { runGit }),
    );
    expect(err.code).toBe("START_FAILED");
    expect(await exists(dest)).toBe(false);
  }, T);
});

describe("cleanup when the host process dies", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const fixture = path.join(repoRoot, "packages/launcher/src/signal-child.fixture.ts");

  async function runChild(mode: "local" | "clone" | "throw", kill?: NodeJS.Signals) {
    const src = await makeApp(path.join(tmp, "src"));
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", "tsx", fixture, src, String(port), mode], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    const ready = new Promise<string>((resolve, reject) => {
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        const m = /READY (.+)\n/.exec(out);
        if (m?.[1]) resolve(m[1]);
      });
      child.once("exit", () => reject(new Error(`child exited before READY: ${out}`)));
    });
    const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));

    const projectDir = await ready;
    const pid = Number(await readFile(path.join(projectDir, "pid.txt"), "utf8"));
    expect(alive(pid)).toBe(true);
    expect(await isPortInUse(port)).toBe(true);
    if (kill) child.kill(kill);
    const code = await exited;
    await sleep(100);
    return { code, pid, port, projectDir };
  }

  // On Windows there are no POSIX signals: child.kill("SIGTERM"/"SIGINT") ends the process at once, so no handler can
  // run and no exit code 143/130 exists. (Ctrl+C typed in a Windows terminal does reach Node as SIGINT; that is not
  // something a test can send.) The uncaught-exception test below still covers the cleanup path on Windows.
  const posixOnly = process.platform === "win32" ? it.skip : it;

  posixOnly("SIGTERM: stops the server, exit code 143", async () => {
    const r = await runChild("local", "SIGTERM");
    expect(r.code).toBe(143);
    expect(alive(r.pid)).toBe(false);
    expect(await isPortInUse(r.port)).toBe(false);
  }, T);

  posixOnly("SIGINT: stops the server and deletes the clone, exit code 130", async () => {
    const r = await runChild("clone", "SIGINT");
    expect(r.code).toBe(130);
    expect(alive(r.pid)).toBe(false);
    expect(await isPortInUse(r.port)).toBe(false);
    expect(await exists(r.projectDir)).toBe(false);
  }, T);

  it("uncaught exception: stops the server, exit code 1", async () => {
    const r = await runChild("throw");
    expect(r.code).toBe(1);
    expect(alive(r.pid)).toBe(false);
    expect(await isPortInUse(r.port)).toBe(false);
  }, T);
});
