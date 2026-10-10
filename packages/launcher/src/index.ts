export { launchProject, type LaunchOptions } from "./launch.js";
// Fixture-backed version with the same signature (no install, no server).
export { launchProject as launchProjectMock } from "./mock.js";
export { LaunchError, type LaunchErrorCode } from "./errors.js";
export { resolveSource, type ResolvedSource, type RunGit } from "./resolve-source.js";
export { detectProject, type Detected } from "./detect.js";
export { validateStartCommand } from "./command.js";
export { classifyStartFailure, findBackendPort, type StartFailure } from "./classify.js";

export const PACKAGE_NAME = "@demoforge/launcher";
