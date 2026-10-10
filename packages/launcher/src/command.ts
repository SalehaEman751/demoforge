import { LaunchError } from "./errors.js";

// Exactly: <npm|yarn|pnpm> run <script>, single spaces. The script name must start with a
// letter or digit (so it can never be read as a flag) and use only characters that mean
// nothing to a shell.
const FORM = /^(npm|yarn|pnpm) run ([A-Za-z0-9][A-Za-z0-9:_.-]{0,99})$/;

// Anything a shell (sh or cmd.exe) would interpret, plus whitespace other than a plain space.
const SHELL_CHARS = /[;&|`$<>(){}[\]\\"'*?!#~%^=,\s]/;
const ONLY_SPACES = /[^\S ]/; // any whitespace character that is not a plain space

const HINT = "Use the form `npm run <script>` (or `yarn run` / `pnpm run`) with a script from package.json.";

function show(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}...` : flat;
}

/**
 * Accepts a startCommand override only if it is `npm|yarn|pnpm run <script>` and <script> exists in
 * package.json. Pure: nothing is run. Returns the command to use; throws LaunchError otherwise:
 * INVALID_ARGS for a wrong form or shell characters, NO_START_SCRIPT for an unknown script.
 */
export function validateStartCommand(
  command: string,
  scripts: Record<string, string> | undefined,
): string {
  const trimmed = command.trim();
  if (trimmed === "") {
    throw new LaunchError("INVALID_ARGS", `startCommand is empty. ${HINT}`);
  }

  // Check the spaces rule before the general character rule: tabs and newlines are shell separators.
  const spaceProblem = ONLY_SPACES.test(trimmed);
  const bad = SHELL_CHARS.exec(trimmed.replace(/ /g, ""));
  if (spaceProblem || bad) {
    const what = spaceProblem ? "line breaks or tabs" : `the character \`${bad?.[0]}\``;
    throw new LaunchError(
      "INVALID_ARGS",
      `startCommand \`${show(trimmed)}\` contains ${what}, which a shell would interpret, so it was not run. ${HINT}`,
    );
  }

  const m = FORM.exec(trimmed);
  if (!m) {
    throw new LaunchError(
      "INVALID_ARGS",
      `startCommand \`${show(trimmed)}\` is not in an accepted form, so it was not run. Extra arguments are not allowed (use the port option to change the port). ${HINT}`,
    );
  }

  const script = m[2] as string;
  const known = scripts && Object.prototype.hasOwnProperty.call(scripts, script);
  if (!known) {
    const names = Object.keys(scripts ?? {});
    throw new LaunchError(
      "NO_START_SCRIPT",
      `package.json has no script named "${script}". ` +
        (names.length > 0
          ? `Scripts it does have: ${names.join(", ")}. Pick one of those as startCommand.`
          : "It has no scripts at all; add a dev or start script first."),
    );
  }
  return trimmed;
}
