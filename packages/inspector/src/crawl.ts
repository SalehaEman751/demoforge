import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ElementInventory } from "@demoforge/shared";
import { collectElements, collectLinkHrefs } from "./page-inventory.js";

type InventoryPage = ElementInventory["pages"][number];

export const MAX_PAGES = 8;
export const MAX_ELEMENTS_PER_PAGE = 40;
export const MAX_ELEMENTS_TOTAL = 150;
export const PAGE_TIMEOUT_MS = 10_000;
const SETTLE_MS = 300; // client-side redirects (router.replace in an effect) land just after "load"
const NOT_A_PAGE = /\.(pdf|png|jpe?g|gif|svg|webp|ico|zip|css|js|json|xml|txt|mp4|webm)$/i;

/** Demo values for the sign-up / login probe (E3-5). */
export const PROBE_VALUES = { name: "Demo User", email: "demo@example.com", password: "Demo1234!" } as const;
export const PROBE_TIMEOUT_MS = 20_000;
const SUBMIT_NAME = /sign ?up|create (an )?account|register|log ?in|sign ?in|get started|continue|submit/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CrawlOptions = {
  baseUrl: string;
  /** Routes from the brief (static ones only; any with a dynamic segment are ignored here too). */
  routes: string[];
  log?: (message: string) => void;
  /**
   * E3-5: when a route redirects to a page with a sign-up or login form, fill it once with PROBE_VALUES, submit,
   * then re-visit the routes that redirected. Browser-only: requests other than GET/HEAD/OPTIONS are blocked meanwhile.
   */
  allowAuthProbe?: boolean;
};

/** "/a/b/?x=1#y" -> "/a/b"; "/" stays "/". */
function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

