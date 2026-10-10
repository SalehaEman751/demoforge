import { parseArgs } from "node:util";

export type Args = { runs: number; source: string; instructions: string; api: string; variant?: "renamed"; dry: boolean; timeoutSec: number };

export const USAGE =
  'npm run eval -- --runs 10 --source samples/taskly --instructions "Show how a user signs up and adds a task" [--api http://localhost:4000] [--variant renamed] [--dry] [--timeout 900]';

/** Throws an Error with a plain message on bad input. */
export function parseCli(argv: string[]): Args {
  const { values } = parseArgs({
    args: argv,
    options: {
      runs: { type: "string" },
      source: { type: "string" },
      instructions: { type: "string" },
      api: { type: "string" },
      variant: { type: "string" },
      dry: { type: "boolean" },
      timeout: { type: "string" },
    },
    strict: true,
  });

  const runs = values.runs === undefined ? 10 : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number of at least 1 (got "${values.runs}")`);
  const timeoutSec = values.timeout === undefined ? 900 : Number(values.timeout);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) throw new Error(`--timeout must be a positive number of seconds (got "${values.timeout}")`);
  if (values.variant !== undefined && values.variant !== "renamed") throw new Error(`--variant only supports "renamed" (got "${values.variant}")`);

  const api = values.api ?? "http://localhost:4000";
  try {
    new URL(api);
  } catch {
    throw new Error(`--api must be a URL such as http://localhost:4000 (got "${api}")`);
  }

  const dry = values.dry === true;
  const source = values.source ?? (dry ? "samples/taskly" : undefined);
  const instructions = values.instructions ?? (dry ? "Show how a user signs up and adds a task" : undefined);
  if (!source) throw new Error("--source is required");
  if (!instructions) throw new Error("--instructions is required");

  return { runs, source, instructions, api, ...(values.variant ? { variant: "renamed" as const } : {}), dry, timeoutSec };
}

/** Adds ?variant=renamed (or &variant=renamed) to the source string, which is how the flag is passed to the API. */
export function applyVariant(source: string, variant?: "renamed"): string {
  if (!variant) return source;
  return source + (source.includes("?") ? "&" : "?") + `variant=${variant}`;
}
