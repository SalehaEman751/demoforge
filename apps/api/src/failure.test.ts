import { LaunchError, type LaunchErrorCode } from "@demoforge/launcher";
import { OllamaError, PlanError, type PlannerErrorCode } from "@demoforge/planner";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CODE_ALIASES, describeFailure, FAILURE_MESSAGES } from "./failure.js";

const launchError = (code: string, message = "technical") =>
  Object.assign(new Error(message), { name: "LaunchError", code });

describe("describeFailure", () => {
  it("uses the plain message for every known code", () => {
    for (const code of Object.keys(FAILURE_MESSAGES)) {
      const f = describeFailure(launchError(code), "launching", "m:1");
      expect(f.code).toBe(code);
      expect(f.message).not.toContain("<model>");
      expect(f.detail).toBe("technical");
    }
  });

  it("fills in the model name", () => {
    expect(describeFailure(launchError("MODEL_NOT_FOUND"), "planning", "qwen2.5:7b-instruct").message).toContain(
      "ollama pull qwen2.5:7b-instruct",
    );
  });

  it("keeps an unknown LaunchError code and uses the stage sentence plus its message", () => {
    const f = describeFailure(launchError("WEIRD_THING", "something odd"), "launching");
    expect(f).toMatchObject({ code: "WEIRD_THING", message: "The project could not be started. something odd" });
  });

  it("ignores Node codes like ENOENT and falls back to the stage code", () => {
    const e = Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" });
    expect(describeFailure(e, "launching").code).toBe("LAUNCH_FAILED");
  });

  it("recognises planner failures without a code", () => {
    let zod: unknown;
    try {
      z.object({ a: z.string() }).parse({});
    } catch (e) {
      zod = e;
    }
    expect(describeFailure(zod, "planning").code).toBe("PLAN_INVALID");
    expect(describeFailure(new Error("connect ECONNREFUSED 127.0.0.1:11434"), "planning").code).toBe("OLLAMA_DOWN");
    expect(describeFailure(new Error('model "x" not found, try pulling it first'), "planning").code).toBe("MODEL_MISSING");
    expect(describeFailure(Object.assign(new Error("t"), { name: "TimeoutError" }), "planning").code).toBe("PLAN_TIMEOUT");
  });

  it("handles anything thrown", () => {
    expect(describeFailure(undefined, "running")).toMatchObject({ code: "RUN_FAILED", stage: "running" });
    expect(describeFailure("text", "inspecting")).toMatchObject({ code: "INSPECT_FAILED", detail: "text" });
    expect(describeFailure({ odd: 1 }, "metrics").detail).toBe('{"odd":1}');
  });
});

// Every LaunchErrorCode must be listed here: `satisfies` fails to compile if the launcher adds or renames one.
const LAUNCHER: Record<LaunchErrorCode, string> = {
  NOT_FOUND: "We could not find that project. Check the folder path, the subfolder or the Git URL (https:// or git@ only).",
  CLONE_FAILED: "The repository could not be downloaded. Check the URL and that the repository is public.",
  INVALID_ARGS: "Some launch settings are not valid. Use a port from 1 to 65535 and a start command like npm run dev, with no extra arguments.",
  INVALID_PACKAGE_JSON: "The project's package.json could not be read. Fix the JSON in package.json, then try again.",
  NO_START_SCRIPT: "We could not find a way to start the project. Add a dev or start script to package.json, or enter the name of a script it has.",
  MISSING_ENV: "The project needs settings that are not set. Add the values listed in its .env.example, then try again.",
  INSTALL_FAILED: "Installing the project's dependencies failed. Run the install yourself in the project folder to see why.",
  START_FAILED: "The project crashed while starting. Check that it starts with its own dev command.",
  START_TIMEOUT: "The project took too long to start. Check the start command and the port under Advanced.",
  NEEDS_BACKEND: "The project needs a backend server that is not running. Start its backend first, or try a project that runs on its own.",
  PORT_IN_USE: "The port is already used by another program. Stop that program or choose another port under Advanced.",
} satisfies Record<LaunchErrorCode, string>;

