import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

/** Reads fixtures/<name> from the repo root and validates it with `schema`. */
export function loadFixture<S extends z.ZodTypeAny>(name: string, schema: S): z.output<S> {
  const url = new URL(`../../../fixtures/${name}`, import.meta.url);
  return schema.parse(JSON.parse(readFileSync(fileURLToPath(url), "utf8")));
}
