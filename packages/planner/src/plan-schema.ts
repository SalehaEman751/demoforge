import { StepSchema } from "@demoforge/shared";

/**
 * JSON schema of Plan, sent to Ollama as `format` so the model can only produce a plan-shaped object.
 * Kept flat (no $ref, no if/then) because Ollama turns it into a grammar. Per-action required fields and
 * "ids are 1..n" are not expressible there; PlanSchema / validatePlan check those afterwards.
 * The action list comes from StepSchema so the two cannot drift apart.
 */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 25,
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          action: { type: "string", enum: [...StepSchema.innerType().shape.action.options] },
          url: { type: "string" },
          target: {
            type: "object",
            properties: { role: { type: "string" }, name: { type: "string" } },
            required: ["role", "name"],
            additionalProperties: false,
          },
          value: { type: "string" },
          text: { type: "string" },
          ms: { type: "number" },
          caption: { type: "string" },
        },
        required: ["id", "action", "caption"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "steps"],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;
