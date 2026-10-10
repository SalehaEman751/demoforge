import { describe, expect, it } from "vitest";
import { clearDraft, EMPTY_DRAFT, loadDraft, retryDraft, saveDraft, type DraftStore } from "./draft";

const memory = (): DraftStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const full = { source: "/p/app", instructions: "do it", startCommand: "npm start", port: "3001", subdir: "web", trusted: true };

describe("draft storage", () => {
  it("round-trips a draft", () => {
    const s = memory();
    saveDraft(full, s);
    expect(loadDraft(s)).toEqual(full);
  });
  it("returns undefined when nothing is stored, or the data is damaged", () => {
    const s = memory();
    expect(loadDraft(s)).toBeUndefined();
    s.setItem("demoforge:form", "{not json");
    expect(loadDraft(s)).toBeUndefined();
    s.setItem("demoforge:form", JSON.stringify({ source: 5 }));
    expect(loadDraft(s)).toBeUndefined();
  });
  it("fills missing fields with empty values", () => {
    const s = memory();
    s.setItem("demoforge:form", JSON.stringify({ source: "x" }));
    expect(loadDraft(s)).toEqual({ ...EMPTY_DRAFT, source: "x" });
  });
  it("clears", () => {
    const s = memory();
    saveDraft(full, s);
    clearDraft(s);
    expect(loadDraft(s)).toBeUndefined();
  });
  it("never throws when storage is missing or broken", () => {
    const broken: DraftStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveDraft(full, broken)).not.toThrow();
    expect(loadDraft(broken)).toBeUndefined();
    expect(() => clearDraft(broken)).not.toThrow();
    expect(loadDraft(undefined)).toBeUndefined();
  });
});

describe("retryDraft", () => {
  it("keeps every saved value when the job is for the same project", () => {
    const s = memory();
    saveDraft(full, s);
    expect(retryDraft({ projectSource: "/p/app", instructions: "do it" }, s)).toEqual(full);
  });
  it("takes project and instructions from the job but only the saved advanced values for the same project", () => {
    const s = memory();
    saveDraft(full, s);
    const d = retryDraft({ projectSource: "/p/app", instructions: "changed" }, s);
    expect(d).toEqual({ ...full, instructions: "changed" });
    expect(loadDraft(s)).toEqual(d);
  });
  it("starts from the job alone, trust unticked, when the saved form was for another project", () => {
    const s = memory();
    saveDraft(full, s);
    expect(retryDraft({ projectSource: "/other", instructions: "i" }, s)).toEqual({ ...EMPTY_DRAFT, source: "/other", instructions: "i" });
  });
  it("works with no saved form", () => {
    expect(retryDraft({ projectSource: "/p", instructions: "" }, memory())).toEqual({ ...EMPTY_DRAFT, source: "/p" });
  });
});
