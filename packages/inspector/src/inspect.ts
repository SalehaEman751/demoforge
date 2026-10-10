import type { InspectProjectFn } from "@demoforge/shared";
import { buildBrief } from "./brief.js";
import { crawl } from "./crawl.js";

/**
 * Brief (E3-1) from the project folder, inventory (E3-2, E3-3) from a headless crawl of info.baseUrl;
 * with allowAuthProbe, pages behind a sign-up / login redirect too (E3-5).
 * `onLog` gets one line per skipped page, warning and cap hit; it defaults to console.warn.
 */
export async function inspectProject({ info, allowAuthProbe, onLog }: Parameters<InspectProjectFn>[0] & { onLog?: (message: string) => void }) {
  const log = onLog ?? ((m: string) => console.warn(`[inspector] ${m}`));
  const brief = buildBrief(info);
  const inventory = await crawl({ baseUrl: info.baseUrl, routes: brief.routes, log, allowAuthProbe: allowAuthProbe === true });
  return { brief, inventory };
}
inspectProject satisfies InspectProjectFn;
