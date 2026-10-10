/* npm run setup:check: one green or red line per prerequisite, with the exact command to fix each red one. */
import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ollamaUrl = (process.env.DEMOFORGE_OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
const model = process.env.DEMOFORGE_MODEL || "qwen2.5:7b-instruct";
const MIN_FREE_GB = 5;
const PORTS = [3000, 3100, 4000];

type Result = { ok: boolean; label: string; detail: string; fix?: string };

const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function checkNode(): Result {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    ok: major >= 20,
    label: "Node 20 or newer",
    detail: `found v${process.versions.node}`,
    fix: "Install Node 20+ (nvm install 20 && nvm use 20, or https://nodejs.org)",
  };
}

function checkCommand(label: string, cmd: string, args: string[], fix: string): Result {
  try {
    return { ok: true, label, detail: run(cmd, args).split(/\r?\n/)[0] ?? "found" }; // \r\n on Windows
  } catch {
    return { ok: false, label, detail: "not found on PATH", fix };
  }
}

function checkChromium(): Result {
  const label = "Playwright chromium";
  const fix = "npm run setup   (or: npx playwright-core install chromium)";
  try {
    const req = createRequire(path.join(root, "packages/runner/package.json"));
    const { chromium } = req("playwright-core") as { chromium: { executablePath: () => string } };
    const exe = chromium.executablePath();
    return existsSync(exe) ? { ok: true, label, detail: exe } : { ok: false, label, detail: "browser not downloaded", fix };
  } catch {
    return { ok: false, label, detail: "playwright-core not installed", fix: "npm install && npm run setup" };
  }
}

async function checkOllama(): Promise<Result[]> {
  const reach = `Ollama reachable at ${ollamaUrl}`;
  const pulled = `Model ${model} pulled`;
  let names: string[];
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { models?: { name?: string }[] };
    names = (body.models ?? []).map((m) => m.name ?? "");
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return [
      { ok: false, label: reach, detail: why, fix: "ollama serve   (install: https://ollama.com/download; or fix DEMOFORGE_OLLAMA_URL)" },
      { ok: false, label: pulled, detail: "cannot check, Ollama is not reachable", fix: `ollama pull ${model}` },
    ];
  }
  const wanted = model.includes(":") ? model : `${model}:latest`;
  const has = names.includes(wanted);
  return [
    { ok: true, label: reach, detail: "ok" },
    { ok: has, label: pulled, detail: has ? "found" : "not pulled", fix: `ollama pull ${model}` },
  ];
}

function portFree(port: number): Promise<Result> {
  const label = `Port ${port} free`;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () =>
      resolve({
        ok: false,
        label,
        detail: "in use",
        fix: `Stop what uses it: lsof -i :${port}   then kill <pid>   (Windows: netstat -ano | findstr :${port})`,
      }),
    );
    server.once("listening", () => server.close(() => resolve({ ok: true, label, detail: "free" })));
    server.listen(port);
  });
}

function checkDisk(): Result {
  const label = `At least ${MIN_FREE_GB} GB free disk`;
  try {
    const s = statfsSync(root);
    const gb = (s.bavail * s.bsize) / 1024 ** 3;
    return {
      ok: gb >= MIN_FREE_GB,
      label,
      detail: `${gb.toFixed(1)} GB free`,
      fix: "Free up space: docker system prune -a; rm -rf ~/.cache/ms-playwright (re-run npm run setup); delete old out/ recordings",
    };
  } catch (e) {
    return { ok: false, label, detail: `could not read disk: ${e instanceof Error ? e.message : e}`, fix: "df -h ." };
  }
}

async function main(): Promise<void> {
  const results: Result[] = [
    checkNode(),
    checkCommand("git", "git", ["--version"], "Install git: https://git-scm.com/downloads (macOS: brew install git, Ubuntu: sudo apt install git)"),
    checkCommand("ffmpeg", "ffmpeg", ["-version"], "Install ffmpeg (macOS: brew install ffmpeg, Ubuntu: sudo apt install ffmpeg, Windows: winget install ffmpeg)"),
    checkChromium(),
    ...(await checkOllama()),
    ...(await Promise.all(PORTS.map(portFree))),
    checkDisk(),
  ];
  const useColor = process.stdout.isTTY || process.env.FORCE_COLOR;
  const paint = (code: number, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
  for (const r of results) {
    console.log(r.ok ? paint(32, `✔ ${r.label}: ${r.detail}`) : paint(31, `✘ ${r.label}: ${r.detail}\n    fix: ${r.fix}`));
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad === 0 ? paint(32, "\nAll checks passed.") : paint(31, `\n${bad} check(s) failed. Run the fix commands above, then npm run setup:check again.`));
  process.exit(bad === 0 ? 0 : 1);
}

void main();
