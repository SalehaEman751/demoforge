/**
 * Turns anything a pipeline stage throws into a plain-language failure for the UI.
 * The error's own `code` is read first (LaunchError, OllamaError, PlanError and FallbackError all carry one; they are
 * recognised by shape, so the api needs none of those packages' types). Only an error without a usable code
 * falls back to sniffing the message, and only in the planning stage.
 */

export type FailureStage = "launching" | "inspecting" | "planning" | "running" | "metrics";

/** Thrown by the api's own fallback switches. */
export class FallbackError extends Error {
  override name = "FallbackError";
  constructor(
    readonly code: "CACHED_PLAN_MISSING" | "CACHED_PLAN_INVALID" | "CACHED_VIDEO_MISSING",
    message: string,
  ) {
    super(message);
  }
}

export type Failure = {
  /** Stable machine code, sent as data.code in the error event. */
  code: string;
  /** Plain-language message plus fix hint for people; stored as job.error and sent as the error event's message. */
  message: string;
  /** The one-line fix on its own ("" when the code is unknown). */
  hint: string;
  stage: FailureStage;
  /** Original technical message, kept for debugging. */
  detail: string;
};

/** A short, plain-language message plus a one-line fix hint. The UI shows `${message} ${hint}`. */
export type FailureText = { message: string; hint: string };

/**
 * Every code a package can throw today: the launcher's LaunchError codes (packages/launcher/src/errors.ts),
 * the planner's OllamaError / PlanError codes (packages/planner/src/ollama.ts) and the api's own FallbackError codes.
 */
export const FAILURE_MESSAGES: Record<string, FailureText> = {
  // Launcher (LaunchError)
  NOT_FOUND: { message: "We could not find that project.", hint: "Check the folder path, the subfolder or the Git URL (https:// or git@ only)." },
  CLONE_FAILED: { message: "The repository could not be downloaded.", hint: "Check the URL and that the repository is public." },
  INVALID_ARGS: { message: "Some launch settings are not valid.", hint: "Use a port from 1 to 65535 and a start command like npm run dev, with no extra arguments." },
  INVALID_PACKAGE_JSON: { message: "The project's package.json could not be read.", hint: "Fix the JSON in package.json, then try again." },
  NO_START_SCRIPT: { message: "We could not find a way to start the project.", hint: "Add a dev or start script to package.json, or enter the name of a script it has." },
  MISSING_ENV: { message: "The project needs settings that are not set.", hint: "Add the values listed in its .env.example, then try again." },
  INSTALL_FAILED: { message: "Installing the project's dependencies failed.", hint: "Run the install yourself in the project folder to see why." },
  START_FAILED: { message: "The project crashed while starting.", hint: "Check that it starts with its own dev command." },
  START_TIMEOUT: { message: "The project took too long to start.", hint: "Check the start command and the port under Advanced." },
  NEEDS_BACKEND: { message: "The project needs a backend server that is not running.", hint: "Start its backend first, or try a project that runs on its own." },
  PORT_IN_USE: { message: "The port is already used by another program.", hint: "Stop that program or choose another port under Advanced." },
  // Planner (OllamaError, PlanError)
  OLLAMA_DOWN: { message: "The local AI model server is not running.", hint: "Start it with: ollama serve" },
  MODEL_MISSING: { message: "The AI model is not downloaded yet.", hint: "Run: ollama pull <model>" },
  PLAN_INVALID: { message: "The AI could not write a valid demo plan.", hint: "Try simpler, more specific instructions." },
  PLAN_TIMEOUT: { message: "The AI took too long to write the demo plan.", hint: "Try again (the model may still be loading) or use shorter instructions." },
  // Fallback switches (FallbackError)
  CACHED_PLAN_MISSING: { message: "The cached plan file was not found.", hint: "Check DEMOFORGE_CACHED_PLAN or add docs/fallback/cached-plan.json." },
  CACHED_PLAN_INVALID: { message: "The cached plan file is not a valid demo plan.", hint: "Save a plan from a good run and try again." },
  CACHED_VIDEO_MISSING: { message: "The cached demo video was not found.", hint: "Add it at docs/fallback/cached-demo.mp4." },
};

/** Older names some callers or mocks may still use; each maps to the code a package really throws. */
export const CODE_ALIASES: Record<string, string> = {
  SOURCE_NOT_FOUND: "NOT_FOUND",
  NO_START_COMMAND: "NO_START_SCRIPT",
  OLLAMA_UNREACHABLE: "OLLAMA_DOWN",
  MODEL_NOT_FOUND: "MODEL_MISSING",
};

/** Used when the code is unknown: one sentence per stage. */
const STAGE_FALLBACK: Record<FailureStage, { code: string; message: string }> = {
  launching: { code: "LAUNCH_FAILED", message: "The project could not be started." },
  inspecting: { code: "INSPECT_FAILED", message: "The project's pages could not be inspected." },
  planning: { code: "PLAN_FAILED", message: "The demo plan could not be created." },
  running: { code: "RUN_FAILED", message: "Recording the demo failed." },
  metrics: { code: "METRICS_FAILED", message: "The demo was recorded but its metrics could not be computed." },
};

const textOf = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
};

const field = (e: unknown, key: string): unknown =>
  e && typeof e === "object" ? (e as Record<string, unknown>)[key] : undefined;

/** Planner calls Ollama; network and missing-model errors often arrive as plain Errors. */
function guessPlannerCode(e: unknown, detail: string): string | undefined {
  const name = field(e, "name");
  const cause = field(e, "cause");
  const causeCode = field(cause, "code");
  if (name === "ZodError") return "PLAN_INVALID";
  if (name === "TimeoutError" || name === "AbortError") return "PLAN_TIMEOUT";
  if (causeCode === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(detail)) return "OLLAMA_DOWN";
  if (/model .*not found|pull the model/i.test(detail)) return "MODEL_MISSING";
  return undefined;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
/** Errors whose own `code` is a DemoForge code (not a Node code like ENOENT). */
const DOMAIN_ERROR_NAME = /^(LaunchError|OllamaError|PlanError|PlannerError|PlanValidationError|FallbackError)$/;

/** The error's own code when it is a DemoForge code (aliases resolved), otherwise undefined. */
function domainCode(e: unknown): string | undefined {
  const raw = field(e, "code");
  if (typeof raw !== "string" || !CODE_PATTERN.test(raw)) return undefined;
  const code = CODE_ALIASES[raw] ?? raw;
  if (code in FAILURE_MESSAGES) return code;
  const name = field(e, "name");
  return typeof name === "string" && DOMAIN_ERROR_NAME.test(name) ? code : undefined;
}

export function describeFailure(e: unknown, stage: FailureStage, model = process.env.DEMOFORGE_MODEL ?? "qwen2.5:7b-instruct"): Failure {
  const detail = textOf(e) || "Unknown error";
  let code = domainCode(e);
  if (!code && stage === "planning") code = guessPlannerCode(e, detail);

  const known = code ? FAILURE_MESSAGES[code] : undefined;
  if (code && known) {
    const hint = known.hint.replace("<model>", model);
    return { code, stage, detail, hint, message: `${known.message} ${hint}` };
  }
  const fallback = STAGE_FALLBACK[stage];
  return {
    code: code ?? fallback.code,
    stage,
    detail,
    hint: "",
    // Unknown codes still get a plain first sentence; the error's own message follows.
    message: `${fallback.message} ${detail}`,
  };
}
