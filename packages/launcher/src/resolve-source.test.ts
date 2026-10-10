import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchError } from "./errors.js";
import { resolveSource, type RunGit } from "./resolve-source.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-test-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeProject(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), "{}");
}

async function exists(p: string) {
  return fs.stat(p).then(() => true, () => false);
}

async function expectNotFound(p: Promise<unknown>, match?: RegExp) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(LaunchError);
  expect((err as LaunchError).code).toBe("NOT_FOUND");
  if (match) expect((err as LaunchError).message).toMatch(match);
}

/** Fake git: creates the destination folder, optionally with a package.json. */
function fakeGit(files: Record<string, string> = { "package.json": "{}" }) {
  const runGit = vi.fn<RunGit>(async (args) => {
    const dest = args[args.length - 1] as string;
    for (const [rel, body] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dest, rel)), { recursive: true });
      await fs.writeFile(path.join(dest, rel), body);
    }
  });
  return runGit;
}

describe("local paths", () => {
  it("resolves an absolute folder with package.json", async () => {
    const dir = path.join(tmp, "app");
    await makeProject(dir);
    const r = await resolveSource({ source: dir });
    expect(r.projectDir).toBe(await fs.realpath(dir));
    expect(r.cloned).toBe(false);
  });

  it("resolves a relative path against the current directory", async () => {
    const dir = path.join(tmp, "app");
    await makeProject(dir);
    const r = await resolveSource({ source: path.relative(process.cwd(), dir) });
    expect(r.projectDir).toBe(await fs.realpath(dir));
  });

  it("cleanup never deletes the user's folder", async () => {
    const dir = path.join(tmp, "app");
    await makeProject(dir);
    const r = await resolveSource({ source: dir });
    await r.cleanup();
    expect(await exists(dir)).toBe(true);
  });

  it("errors when the folder is missing", async () => {
    await expectNotFound(resolveSource({ source: path.join(tmp, "nope") }), /not found/i);
  });

  it("errors when the source is a file, not a folder", async () => {
    const file = path.join(tmp, "file.txt");
    await fs.writeFile(file, "x");
    await expectNotFound(resolveSource({ source: file }));
  });

  it("errors when package.json is missing", async () => {
    await fs.mkdir(path.join(tmp, "empty"));
    await expectNotFound(resolveSource({ source: path.join(tmp, "empty") }), /package\.json/);
  });

  it("errors on an empty source", async () => {
    await expectNotFound(resolveSource({ source: "" }));
  });
});

describe("subdir", () => {
  it("resolves a nested project", async () => {
    await makeProject(path.join(tmp, "mono", "apps", "web"));
    const r = await resolveSource({ source: path.join(tmp, "mono"), subdir: "apps/web" });
    expect(r.projectDir).toBe(await fs.realpath(path.join(tmp, "mono", "apps", "web")));
  });

  it("requires package.json inside the subdir, not just the root", async () => {
    await makeProject(path.join(tmp, "mono"));
    await fs.mkdir(path.join(tmp, "mono", "apps"));
    await expectNotFound(
      resolveSource({ source: path.join(tmp, "mono"), subdir: "apps" }),
      /package\.json/,
    );
  });

  it("errors when the subdir is missing", async () => {
    await makeProject(path.join(tmp, "mono"));
    await expectNotFound(resolveSource({ source: path.join(tmp, "mono"), subdir: "nope" }));
  });

  it("rejects ../ traversal", async () => {
    await makeProject(path.join(tmp, "mono"));
    await makeProject(path.join(tmp, "other"));
    await expectNotFound(resolveSource({ source: path.join(tmp, "mono"), subdir: "../other" }));
  });

  it("rejects an absolute subdir", async () => {
    await makeProject(path.join(tmp, "mono"));
    await makeProject(path.join(tmp, "other"));
    await expectNotFound(
      resolveSource({ source: path.join(tmp, "mono"), subdir: path.join(tmp, "other") }),
    );
  });

  it("rejects a symlink that points outside the source", async () => {
    await makeProject(path.join(tmp, "mono"));
    await makeProject(path.join(tmp, "outside"));
    // Windows needs admin rights or Developer Mode for a symlink; a directory junction needs neither and
    // fs.realpath resolves it the same way, so the check under test is the same.
    await fs.symlink(path.join(tmp, "outside"), path.join(tmp, "mono", "link"), process.platform === "win32" ? "junction" : "dir");
    await expectNotFound(resolveSource({ source: path.join(tmp, "mono"), subdir: "link" }));
  });
});

