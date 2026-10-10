import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LaunchInfoSchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";
import { buildBrief, findRoutes, readmeSummary } from "./brief.js";

const base = loadFixture("launch-info.json", LaunchInfoSchema);
const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "inspector-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

describe("routes: Next.js", () => {
  it("scans app/ and skips dynamic segments, route groups become transparent", () => {
    const dir = project({
      "app/page.tsx": "",
      "app/signup/page.tsx": "",
      "app/(marketing)/pricing/page.jsx": "",
      "app/posts/[id]/page.tsx": "",
      "app/@modal/login/page.tsx": "",
      "app/api/route.ts": "",
      "app/layout.tsx": "",
    });
    expect(findRoutes(dir, "next")).toEqual(["/", "/pricing", "/signup"]);
  });

  it("scans pages/ without api, _app, _document or dynamic files", () => {
    const dir = project({
      "pages/index.js": "",
      "pages/about.tsx": "",
      "pages/blog/index.jsx": "",
      "pages/blog/[slug].tsx": "",
      "pages/api/hello.js": "",
      "pages/_app.tsx": "",
      "pages/_document.tsx": "",
    });
    expect(findRoutes(dir, "next")).toEqual(["/", "/about", "/blog"]);
  });

  it("falls back to ['/'] when nothing is found", () => {
    expect(findRoutes(project({ "README.md": "x" }), "next")).toEqual(["/"]);
  });
});

describe("routes: Vite / CRA", () => {
  it("finds <Route path> and createBrowserRouter paths, skipping :params and *", () => {
    const dir = project({
      "src/App.tsx": `<Routes><Route path="/" element={<A/>}/><Route path='/login' element={<B/>}/><Route path="/u/:id" element={<C/>}/><Route path="*" element={<D/>}/></Routes>`,
      "src/router.tsx": `export const r = createBrowserRouter([{ path: "/settings", element: <S/> }, { path: "/p/:id" }]);`,
      "src/other.ts": `const config = { path: "/not-a-route" };`,
    });
    expect(findRoutes(dir, "vite")).toEqual(["/", "/login", "/settings"]);
    expect(findRoutes(dir, "cra")).toEqual(["/", "/login", "/settings"]);
  });

  it("returns ['/'] for unknown frameworks", () => {
    expect(findRoutes(project({ "app/signup/page.tsx": "" }), "unknown")).toEqual(["/"]);
  });
});

describe("readmeSummary", () => {
  it("drops code blocks and badges, collapses whitespace", () => {
    const dir = project({
      "README.md": "# Demo\n\n[![CI](https://x/ci.svg)](https://x)\n![logo](logo.png)\n\nA   small\napp.\n\n```sh\nnpm run dev\n```\n\n    indented code\n\nDone.",
    });
    expect(readmeSummary(dir)).toBe("# Demo A small app. Done.");
  });

  it("truncates to 1500 characters and tolerates a missing README", () => {
    expect(readmeSummary(project({ "README.md": "word ".repeat(1000) }))).toHaveLength(1500);
    expect(readmeSummary(project({}))).toBe("");
  });
});

describe("inspectProject", () => {
  it("builds a schema-valid brief from LaunchInfo and package.json", () => {
    const dir = project({ "package.json": JSON.stringify({ name: "@acme/todo-app" }), "app/page.tsx": "", "README.md": "Hello." });
    const brief = buildBrief({ ...base, projectDir: dir });
    expect(ProjectBriefSchema.parse(brief)).toEqual({ name: "Todo App", framework: "Next.js", routes: ["/"], readmeSummary: "Hello.", startCommand: base.startCommand, port: base.port });
  });

  it("reads the Taskly sample", () => {
    const brief = buildBrief({ ...base, projectDir: fileURLToPath(new URL("../../../samples/taskly", import.meta.url)) });
    expect(brief.routes).toEqual(["/", "/dashboard", "/signup"]);
    expect(brief.framework).toBe("Next.js");
  });

  it("detects the framework from dependencies when LaunchInfo says unknown", () => {
    const dir = project({ "package.json": JSON.stringify({ name: "x", devDependencies: { vite: "^5" } }) });
    expect(buildBrief({ ...base, framework: "unknown", projectDir: dir }).framework).toBe("Vite");
  });
});
