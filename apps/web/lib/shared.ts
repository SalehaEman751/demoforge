/**
 * Types come from the package root; they are erased at build time.
 * The Zod schemas are imported from the schemas file directly because the package root
 * also re-exports load-fixture.ts, which needs node:fs and cannot be bundled for the browser.
 */
export type { Job, JobEvent, Plan, Metrics } from "@demoforge/shared";
export { JobSchema, JobEventSchema } from "@demoforge/shared/src/schemas";
