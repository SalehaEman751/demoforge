export { inspectProject } from "./inspect.js";
export { buildBrief, findRoutes, readmeSummary } from "./brief.js";
// Fixture-backed version with the same signature (no project folder needed).
export { inspectProject as inspectProjectMock } from "./mock.js";

export const PACKAGE_NAME = "@demoforge/inspector";
