#!/usr/bin/env node
/**
 * npm run demo:web
 *
 * Starts the API with USE_MOCKS=1 (port 4000) and the web dev server (port 3000) together,
 * prefixes each one's output, and stops both on Ctrl+C or when either one exits.
 * Plain Node (no extra dependency), so it works the same on macOS, Linux and Windows.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const isWin = process.platform === "win32";
const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000";

const services = [
  { name: "api", cmd: "npm run start -w @demoforge/api", env: { USE_MOCKS: "1" } },
  { name: "web", cmd: "npm run dev -w @demoforge/web", env: {} },
];

const children = [];
let stopping = false;

/** Kill a child and everything it started (npm starts node, which starts the server). */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM"); // negative pid = the child's whole process group
  } catch {
    // Already gone.
  }
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) killTree(c);
  // Give the servers a moment to close, then leave with the right exit code.
  setTimeout(() => process.exit(code), 500).unref();
}

function pipeLines(stream, name, out) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => {
    if (rest) out.write(`[${name}] ${rest}\n`);
  });
}

console.log(`DemoForge demo (mock data)\n  web  ${WEB_URL}\n  api  ${API_URL}  (USE_MOCKS=1)\nPress Ctrl+C to stop both.\n`);

for (const s of services) {
  const child = spawn(s.cmd, {
    cwd: root,
    shell: true, // finds npm on every platform; the command is a fixed string
    detached: !isWin, // own process group on macOS/Linux, so killTree can reach the whole tree
    env: { ...process.env, ...s.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  pipeLines(child.stdout, s.name, process.stdout);
  pipeLines(child.stderr, s.name, process.stderr);
  child.on("error", (err) => {
    console.error(`[${s.name}] could not start: ${err.message}`);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[${s.name}] stopped (${signal ?? `exit code ${code}`}). Stopping the other one too.`);
    stopAll(code ?? 1);
  });
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stopAll(0));
process.on("exit", () => {
  for (const c of children) killTree(c);
});