const isDynamic = (route: string): boolean => /\[|:|\*/.test(route);

/** Never throws for a page problem: those return null after logging. Only a missing browser is fatal. */
async function visit(
  context: BrowserContext,
  origin: string,
  path: string,
  remaining: { left: number },
  log: (m: string) => void,
  search = "",
): Promise<{ page: InventoryPage; links: string[] } | null> {
  const page = await context.newPage();
  const work = (async () => {
    // `search` is the base URL's query (e.g. ?variant=renamed), carried onto every page we open.
    const response = await page.goto(origin + path + search, { timeout: PAGE_TIMEOUT_MS, waitUntil: "load" });
    if (response && response.status() >= 400) {
      log(`skipped ${path}: the server answered HTTP ${response.status()}`);
      return null;
    }
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const final = new URL(page.url());
    if (final.origin !== origin) {
      log(`skipped ${path}: it redirected off the site to ${final.origin}`);
      return null;
    }
    const landedOn = normalizePath(final.pathname);
    const title = await page.title();
    if (landedOn !== path) {
      // Its own elements are unknown; the landing page's elements belong to the landing page's entry.
      return { page: { url: path, title, redirectedTo: landedOn, elements: [] }, links: [] };
    }

    const all = await collectElements(page, (m) => log(`warning: ${m}`), path);
    const room = Math.max(0, Math.min(MAX_ELEMENTS_PER_PAGE, remaining.left));
    if (all.length > room) log(`${path}: kept ${room} of ${all.length} elements (caps: ${MAX_ELEMENTS_PER_PAGE} per page, ${MAX_ELEMENTS_TOTAL} total)`);
    const elements = all.slice(0, room);
    remaining.left -= elements.length;
    return { page: { url: path, title, elements }, links: await collectLinkHrefs(page) };
  })();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`took longer than ${PAGE_TIMEOUT_MS / 1000}s`)), PAGE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } catch (e) {
    log(`skipped ${path}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    return null;
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => {});
  }
}

const firstVisible = async (pages: ReturnType<Page["getByRole"]>): Promise<ReturnType<Page["getByRole"]> | null> => {
  const n = await pages.count();
  for (let i = 0; i < n; i++) if (await pages.nth(i).isVisible().catch(() => false)) return pages.nth(i);
  return null;
};

/**
 * Opens `landing` and, if it has a sign-up or login form, fills it with PROBE_VALUES (by role and label only) and
 * submits it once. Returns a warning when there is nothing to fill; throws only for browser errors (caught by crawl).
 */
async function signUpOnce(context: BrowserContext, origin: string, landing: string, search: string): Promise<string | null> {
  const page = await context.newPage();
  try {
    await page.goto(origin + landing + search, { timeout: PAGE_TIMEOUT_MS, waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const passwords = page.getByLabel(/password/i);
    const passwordCount = await passwords.count();
    const email = await firstVisible(page.getByRole("textbox", { name: /e-?mail/i }));
    const user = email ? null : await firstVisible(page.getByRole("textbox", { name: /user ?name|login/i }));
    if (passwordCount === 0 || (!email && !user)) {
      return `no sign-up or login form on ${landing} (needs a password field and an email or username box)`;
    }
    const name = await firstVisible(page.getByRole("textbox", { name: /^(full |your )?name$/i }));
    if (name) await name.fill(PROBE_VALUES.name);
    if (email) await email.fill(PROBE_VALUES.email);
    if (user) await user.fill(PROBE_VALUES.email);
    for (let i = 0; i < passwordCount; i++) {
      const field = passwords.nth(i);
      if (await field.isEditable().catch(() => false)) await field.fill(PROBE_VALUES.password); // also "Confirm password"
    }
    const submit = await firstVisible(page.getByRole("button", { name: SUBMIT_NAME }));
    if (submit) await submit.click();
    else await passwords.last().press("Enter");

    await page
      .waitForURL((u) => normalizePath(new URL(u).pathname) !== landing, { timeout: 5000 })
      .catch(() => {}); // an app may stay on the page; the re-visit decides whether it worked
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Visits "/" and each static route, then same-origin links found on those pages (depth 1), at most 8 pages in all.
 * Stays on the baseUrl origin (cross-origin navigations are aborted), and a page that fails is skipped and logged.
 */
export async function crawl({ baseUrl, routes, log = () => {}, allowAuthProbe = false }: CrawlOptions): Promise<ElementInventory> {
  const origin = new URL(baseUrl).origin;
  const search = new URL(baseUrl).search;
  const first = [...new Set(["/", ...routes.filter((r) => !isDynamic(r)).map((r) => normalizePath(r.split(/[?#]/)[0]!))])].slice(0, MAX_PAGES);
  const planned = new Set(first);
  const pages: InventoryPage[] = [];
  const remaining = { left: MAX_ELEMENTS_TOTAL };

  let browser: Browser;
  try {
    // Loaded on first use so importing the package (index.ts, the mock) never requires Playwright (E11-1).
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    throw new Error(`Could not start Chromium for the inspector: run npx playwright install chromium (${(e as Error).message.split("\n")[0]})`);
  }
  try {
    const context = await browser.newContext();
    // Never leave the site: a page navigation to another origin is aborted, including one reached through a redirect chain.
    // (Chromium follows redirects of a continued request without asking us again, so each navigation is fetched here first.)
    const probing = { on: false, blocked: [] as string[] };
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (probing.on && !SAFE_METHODS.has(req.method())) {
        // The probe must not write to the app's backend: only the temporary browser context changes.
        probing.blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return route.abort();
      }
      if (!req.isNavigationRequest()) return route.continue();
      if (new URL(req.url()).origin !== origin) return route.abort();
      try {
        const first = await route.fetch({ maxRedirects: 0 });
        let res = first;
        let at = req.url();
        for (let hops = 0; res.status() >= 300 && res.status() < 400 && res.headers()["location"]; hops++) {
          at = new URL(res.headers()["location"]!, at).href;
          if (hops >= 10 || new URL(at).origin !== origin) return route.abort();
          res = await route.fetch({ url: at, maxRedirects: 0 });
        }
        return route.fulfill({ response: first });
      } catch {
        return route.abort();
      }
    });

    const discovered: string[] = [];
    for (const path of first) {
      const result = await visit(context, origin, path, remaining, log, search);
      if (!result) continue;
      pages.push(result.page);
      for (const href of result.links) {
        let url: URL;
        try {
          url = new URL(href);
        } catch {
          continue;
        }
        if (!/^https?:$/.test(url.protocol) || url.origin !== origin || NOT_A_PAGE.test(url.pathname)) continue;
        const linked = normalizePath(url.pathname);
        if (isDynamic(linked) || planned.has(linked)) continue;
        planned.add(linked);
        discovered.push(linked);
      }
    }

    // The 8-page limit counts every page we try, so a page that failed still uses up its slot.
    for (const path of discovered.slice(0, Math.max(0, MAX_PAGES - first.length))) {
      const result = await visit(context, origin, path, remaining, log, search);
      if (result) pages.push(result.page);
    }

    const redirected = pages.filter((p) => p.redirectedTo);
    if (allowAuthProbe && redirected.length > 0) {
      await probeBehindLogin({ context, origin, search, pages, redirected, remaining, log, probing });
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { pages };
}

/**
 * E3-5, tried at most once: sign up on the page the first redirect landed on, then re-visit every route that
 * redirected and replace its entry with the page's real elements (tagged with the final path).
 * Never throws: on any problem the inventory is kept as it is and a warning is logged.
 */
async function probeBehindLogin(args: {
  context: BrowserContext;
  origin: string;
  search: string;
  pages: InventoryPage[];
  redirected: InventoryPage[];
  remaining: { left: number };
  log: (m: string) => void;
  probing: { on: boolean; blocked: string[] };
}): Promise<void> {
  const { context, origin, search, pages, redirected, remaining, log, probing } = args;
  const landing = redirected[0]!.redirectedTo!;
  probing.on = true;
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`took longer than ${PROBE_TIMEOUT_MS / 1000}s`)), PROBE_TIMEOUT_MS);
    });
    const problem = await Promise.race([signUpOnce(context, origin, landing, search), deadline]);
    if (problem) {
      log(`warning: auth probe skipped: ${problem}`);
      return;
    }
    let unlocked = 0;
    for (const entry of redirected) {
      const result = await Promise.race([visit(context, origin, entry.url, remaining, () => {}, search), deadline]);
      if (!result || result.page.redirectedTo) continue;
      pages[pages.indexOf(entry)] = result.page; // url is the final path; redirectedTo is gone
      unlocked++;
    }
    if (unlocked === 0) {
      log(`warning: auth probe: signed up on ${landing} with demo values, but ${redirected.map((p) => p.url).join(", ")} still redirect`);
    } else {
      log(`auth probe: signed up on ${landing} with demo values; inventoried ${unlocked} page(s) behind it`);
    }
  } catch (e) {
    log(`warning: auth probe failed on ${landing}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  } finally {
    clearTimeout(timer);
    probing.on = false;
    if (probing.blocked.length > 0) {
      log(`warning: auth probe blocked ${probing.blocked.length} write request(s) (${[...new Set(probing.blocked)].slice(0, 3).join(", ")}); this app may need a backend to sign up`);
    }
  }
}
