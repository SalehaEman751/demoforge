import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateStartCommand } from "./command.js";
import { detectProject } from "./detect.js";
import { LaunchError } from "./errors.js";
import { launchProject } from "./launch.js";

let tmp: string;
let dir: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "command-test-"));
  dir = path.join(tmp, "app");
  await fs.mkdir(dir);
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      scripts: {
        dev: "node server.js",
        "dev:web": "node server.js",
        "build-all": "x",
        start_prod: "x",
        "v1.2": "x",
        // If the launcher ever ran an install, this would leave a marker behind.
        preinstall: `node -e "require('fs').writeFileSync('install-ran','x')"`,
      },
    }),
  );
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function outcome(startCommand: string) {
  const r = await detectProject({ projectDir: dir, startCommand }).then(
    (d) => ({ ok: d.startCommand }),
    (e: unknown) => ({ err: e }),
  );
  if ("err" in r) {
    expect(r.err).toBeInstanceOf(LaunchError);
    return { code: (r.err as LaunchError).code, message: (r.err as LaunchError).message };
  }
  return { accepted: r.ok };
}

describe("accepted overrides: npm|yarn|pnpm run <existing script>", () => {
  it.each([
    ["npm run dev", "npm run dev"],
    ["yarn run dev", "yarn run dev"],
    ["pnpm run dev", "pnpm run dev"],
    ["npm run dev:web", "npm run dev:web"],
    ["npm run build-all", "npm run build-all"],
    ["pnpm run start_prod", "pnpm run start_prod"],
    ["npm run v1.2", "npm run v1.2"],
    ["  npm run dev  ", "npm run dev"], // surrounding spaces are trimmed
  ])("%j", async (input, expected) => {
    expect(await outcome(input)).toEqual({ accepted: expected });
  });
});

describe("rejected overrides: wrong form or shell characters -> INVALID_ARGS", () => {
  it.each([
    // shell metacharacters
    "npm run dev; touch pwned",
    "npm run dev && echo hi",
    "npm run dev || echo hi",
    "npm run dev | cat",
    "npm run dev & echo hi",
    "npm run dev `id`",
    "npm run $(id)",
    "npm run dev $HOME",
    "npm run dev > out.txt",
    "npm run dev < in.txt",
    'npm run "dev"',
    "npm run 'dev'",
    "npm run dev\nrm -rf /",
    "npm run dev\r\nrm -rf /",
    "npm run dev\trm",
    "npm run d*v",
    "npm run dev#x",
    "npm run dev\\x",
    "npm run dev%PATH%",
    // not the accepted form
    "npm run dev -- -p 3000",
    "npm run dev --port 3000",
    "npm run --prefix /tmp dev",
    "npm run -s dev",
    "npm run ../dev",
    "npm run  dev", // two spaces
    "npm dev",
    "npm start",
    "npm test",
    "yarn dev",
    "pnpm dev",
    "npx next dev",
    "node server.js",
    "NPM run dev",
    "npm run",
    "npm run ",
    "bun run dev",
    "sh -c dev",
    "",
    "   ",
  ])("%j", async (cmd) => {
    const r = await outcome(cmd);
    expect(r).toMatchObject({ code: "INVALID_ARGS" });
    // The message says what to do instead.
    expect((r as { message: string }).message).toMatch(/npm run <script>/);
  });
});

describe("rejected overrides: script missing -> NO_START_SCRIPT", () => {
  it("unknown script, and lists the real ones", async () => {
    const r = await outcome("npm run nope");
    expect(r).toMatchObject({ code: "NO_START_SCRIPT" });
    expect((r as { message: string }).message).toMatch(/no script named "nope"/);
    expect((r as { message: string }).message).toMatch(/dev, dev:web/);
  });

  it.each(["constructor", "toString", "hasOwnProperty"])(
    "inherited object keys do not count as scripts: %s",
    async (name) => {
      expect(await outcome(`npm run ${name}`)).toMatchObject({ code: "NO_START_SCRIPT" });
    },
  );

  it("a project with no scripts at all", () => {
    expect(() => validateStartCommand("npm run dev", undefined)).toThrow(/no scripts at all/);
    expect(() => validateStartCommand("npm run dev", {})).toThrow(LaunchError);
  });
});

describe("rejection happens before anything runs", () => {
  const exists = (p: string) => fs.stat(p).then(() => true, () => false);

  it("a command with shell injection is refused without install, start or side effects", async () => {
    const err = await launchProject({
      source: dir,
      port: 45123,
      startCommand: "npm run dev; node -e \"require('fs').writeFileSync('pwned','x')\"",
    }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("INVALID_ARGS");
    expect(await exists(path.join(dir, "pwned"))).toBe(false);
    expect(await exists(path.join(dir, "install-ran"))).toBe(false); // no `npm install` either
    expect(await exists(path.join(dir, "package-lock.json"))).toBe(false);
  });

  it("an unknown script is refused without install or start", async () => {
    const err = await launchProject({ source: dir, port: 45124, startCommand: "npm run nope" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as LaunchError).code).toBe("NO_START_SCRIPT");
    expect(await exists(path.join(dir, "install-ran"))).toBe(false);
  });
});
