// Spawned by launch.test.ts. Usage: <source> <port> <local|clone|throw>
import { cp } from "node:fs/promises";
import { launchProject } from "./launch.js";

const [source = "", portArg = "0", mode = "local"] = process.argv.slice(2);

// "clone" mode fakes `git clone` by copying the source folder.
const runGit = async (args: string[]) => {
  await cp(source, args[args.length - 1] as string, { recursive: true });
};

const { info } = await launchProject(
  { source: mode === "clone" ? "https://example.com/o/r.git" : source, port: Number(portArg) },
  { runGit },
);
console.log(`READY ${info.projectDir}`);

if (mode === "throw") {
  setTimeout(() => {
    throw new Error("boom");
  }, 100);
}
setInterval(() => {}, 1000);
