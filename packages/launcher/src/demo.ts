import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LaunchError } from "./errors.js";
import { launchProject } from "./launch.js";

// Real launch: install, start, wait for HTTP 200, print LaunchInfo, then keep the app running until Ctrl+C.
// Usage (from the repo root):
//   npm run demo:launcher -- <path-or-git-url> [--subdir apps/web] [--port 3100] [--start-command "npm run dev"]
// For compatibility, `<source> [subdir] [port]` positionals still work.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    subdir: { type: "string" },
    port: { type: "string" },
    "start-command": { type: "string" },
  },
});

// `npm run -w` starts the script inside packages/launcher, so a relative path typed at the repo root
// would point at the wrong folder. npm records where the user actually was in INIT_CWD.
const URL_LIKE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|git@|[A-Za-z][A-Za-z0-9+.-]*::)/;
const typed = positionals[0];
const source =
  typed === undefined
    ? path.join(repoRoot, "samples/taskly")
    : URL_LIKE.test(typed)
      ? typed
      : path.resolve(process.env.INIT_CWD ?? process.cwd(), typed);
const subdir = values.subdir ?? positionals[1] ?? undefined;
const portText = values.port ?? positionals[2];
const port = portText ? Number(portText) : undefined;

let launched;
try {
  launched = await launchProject(
    { source, subdir, port, startCommand: values["start-command"] },
    { onLog: (line) => console.error(`  | ${line}`) },
  );
} catch (err) {
  if (err instanceof LaunchError) {
    console.error(`\nLaunch failed [${err.code}]\n${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

console.log(JSON.stringify(launched.info, null, 2));
console.error(`\nApp is running at ${launched.info.baseUrl}. Press Ctrl+C to stop it.`);

// The launcher kills the app (and deletes a temp clone) on Ctrl+C / SIGTERM, then exits 130 / 143.
const announce = () => console.error("\nStopping...");
process.once("SIGINT", announce);
process.once("SIGTERM", announce);
process.once("exit", () => console.error("Stopped."));

// Keep the process alive even if the app dies on its own.
setInterval(() => {}, 1 << 30);
