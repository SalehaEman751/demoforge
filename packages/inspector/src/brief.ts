import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { LaunchInfo, ProjectBrief } from "@demoforge/shared";

const README_MAX_CHARS = 1500;
const MAX_FILES = 2000; // keeps a scan of a huge repo bounded
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage"]);

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

type PackageJson = { name?: unknown; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };

function readPackageJson(dir: string): PackageJson {
  const text = readText(join(dir, "package.json"));
  if (!text) return {};
  try {
    const json: unknown = JSON.parse(text);
    return json && typeof json === "object" ? (json as PackageJson) : {};
  } catch {
    return {};
  }
}

/** "@demoforge/sample-taskly" -> "Sample Taskly"; falls back to the folder name. */
export function projectName(pkg: PackageJson, dir: string): string {
  const raw = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : basename(dir) || "Project";
  return raw
    .replace(/^@[^/]+\//, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** LaunchInfo.framework wins; when it is "unknown", dependencies decide. */
export function frameworkName(info: LaunchInfo, pkg: PackageJson): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const kind = info.framework !== "unknown" ? info.framework : "next" in deps ? "next" : "vite" in deps ? "vite" : "react-scripts" in deps ? "cra" : "unknown";
  return { next: "Next.js", vite: "Vite", cra: "Create React App", unknown: "Unknown" }[kind];
}

/** README.md without code blocks and badges, whitespace collapsed, at most 1500 characters. */
export function readmeSummary(dir: string): string {
  const text = readText(join(dir, "README.md"));
  if (!text) return "";
  const clean = text
    .replace(/```[\s\S]*?(```|$)/g, " ") // fenced code (an unclosed fence runs to the end)
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ") // [![badge](img)](link)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // ![image](url)
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/^(?: {4}|\t).*$/gm, " ") // indented code
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > README_MAX_CHARS ? clean.slice(0, README_MAX_CHARS) : clean;
}

function walk(dir: string, visit: (file: string) => void, budget = { left: MAX_FILES }): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    if (budget.left <= 0) return;
    const full = join(dir, name);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (!SKIP_DIRS.has(name)) walk(full, visit, budget);
    } else {
      budget.left--;
      visit(full);
    }
  }
}

const isDynamic = (route: string): boolean => /\[|:|\*/.test(route);

function normalizeRoute(route: string): string {
  const path = "/" + route.split(/[?#]/)[0]!.replace(/^\/+/, "");
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Next.js App Router: <root>/app/**\/page.(tsx|jsx|js). Route groups "(x)" vanish from the url; "@slot" folders are skipped. */
function appRoutes(root: string): string[] {
  const appDir = join(root, "app");
  const routes: string[] = [];
  if (!existsSync(appDir)) return routes;
  walk(appDir, (file) => {
    if (!/^page\.(tsx|jsx|js)$/.test(basename(file))) return;
    const segments = relative(appDir, join(file, "..")).split(sep).filter(Boolean);
    if (segments.some((s) => s.startsWith("@"))) return;
    routes.push("/" + segments.filter((s) => !/^\(.*\)$/.test(s)).join("/"));
  });
  return routes;
}

/** Next.js Pages Router: <root>/pages/**\/*.(tsx|jsx|js), without api/, _app, _document (and _error). */
function pagesRoutes(root: string): string[] {
  const pagesDir = join(root, "pages");
  const routes: string[] = [];
  if (!existsSync(pagesDir)) return routes;
  walk(pagesDir, (file) => {
    const rel = relative(pagesDir, file).split(sep);
    if (rel[0] === "api") return;
    const m = /^(.+)\.(tsx|jsx|js)$/.exec(rel.join("/"));
    if (!m) return;
    const stem = m[1]!;
    if (/^_(app|document|error)$/.test(stem.split("/").pop()!)) return;
    routes.push("/" + stem.replace(/(^|\/)index$/, ""));
  });
  return routes;
}

/** Vite / CRA: `<Route path="/x">` and `createBrowserRouter([{ path: "/x" }])` in src/. */
function routerRoutes(dir: string): string[] {
  const src = join(dir, "src");
  const routes: string[] = [];
  if (!existsSync(src)) return routes;
  walk(src, (file) => {
    if (!/\.(tsx|jsx|js|ts)$/.test(file) || /\.(test|spec)\./.test(file)) return;
    const text = readText(file);
    if (!text) return;
    for (const m of text.matchAll(/<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/g)) routes.push(m[1]!);
    if (/createBrowserRouter|createHashRouter|createMemoryRouter/.test(text)) {
      for (const m of text.matchAll(/\bpath\s*:\s*["'`]([^"'`]*)["'`]/g)) routes.push(m[1]!);
    }
  });
  return routes;
}

/** Static routes only (dynamic segments excluded), "/" first, then alphabetical. Defaults to ["/"]. */
export function findRoutes(dir: string, framework: LaunchInfo["framework"]): string[] {
  let found: string[] = [];
  if (framework === "next") {
    for (const root of [dir, join(dir, "src")]) found.push(...appRoutes(root), ...pagesRoutes(root));
  } else if (framework === "vite" || framework === "cra") {
    found = routerRoutes(dir);
  }
  const unique = [...new Set(found.map(normalizeRoute))].filter((r) => !isDynamic(r)).sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  return unique.length > 0 ? unique : ["/"];
}

export function buildBrief(info: LaunchInfo): ProjectBrief {
  const pkg = readPackageJson(info.projectDir);
  return {
    name: projectName(pkg, info.projectDir),
    framework: frameworkName(info, pkg),
    routes: findRoutes(info.projectDir, info.framework),
    readmeSummary: readmeSummary(info.projectDir),
    startCommand: info.startCommand,
    port: info.port,
  };
}
