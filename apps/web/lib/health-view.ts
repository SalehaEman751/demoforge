import type { Health, HealthItem } from "./api";

/** The red items, in the order the API sent them. */
export const problems = (health: Health | undefined): HealthItem[] => health?.items.filter((i) => !i.ok) ?? [];

/**
 * The commands inside a fix text. The API joins steps with ", then " (for example
 * "ollama serve, then ollama pull qwen2.5:7b-instruct"); each one is shown, and copied, on its own.
 */
export const fixCommands = (fix: string | undefined): string[] =>
  (fix ?? "")
    .split(/,?\s+then\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);

/** Shown when GET /api/health itself fails, i.e. the API is not running. */
export const API_DOWN_FIX = "npm run dev";

/** Words for the banner and the form warning. In mock mode red checks do not stop a demo, so the tone is calmer. */
export function warningCopy(count: number, mocks: boolean): { heading: string; body: string; form: string } {
  const things = count === 1 ? "One thing needs fixing" : `${count} things need fixing`;
  return mocks
    ? {
        heading: `${things} before a real run`,
        body: "The API is running with mock data (USE_MOCKS=1), so demos still work now. Fix these before using a real project.",
        form: "A setup check failed, but the API is using mock data, so this demo will still run.",
      }
    : {
        heading: `${things} before demos will work`,
        body: "You can still submit the form, but the demo is likely to fail until this is fixed.",
        form: "A setup check failed (see the warning above). You can still generate a demo, but it may fail.",
      };
}
