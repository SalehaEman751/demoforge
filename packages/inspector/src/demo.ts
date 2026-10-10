import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LaunchInfoSchema, loadFixture } from "@demoforge/shared";
import { inspectProject } from "./index.js";

// Usage: npm run demo:inspector -w @demoforge/inspector [projectDir]   (default: the Taskly sample)
const fixture = loadFixture("launch-info.json", LaunchInfoSchema);
// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/..." and turns spaces into %20.
const projectDir = resolve(process.argv[2] ?? fileURLToPath(new URL("../../../samples/taskly", import.meta.url)));
console.log(JSON.stringify(await inspectProject({ info: { ...fixture, projectDir } }), null, 2));
