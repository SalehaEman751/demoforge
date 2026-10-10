import type { BrowserContext, Locator, Page } from "playwright-core";

/** How long the outline stays on screen before it fades on its own. */
const HIGHLIGHT_TTL_MS = 1500;
/** How long the outline is shown before the click/fill actually happens, so it is visible in the video. */
export const HIGHLIGHT_LEAD_MS = 400;

const CAPTION_BINDING = "__demoforgeGetCaption";

/**
 * Runs in every new document (context.addInitScript), top frame only. Everything lives in a closed
 * shadow root on a pointer-events:none host appended to <html>, so page CSS can't restyle it, page
 * scripts replacing <body> can't remove it, and it can never intercept a click (Playwright's hit-target
 * check skips pointer-events:none elements too).
 *
 * Plain function, serialised with .toString(): it must not reference anything from this module.
 */
function overlayInit(captionBinding: string, highlightTtlMs: number): void {
  if (window.top !== window) return; // iframes: no overlay
  const w = window as unknown as Record<string, unknown>;
  if (w.__demoforge) return; // already installed in this document

  const host = document.createElement("div");
  host.setAttribute("data-demoforge-overlay", "");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      * { pointer-events: none !important; box-sizing: border-box; }
      .caption {
        position: fixed; left: 0; right: 0; bottom: 0;
        padding: 14px 28px; text-align: center;
        font: 22px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #fff; background: rgba(15, 15, 20, 0.78);
        opacity: 0; transition: opacity 120ms ease-out;
      }
      .caption.on { opacity: 1; }
      .outline {
        position: fixed; display: none; border: 2px solid #ffc83d; border-radius: 6px;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 12px rgba(255, 200, 61, 0.55);
      }
      .ripple {
        position: fixed; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.95); background: rgba(255, 200, 61, 0.35);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
        animation: df-ripple 600ms ease-out forwards;
      }
      @keyframes df-ripple { from { transform: scale(0.2); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
    </style>
    <div class="caption"></div>
    <div class="outline"></div>`;
  const captionEl = root.querySelector(".caption") as HTMLElement;
  const outlineEl = root.querySelector(".outline") as HTMLElement;

  // --- mounting: <html> is not there yet when the init script runs, and pages can wipe it later.
  const mount = (): void => {
    const html = document.documentElement;
    if (html && host.parentNode !== html) html.appendChild(host);
  };
  mount();
  new MutationObserver(mount).observe(document, { childList: true }); // <html> (re)created
  const watchHtml = (): void => {
    if (document.documentElement) new MutationObserver(mount).observe(document.documentElement, { childList: true });
  };
  if (document.documentElement) watchHtml();
  else document.addEventListener("readystatechange", watchHtml, { once: true });

  // --- caption
  const setCaption = (text: unknown): void => {
    const t = typeof text === "string" ? text : "";
    captionEl.textContent = t;
    captionEl.classList.toggle("on", t.length > 0);
    mount();
  };

  // --- highlight outline (follows the element while visible, e.g. during smooth scrolling)
  let target: Element | null = null;
  let hideTimer: number | undefined;
  const place = (): void => {
    if (!target || !target.isConnected) return hide();
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      outlineEl.style.display = "none";
    } else {
      const pad = 3;
      Object.assign(outlineEl.style, {
        display: "block",
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`,
        height: `${r.height + pad * 2}px`,
      });
    }
    requestAnimationFrame(place);
  };
  const hide = (): void => {
    target = null;
    clearTimeout(hideTimer);
    outlineEl.style.display = "none";
  };
  const highlight = (el: unknown): void => {
    if (!(el instanceof Element)) return;
    const wasIdle = target === null;
    target = el;
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, highlightTtlMs);
    if (wasIdle) place();
  };

  // --- click ripple. pointerdown (not click) so it is already on screen when a click navigates away,
  // and capture on window so a page that stops propagation can't hide it.
  window.addEventListener(
    "pointerdown",
    (e) => {
      mount();
      const dot = document.createElement("div");
      dot.className = "ripple";
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
      root.appendChild(dot);
      const remove = (): void => dot.remove();
      dot.addEventListener("animationend", remove, { once: true });
      setTimeout(remove, 1000); // animationend doesn't fire if the tab is throttled
    },
    true,
  );

  Object.defineProperty(window, "__demoforge", { value: { setCaption, highlight }, enumerable: false });

  // --- survive navigation: ask Node for the current caption (it is the source of truth)
  const getCaption = w[captionBinding];
  if (typeof getCaption === "function") {
    (getCaption as () => Promise<string>)().then(setCaption, () => {});
  }
}

type CaptionState = { text: string };
const state = new WeakMap<BrowserContext, CaptionState>();

/**
 * Installs the overlay on every page (and every future document) of `context`.
 * Call once, before the first page is created.
 */
export async function installOverlay(context: BrowserContext): Promise<void> {
  const s: CaptionState = { text: "" };
  state.set(context, s);
  // Order matters: the binding must exist before the init script runs in a new document.
  await context.exposeFunction(CAPTION_BINDING, () => s.text);
  // `__name` shim: esbuild/tsx may inject calls to it into serialised functions (keepNames).
  await context.addInitScript(
    `(function(){var __name=function(f){return f};(${overlayInit.toString()})(${JSON.stringify(CAPTION_BINDING)},${HIGHLIGHT_TTL_MS});})();`,
  );
}

/**
 * Updates the caption on the live page and remembers it so documents loaded later (navigation,
 * reload, a link click) start with the same text. Never throws: a caption must not fail a step.
 */
export async function setCaption(page: Page, text: string): Promise<void> {
  const s = state.get(page.context());
  if (s) s.text = text;
  await page
    .evaluate((t) => (window as unknown as { __demoforge?: { setCaption(t: string): void } }).__demoforge?.setCaption(t), text)
    .catch(() => {}); // about:blank, mid-navigation, closed page: the init script restores it on the next document
}

/**
 * Scrolls `target` into view, outlines it, and waits `leadMs` so the outline is visible before the
 * caller clicks or fills it. Call right before `locator.click()` / `locator.fill()`.
 *
 * A missing element still fails here with Playwright's usual timeout (so the step's error message is
 * the same as if the click had failed); any other error is swallowed because the highlight is cosmetic.
 */
export async function highlight(target: Locator, leadMs = HIGHLIGHT_LEAD_MS): Promise<void> {
  try {
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((el) => (window as unknown as { __demoforge?: { highlight(e: Element): void } }).__demoforge?.highlight(el));
    await target.page().waitForTimeout(leadMs);
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw e;
  }
}
