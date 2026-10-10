export { planDemo, PlanError, type PlanLogEntry } from "./plan-demo.js";
export { validatePlan } from "./validate.js";
export { CHAT_TIMEOUT_MS, OllamaError, chatJson, chatJsonRaw, health, warmUp, type ChatMessage, type PlannerErrorCode } from "./ollama.js";
export { PLAN_JSON_SCHEMA } from "./plan-schema.js";
// Fixture-backed versions with the same signatures (no Ollama needed).
export { planDemo as planDemoMock, validatePlan as validatePlanMock } from "./mock.js";

export const PACKAGE_NAME = "@demoforge/planner";
