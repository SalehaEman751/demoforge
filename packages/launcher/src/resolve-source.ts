import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { LaunchError } from "./errors.js";

const ArgsSchema = z.object({
  source: z.string().min(1, "source is empty"),
  subdir: z.string().min(1).optional(),
});

export type ResolvedSource = {
  /** Absolute (real) path of the folder that holds package.json. */
  projectDir: string;
  /** Absolute (real) path of the source root: the clone folder, or the local folder before `subdir`. */
  rootDir: string;
  /** True when the source was a Git URL cloned into os.tmpdir(). */
  cloned: boolean;
  /** Deletes the temp clone. No-op for local paths (never touches the user's folder). */
  cleanup: () => Promise<void>;
};

/** Runs `git <args>`. Injectable so tests never touch the network. */
export type RunGit = (args: string[]) => Promise<void>;

const execFileAsync = promisify(execFile);

const defaultRunGit: RunGit = async (args) => {
  await execFileAsync("git", args, {
    timeout: 120_000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      // Blocks ext::, file:// etc. even if git is redirected or follows submodules.
      GIT_ALLOW_PROTOCOL: "https:ssh",
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    },
  });
};

// scp-like form only: git@host:owner/repo(.git)
const GIT_SSH_RE = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/;
// "scheme://..." or git transport helpers like "ext::..."
const OTHER_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*(?::\/\/|::)/;

type Kind = "git" | "local";

function classify(source: string): Kind {
  if (source.startsWith("https://")) {
    let ok = false;
    try {
      const url = new URL(source);
      ok = url.protocol === "https:" && url.hostname !== "" && !/\s/.test(source);
    } catch {
      ok = false;
    }
    if (!ok) throw new LaunchError("NOT_FOUND", `That is not a valid https URL: ${source}. Check the address, or pass a local folder path instead.`);
    return "git";
  }
  if (source.startsWith("git@")) {
    if (!GIT_SSH_RE.test(source)) {
      throw new LaunchError("NOT_FOUND", `That is not a valid git@ address: ${source}. Use the form git@host:owner/repo.git, an https URL, or a local folder path.`);
    }
    return "git";
  }
  // file://, ssh://, http://, git://, ext::sh -c ... and any other scheme.
  if (OTHER_SCHEME_RE.test(source)) {
    throw new LaunchError(
      "NOT_FOUND",
      `Unsupported address: ${source}. Only https:// URLs, git@host:owner/repo addresses and local folders are accepted.`,
    );
  }
  return "local";
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function locateProject(
  root: string,
  subdir?: string,
): Promise<{ projectDir: string; rootDir: string }> {
  if (!(await isDir(root))) {
    throw new LaunchError("NOT_FOUND", `Folder not found: ${root}. Check the path and try again.`);
  }
  const realRoot = await fs.realpath(root);
  let projectDir = realRoot;

  if (subdir !== undefined) {
    if (path.isAbsolute(subdir)) {
      throw new LaunchError("NOT_FOUND", `subdir must be a path inside the project, like apps/web, not ${subdir}. Pass a relative folder name.`);
    }
    const candidate = path.resolve(realRoot, subdir);
    if (!isInside(realRoot, candidate) || !(await isDir(candidate))) {
      throw new LaunchError("NOT_FOUND", `Subdirectory not found in the project: ${subdir}. Check the folder name and try again.`);
    }
    // realpath again so a symlink inside the repo cannot point outside it.
    projectDir = await fs.realpath(candidate);
    if (!isInside(realRoot, projectDir)) {
      throw new LaunchError("NOT_FOUND", `Subdirectory not found in the project: ${subdir}. Check the folder name and try again.`);
    }
  }

  if (!(await isFile(path.join(projectDir, "package.json")))) {
    throw new LaunchError("NOT_FOUND", `package.json not found in ${projectDir}. DemoForge runs Node web projects; point it at the folder that contains package.json (use subdir for a monorepo).`);
  }
  return { projectDir, rootDir: realRoot };
}

export async function resolveSource(
  args: { source: string; subdir?: string },
  deps: { runGit?: RunGit } = {},
): Promise<ResolvedSource> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    throw new LaunchError("NOT_FOUND", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { source, subdir } = parsed.data;

  if (classify(source) === "local") {
    const { projectDir, rootDir } = await locateProject(path.resolve(source), subdir);
    return { projectDir, rootDir, cloned: false, cleanup: async () => {} };
  }

  const dest = path.join(os.tmpdir(), `demoforge-${randomUUID()}`);
  const cleanup = () => fs.rm(dest, { recursive: true, force: true });
  const runGit = deps.runGit ?? defaultRunGit;

  try {
    await runGit(["clone", "--depth", "1", "--", source, dest]);
  } catch (err) {
    await cleanup();
    const detail = err instanceof Error ? err.message.split("\n").slice(0, 3).join(" ") : String(err);
    throw new LaunchError("CLONE_FAILED", `Could not download ${source} (${detail}). Check the address, that the repository is public (or that you have access), and your internet connection.`);
  }

  try {
    const { projectDir, rootDir } = await locateProject(dest, subdir);
    return { projectDir, rootDir, cloned: true, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
