export { runPlan } from "./runner.js";
export { resolveUrl } from "./actions.js";
// Same signature as runPlan, returns fixtures/run-result.json and never launches a browser.
export { runPlan as runPlanMock } from "./mock.js";

export const PACKAGE_NAME = "@demoforge/runner";
