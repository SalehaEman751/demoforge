import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ElementInventorySchema } from "@demoforge/shared";
import { crawl, MAX_ELEMENTS_PER_PAGE, MAX_ELEMENTS_TOTAL, MAX_PAGES } from "./crawl.js";
import { parseAriaSnapshot } from "./page-inventory.js";

const html = (body: string, title = "T"): string => `<!doctype html><title>${title}</title><body>${body}</body>`;
const buttons = (n: number, prefix: string): string => Array.from({ length: n }, (_, i) => `<button>${prefix} ${i}</button>`).join("");

let site: Server;
let other: Server;
let base: string;
let otherBase: string;
let otherHits = 0;
const posts: string[] = []; // write requests that reached the test server

/** A page that sends visitors without the localStorage key `key` to `to` (a client redirect, like Taskly). */
const guarded = (key: string, to: string, body: string): string =>
  `<script>if (!localStorage.getItem(${JSON.stringify(key)})) location.replace(${JSON.stringify(to)})</script>${body}`;

const listen = (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> =>
  new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
const urlOf = (s: Server): string => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

beforeAll(async () => {
  other = await listen((_req, res) => {
    otherHits++;
    res.end(html("<button>Elsewhere</button>"));
  });
  otherBase = urlOf(other);
  site = await listen((req, res) => {
    const path = new URL(req.url!, "http://x").pathname;
    const send = (body: string, title?: string): void => {
      res.setHeader("content-type", "text/html");
      res.end(html(body, title));
    };
    if (req.method !== "GET" && req.method !== "HEAD") posts.push(`${req.method} ${path}`);
    switch (path) {
      // E3-5 auth probe fixtures
      case "/members":
        return send(guarded("member", "/join", `<h1>Members</h1><label>New note <input></label><button>Save note</button>`), "Members");
      case "/join":
        return send(
          `<form id="f"><label>Name <input id="n"></label><label>Email <input type="email" id="e"></label>
           <label>Password <input type="password" id="p"></label><button type="submit">Sign up</button></form>
           <script>document.getElementById("f").addEventListener("submit", (ev) => { ev.preventDefault();
             const ok = document.getElementById("n").value === "Demo User" && document.getElementById("e").value === "demo@example.com"
               && document.getElementById("p").value === "Demo1234!";
             if (ok) { localStorage.setItem("member", "1"); location.href = "/members"; } });</script>`,
          "Join",
        );
      case "/vault":
        return send(guarded("vault", "/vault-login", `<button>Open vault</button>`), "Vault");
      case "/vault-login": // the form never accepts anyone
        return send(
          `<form id="f"><label>Email <input type="email"></label><label>Password <input type="password"></label>
           <button type="submit">Log in</button><p role="alert" hidden id="a">Wrong password</p></form>
           <script>document.getElementById("f").addEventListener("submit", (ev) => { ev.preventDefault(); document.getElementById("a").hidden = false; });</script>`,
          "Vault login",
        );
      case "/locked":
        return send(guarded("locked", "/no-form", `<button>Locked</button>`), "Locked");
      case "/no-form":
        return send(`<p>Ask an admin for access.</p><a href="/">Home</a>`, "No form");
      case "/api-area":
        return send(guarded("api", "/api-join", `<button>API area</button>`), "API area");
      case "/api-join": // signs up through the backend: the probe must not let the POST through
        return send(
          `<form id="f"><label>Email <input type="email"></label><label>Password <input type="password"></label><button type="submit">Create account</button></form>
           <script>document.getElementById("f").addEventListener("submit", async (ev) => { ev.preventDefault();
             try { const r = await fetch("/api/signup", { method: "POST", body: "{}" }); if (r.ok) { localStorage.setItem("api", "1"); location.href = "/api-area"; } } catch {} });</script>`,
          "API join",
        );
      case "/api/signup":
        return send("{}");
      case "/":
        return send(
          `<a href="/a">Alpha</a><a href="/redir">Moved</a><a href="/boom">Boom</a><a href="/gone">Gone</a>
           <a href="${otherBase}/x">External</a><a href="/file.pdf">Doc</a><a href="mailto:a@b.c">Mail</a>
           ${Array.from({ length: 12 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join("")}`,
          "Home",
        );
      case "/a":
        return send(
          `<button>Save</button><button>Save</button><button style="display:none">Invisible</button><button aria-hidden="true">Hidden</button><button></button>
           <label>Email <input type="email" placeholder="you@example.com"></label><label><input type="checkbox"> Remember me</label>
           <label>Plan <select><option>Free</option></select></label><label>Password <input type="password"></label><a href="/sub">Deeper</a>`,
          "Alpha",
        );
      case "/redir":
        res.writeHead(302, { location: "/a" }).end();
        return;
      case "/client-redirect":
        return send(`<script>setTimeout(() => location.replace("/a"), 50)</script>`);
      case "/offsite":
        res.writeHead(302, { location: otherBase + "/x" }).end();
        return;
      case "/hop":
        res.writeHead(302, { location: "/hop2" }).end();
        return;
      case "/hop2":
        res.writeHead(302, { location: otherBase + "/x" }).end();
        return;
      case "/boom":
        req.socket.destroy();
        return;
      case "/many1":
      case "/many2":
      case "/many3":
      case "/many4":
        return send(buttons(60, path.slice(1)));
      case "/sub":
        return send("<button>Too deep</button>");
      default:
        if (/^\/p\d+$/.test(path)) return send(`<button>${path}</button>`);
        res.writeHead(404).end("nope");
    }
  });
  base = urlOf(site);
});

afterAll(() => {
  site.close();
  other.close();
});

const run = async (routes: string[], allowAuthProbe = false) => {
  const log: string[] = [];
  const inventory = await crawl({ baseUrl: base, routes, log: (m) => log.push(m), allowAuthProbe });
  return { inventory, log, page: (url: string) => inventory.pages.find((p) => p.url === url) };
};

describe("parseAriaSnapshot", () => {
  it("keeps the five interactive roles with names, drops the rest", () => {
    const snap = [`- heading "Hi" [level=1]`, `- link "Home":`, `  - /url: /`, `- button "Go"`, `- button`, `- textbox "Email"`, `- checkbox "Remember" [checked]`, `- combobox "Plan"`, `- listitem: x`, `- button "Say \\"hi\\""`].join("\n");
    expect(parseAriaSnapshot(snap)).toEqual([
      { role: "link", name: "Home" },
      { role: "button", name: "Go" },
      { role: "textbox", name: "Email" },
      { role: "checkbox", name: "Remember" },
      { role: "combobox", name: "Plan" },
      { role: "button", name: 'Say "hi"' },
    ]);
  });
});

describe("crawl: one page (E3-2)", () => {
  it("collects roles, names and placeholders; skips hidden and unnamed; keeps and logs duplicates", async () => {
    const { inventory, log, page } = await run(["/a"]);
    expect(ElementInventorySchema.safeParse(inventory).success).toBe(true);
    const a = page("/a")!;
    expect(a.title).toBe("Alpha");
    expect(a.elements).toEqual([
      { role: "button", name: "Save" },
      { role: "button", name: "Save" },
      { role: "textbox", name: "Email", placeholder: "you@example.com" },
      { role: "checkbox", name: "Remember me" },
      { role: "combobox", name: "Plan" },
      { role: "textbox", name: "Password" },
      { role: "link", name: "Deeper" },
    ]);
    expect(log.filter((m) => m.startsWith("warning:") && m.includes('button "Save"') && m.includes("/a"))).toHaveLength(1);
  }, 60_000);
});

describe("crawl: many pages (E3-3)", () => {
  it("visits / plus routes, then depth-1 links, at most 8 pages, never leaving the origin", async () => {
    otherHits = 0;
    const { inventory } = await run(["/a"]);
    const urls = inventory.pages.map((p) => p.url);
    expect(urls.length).toBeLessThanOrEqual(MAX_PAGES);
    expect(urls.slice(0, 2)).toEqual(["/", "/a"]);
    expect(urls).not.toContain("/sub"); // depth 2
    expect(urls).not.toContain("/file.pdf");
    expect(otherHits).toBe(0);
    expect(inventory.pages.every((p) => !p.url.startsWith("http"))).toBe(true);
  }, 60_000);

  it("sets redirectedTo for server and client redirects, and refuses a redirect off the site", async () => {
    otherHits = 0;
    const { page, log } = await run(["/redir", "/client-redirect", "/offsite", "/hop"]);
    expect(page("/redir")).toMatchObject({ redirectedTo: "/a", elements: [] });
    expect(page("/client-redirect")).toMatchObject({ redirectedTo: "/a", elements: [] });
    expect(page("/offsite")).toBeUndefined();
    expect(page("/hop")).toBeUndefined(); // same-origin first hop, off-site second hop
    expect(log.some((m) => m.includes("skipped /offsite"))).toBe(true);
    expect(otherHits).toBe(0);
  }, 60_000);

  it("skips pages that fail (dropped connection, 404) and keeps going", async () => {
    const { page, log } = await run(["/boom", "/gone", "/a"]);
    expect(page("/boom")).toBeUndefined();
    expect(page("/gone")).toBeUndefined();
    expect(page("/a")).toBeDefined();
    expect(log.some((m) => m.startsWith("skipped /boom"))).toBe(true);
    expect(log.some((m) => m.includes("skipped /gone") && m.includes("404"))).toBe(true);
  }, 60_000);

  it("caps elements at 40 per page and 150 in total", async () => {
    const { inventory, log } = await run(["/many1", "/many2", "/many3", "/many4"]);
    expect(inventory.pages.every((p) => p.elements.length <= MAX_ELEMENTS_PER_PAGE)).toBe(true);
    expect(inventory.pages.reduce((n, p) => n + p.elements.length, 0)).toBeLessThanOrEqual(MAX_ELEMENTS_TOTAL);
    expect(inventory.pages.find((p) => p.url === "/many1")!.elements).toHaveLength(MAX_ELEMENTS_PER_PAGE);
    expect(log.some((m) => m.includes("kept"))).toBe(true);
  }, 60_000);
});

describe("crawl: pages behind a sign-up redirect (E3-5)", () => {
  it("signs up once with demo values and inventories the page behind the redirect, tagged with its own path", async () => {
    otherHits = 0;
    const { page, log, inventory } = await run(["/members"], true);
    expect(page("/members")).toMatchObject({ url: "/members", title: "Members" });
    expect(page("/members")!.redirectedTo).toBeUndefined();
    expect(page("/members")!.elements).toEqual(
      expect.arrayContaining([{ role: "textbox", name: "New note" }, { role: "button", name: "Save note" }]),
    );
    expect(log).toContain("auth probe: signed up on /join with demo values; inventoried 1 page(s) behind it");
    expect(ElementInventorySchema.safeParse(inventory).success).toBe(true);
    expect(otherHits).toBe(0); // the origin guard still applies
  }, 60_000);

  it("does nothing when allowAuthProbe is false", async () => {
    const { page, log } = await run(["/members"], false);
    expect(page("/members")).toMatchObject({ redirectedTo: "/join", elements: [] });
    expect(log.some((m) => m.includes("auth probe"))).toBe(false);
  }, 60_000);

  it("a sign-up that does not work leaves the redirect and returns a warning, never throws", async () => {
    const vault = await run(["/vault"], true);
    expect(vault.page("/vault")).toMatchObject({ redirectedTo: "/vault-login", elements: [] });
    // "/" also links to /redir (a permanent redirect in this test site), so the message may list it too
    expect(vault.log.some((m) => m.startsWith("warning: auth probe: signed up on /vault-login with demo values, but /vault"))).toBe(true);

    const noForm = await run(["/locked"], true);
    expect(noForm.page("/locked")).toMatchObject({ redirectedTo: "/no-form", elements: [] });
    expect(noForm.log.some((m) => m.startsWith("warning: auth probe skipped: no sign-up or login form on /no-form"))).toBe(true);
  }, 60_000);

  it("never writes to the backend: a sign-up POST is blocked and reported", async () => {
    posts.length = 0;
    const { page, log } = await run(["/api-area"], true);
    expect(posts).toEqual([]);
    expect(page("/api-area")).toMatchObject({ redirectedTo: "/api-join" });
    expect(log.some((m) => m.startsWith("warning: auth probe blocked 1 write request(s) (POST /api/signup)"))).toBe(true);
  }, 60_000);

  it("carries the base URL's query onto every page it opens", async () => {
    const seen: string[] = [];
    const s = await listen((req, res) => {
      seen.push(req.url!);
      res.setHeader("content-type", "text/html");
      res.end(html(`<button>Hi</button>`));
    });
    try {
      await crawl({ baseUrl: `${urlOf(s)}/?variant=renamed`, routes: ["/a"] });
    } finally {
      s.close();
    }
    expect(seen.filter((u) => !u.includes("favicon"))).toEqual(["/?variant=renamed", "/a?variant=renamed"]);
  }, 60_000);
});