describe("rejected URL schemes", () => {
  const bad = [
    "file:///etc/passwd",
    "file://localhost/tmp/repo",
    "ssh://git@github.com/o/r.git",
    "ext::sh -c touch% /tmp/pwned",
    "EXT::sh -c id",
    "http://github.com/o/r.git",
    "git://github.com/o/r.git",
    "ftp://example.com/r.git",
    "HTTPS://github.com/o/r.git",
  ];

  it.each(bad)("%s -> NOT_FOUND, git never runs", async (source) => {
    const runGit = fakeGit();
    await expectNotFound(resolveSource({ source }, { runGit }));
    expect(runGit).not.toHaveBeenCalled();
  });

  it.each(["https://", "https://exa mple.com/r.git", "git@github.com", "git@host:o/r.git --upload-pack=x"])(
    "malformed %s -> NOT_FOUND, git never runs",
    async (source) => {
      const runGit = fakeGit();
      await expectNotFound(resolveSource({ source }, { runGit }));
      expect(runGit).not.toHaveBeenCalled();
    },
  );
});

describe("git clone", () => {
  it("shallow-clones an https URL into tmpdir/demoforge-<id>", async () => {
    const runGit = fakeGit();
    const url = "https://github.com/o/r.git";
    const r = await resolveSource({ source: url }, { runGit });

    expect(runGit).toHaveBeenCalledTimes(1);
    const args = runGit.mock.calls[0]![0];
    expect(args.slice(0, 3)).toEqual(["clone", "--depth", "1"]);
    expect(args).toContain("--");
    expect(args[args.length - 2]).toBe(url);

    const dest = args[args.length - 1]!;
    expect(path.dirname(dest)).toBe(os.tmpdir());
    expect(path.basename(dest)).toMatch(/^demoforge-.+/);
    expect(r.cloned).toBe(true);
    expect(r.projectDir).toBe(await fs.realpath(dest));

    await r.cleanup();
    expect(await exists(dest)).toBe(false);
  });

  it("accepts git@ URLs", async () => {
    const runGit = fakeGit();
    const r = await resolveSource({ source: "git@github.com:o/r.git" }, { runGit });
    expect(runGit.mock.calls[0]![0]).toContain("git@github.com:o/r.git");
    await r.cleanup();
  });

  it("uses a different folder for each clone", async () => {
    const runGit = fakeGit();
    const a = await resolveSource({ source: "https://github.com/o/r.git" }, { runGit });
    const b = await resolveSource({ source: "https://github.com/o/r.git" }, { runGit });
    expect(a.projectDir).not.toBe(b.projectDir);
    await a.cleanup();
    await b.cleanup();
  });

  it("supports subdir inside a clone", async () => {
    const runGit = fakeGit({ "apps/web/package.json": "{}" });
    const r = await resolveSource({ source: "https://github.com/o/r.git", subdir: "apps/web" }, { runGit });
    expect(r.projectDir.endsWith(path.join("apps", "web"))).toBe(true);
    await r.cleanup();
  });

  it("NOT_FOUND and removes the clone when package.json is missing", async () => {
    const runGit = fakeGit({ "README.md": "hi" });
    await expectNotFound(resolveSource({ source: "https://github.com/o/r.git" }, { runGit }), /package\.json/);
    const dest = runGit.mock.calls[0]![0].at(-1)!;
    expect(await exists(dest)).toBe(false);
  });

  it("NOT_FOUND and removes the clone when the subdir is missing", async () => {
    const runGit = fakeGit();
    await expectNotFound(
      resolveSource({ source: "https://github.com/o/r.git", subdir: "nope" }, { runGit }),
    );
    expect(await exists(runGit.mock.calls[0]![0].at(-1)!)).toBe(false);
  });

  it("CLONE_FAILED and removes the partial folder when git fails", async () => {
    let dest = "";
    const runGit: RunGit = async (args) => {
      dest = args.at(-1)!;
      await fs.mkdir(dest, { recursive: true });
      throw new Error("fatal: repository not found");
    };
    const err = await resolveSource({ source: "https://github.com/o/r.git" }, { runGit }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("CLONE_FAILED");
    expect((err as LaunchError).message).toMatch(/repository not found/);
    expect(await exists(dest)).toBe(false);
  });
});
