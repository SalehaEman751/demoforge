import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { highlight, installOverlay, setCaption } from "./overlay.js";

const PAGES: Record<string, string> = {
  "/": `<!doctype html><body style="margin:0"><a id="l" href="/two">next</a>
    <button id="b" style="position:fixed;left:20px;bottom:4px;height:30px" onclick="document.title='clicked'">Under caption</button>
    </body>`,
  // wipes <body> after load, like a framework re-render would
  "/two": `<!doctype html><body><h1>two</h1><script>document.body.replaceWith(document.createElement('body'))</script></body>`,
};

describe("overlay (real chromium)", () => {
  let server: Server;
  let base: string;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    server = createServer((req, res) => res.setHeader("content-type", "text/html").end(PAGES[req.url ?? "/"] ?? "404"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await installOverlay(context);
    page = await context.newPage();
  });
  afterAll(async () => {
    await browser.close();
    server.close();
  });

  const bar = () => page.screenshot({ clip: { x: 0, y: 680, width: 1280, height: 40 } });
  // The caption fades (opacity transition, 120ms), so a screenshot taken right after setCaption can catch it
  // half-way. Wait for the animation to finish instead of comparing instantly.
  const settle = { timeout: 3000, intervals: [50, 100, 150] };
  /** Polls until the bar matches (or stops matching) `ref`. */
  const barEquals = (ref: Buffer, expected: boolean) =>
    expect.poll(async () => (await bar()).equals(ref), settle).toBe(expected);
  /** Polls until two consecutive screenshots are identical, i.e. the fade has finished. */
  const stableBar = async (): Promise<Buffer> => {
    let prev = await bar();
    await expect
      .poll(async () => {
        const cur = await bar();
        const same = cur.equals(prev);
        prev = cur;
        return same;
      }, settle)
      .toBe(true);
    return prev;
  };
  const host = () =>
    page.evaluate(() => {
      const h = document.querySelector("[data-demoforge-overlay]") as HTMLElement | null;
      return h ? { pe: getComputedStyle(h).pointerEvents, parent: h.parentElement?.tagName } : null;
    });

  it("mounts a pointer-events:none host on <html>", async () => {
    await page.goto(base + "/");
    expect(await host()).toEqual({ pe: "none", parent: "HTML" });
  });

  it("shows the caption and hides it when empty", async () => {
    await setCaption(page, "");
    const empty = await stableBar();
    await setCaption(page, "Hello");
    const shown = await stableBar(); // waits out the fade-in
    expect(shown.equals(empty)).toBe(false);
    await setCaption(page, "");
    await barEquals(empty, true); // waits out the fade-out
  });

  it("never blocks clicks, even on an element under the caption bar", async () => {
    await setCaption(page, "Covering the button");
    await highlight(page.locator("#b"), 50);
    await page.locator("#b").click({ timeout: 3000 }); // would time out on "intercepts pointer events"
    expect(await page.title()).toBe("clicked");
  });

  it("keeps the caption across navigation, even if the page replaces <body>", async () => {
    // Reference: the bottom bar of the destination page with no caption (the two pages differ below the fold line).
    await setCaption(page, "");
    await page.goto(base + "/two");
    const empty = await stableBar();
    await page.goto(base + "/");
    await setCaption(page, "Navigating");
    await page.click("#l");
    await page.waitForURL("**/two");
    expect(await host()).not.toBeNull();
    await barEquals(empty, false); // caption restore is async (round-trip to Node) and then fades in
    await setCaption(page, "");
    await barEquals(empty, true); // and it really was the caption that was visible
  });

  it("highlight fails with a timeout when the target is missing", async () => {
    page.setDefaultTimeout(500);
    await expect(highlight(page.locator("#nope"), 0)).rejects.toThrow(/Timeout/);
  });
});
