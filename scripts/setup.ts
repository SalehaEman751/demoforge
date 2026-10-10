/* npm run setup: install the Playwright chromium browser and pull the Ollama model. */
import { spawnSync } from "node:child_process";

const model = process.env.DEMOFORGE_MODEL || "qwen2.5:7b-instruct";
const shell = process.platform === "win32";

function step(title: string, cmd: string, args: string[]): void {
  console.log(`\n==> ${title}\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}${r.error ? ` (${r.error.message})` : ""}`);
    if (cmd === "ollama") console.error("Is Ollama installed and running? Install: https://ollama.com/download, then run: ollama serve");
    process.exit(r.status ?? 1);
  }
}

step("Installing Playwright chromium", "npx", ["playwright-core", "install", "chromium"]);
step(`Pulling Ollama model ${model}`, "ollama", ["pull", model]);
console.log("\nDone. Run npm run setup:check to verify.");
