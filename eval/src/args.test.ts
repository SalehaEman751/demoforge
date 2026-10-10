import { describe, expect, it } from "vitest";
import { applyVariant, parseCli } from "./args.js";

const base = ["--source", "samples/taskly", "--instructions", "Do it"];

describe("parseCli", () => {
  it("applies defaults", () => {
    expect(parseCli(base)).toEqual({ runs: 10, source: "samples/taskly", instructions: "Do it", api: "http://localhost:4000", dry: false, timeoutSec: 900 });
  });
  it("reads every flag", () => {
    expect(parseCli([...base, "--runs", "3", "--api", "http://x:1", "--variant", "renamed", "--dry", "--timeout", "30"])).toMatchObject({
      runs: 3, api: "http://x:1", variant: "renamed", dry: true, timeoutSec: 30,
    });
  });
  it("rejects bad input with a plain message", () => {
    expect(() => parseCli([...base, "--runs", "0"])).toThrow(/--runs/);
    expect(() => parseCli([...base, "--runs", "x"])).toThrow(/--runs/);
    expect(() => parseCli([...base, "--variant", "other"])).toThrow(/--variant/);
    expect(() => parseCli([...base, "--api", "nope"])).toThrow(/--api/);
    expect(() => parseCli([...base, "--timeout", "-1"])).toThrow(/--timeout/);
    expect(() => parseCli(["--instructions", "x"])).toThrow(/--source/);
    expect(() => parseCli(["--source", "s"])).toThrow(/--instructions/);
  });
  it("lets --dry omit source and instructions", () => {
    expect(parseCli(["--dry"])).toMatchObject({ dry: true, source: "samples/taskly" });
  });
});

describe("applyVariant", () => {
  it("appends ?variant=renamed, or & when there is already a query", () => {
    expect(applyVariant("samples/taskly", "renamed")).toBe("samples/taskly?variant=renamed");
    expect(applyVariant("http://localhost:3100/?a=1", "renamed")).toBe("http://localhost:3100/?a=1&variant=renamed");
    expect(applyVariant("samples/taskly")).toBe("samples/taskly");
  });
});