describe("A5: launcher codes (real LaunchError)", () => {
  for (const [code, text] of Object.entries(LAUNCHER)) {
    it(`${code} gives its own message and fix hint, and keeps the launcher's text as detail`, () => {
      const f = describeFailure(new LaunchError(code as LaunchErrorCode, `launcher says: ${code}`), "launching");
      expect(f).toMatchObject({ code, stage: "launching", message: text, detail: `launcher says: ${code}` });
      expect(f.hint).not.toBe("");
      expect(text.endsWith(f.hint)).toBe(true);
    });
  }
});

describe("A5: planner codes (real OllamaError / PlanError)", () => {
  const MODEL = "qwen2.5:7b-instruct";
  const cases: [PlannerErrorCode, Error, string][] = [
    ["OLLAMA_DOWN", new OllamaError("Ollama is not running: run ollama serve (could not reach x)", "OLLAMA_DOWN"), "The local AI model server is not running. Start it with: ollama serve"],
    ["MODEL_MISSING", new OllamaError(`Model not found: run ollama pull ${MODEL}`, "MODEL_MISSING"), `The AI model is not downloaded yet. Run: ollama pull ${MODEL}`],
    ["PLAN_INVALID", new PlanError("The model's plan does not fit the app, even after a second try: step 2: no button", ["step 2: no button"], []), "The AI could not write a valid demo plan. Try simpler, more specific instructions."],
    ["PLAN_TIMEOUT", new OllamaError("Ollama did not answer within 90s.", "PLAN_TIMEOUT"), "The AI took too long to write the demo plan. Try again (the model may still be loading) or use shorter instructions."],
  ];
  for (const [code, error, text] of cases) {
    it(`${code} is read from error.code, not from the message`, () => {
      expect((error as { code?: string }).code).toBe(code);
      expect(describeFailure(error, "planning", MODEL)).toMatchObject({ code, message: text, stage: "planning" });
    });
  }

  it("error.code wins over the message text", () => {
    // The text looks like a connection problem, but the code says the plan was invalid.
    const e = new OllamaError("fetch failed ECONNREFUSED", "PLAN_INVALID");
    expect(describeFailure(e, "planning").code).toBe("PLAN_INVALID");
  });

  it("an OllamaError with a code it does not know keeps that code with the generic sentence", () => {
    const e = Object.assign(new OllamaError("odd"), { code: "SOMETHING_NEW" });
    expect(describeFailure(e, "planning")).toMatchObject({ code: "SOMETHING_NEW", message: "The demo plan could not be created. odd", hint: "" });
  });
});

describe("A5: table and fallbacks", () => {
  it("lists exactly the codes that a package can throw (launcher, planner, fallback switches)", () => {
    const planner: PlannerErrorCode[] = ["OLLAMA_DOWN", "MODEL_MISSING", "PLAN_INVALID", "PLAN_TIMEOUT"];
    const fallback = ["CACHED_PLAN_MISSING", "CACHED_PLAN_INVALID", "CACHED_VIDEO_MISSING"];
    expect(Object.keys(FAILURE_MESSAGES).sort()).toEqual([...Object.keys(LAUNCHER), ...planner, ...fallback].sort());
  });

  it("old names are aliases for the real codes", () => {
    for (const [alias, code] of Object.entries(CODE_ALIASES)) {
      const f = describeFailure(Object.assign(new Error("x"), { name: "LaunchError", code: alias }), "launching", "m:1");
      expect(f.code).toBe(code);
      expect(FAILURE_MESSAGES[code]).toBeDefined();
    }
  });

  it("an unknown error still gives the generic stage message", () => {
    for (const [stage, sentence] of [
      ["launching", "The project could not be started."],
      ["inspecting", "The project's pages could not be inspected."],
      ["planning", "The demo plan could not be created."],
      ["running", "Recording the demo failed."],
      ["metrics", "The demo was recorded but its metrics could not be computed."],
    ] as const) {
      const f = describeFailure(new Error("something nobody expected"), stage);
      expect(f.message).toBe(`${sentence} something nobody expected`);
      expect(f.hint).toBe("");
    }
  });
});
