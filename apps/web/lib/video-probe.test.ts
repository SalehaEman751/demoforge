import { describe, expect, it } from "vitest";
import { probeVideo } from "./video-probe";

const answering = (status: number): typeof fetch => (async () => new Response(null, { status })) as unknown as typeof fetch;

describe("probeVideo", () => {
  it("is missing on a 404", async () => {
    expect(await probeVideo("http://x/v", answering(404))).toBe("missing");
  });
  it("is ok on 200 and 206", async () => {
    expect(await probeVideo("http://x/v", answering(200))).toBe("ok");
    expect(await probeVideo("http://x/v", answering(206))).toBe("ok");
  });
  it("does not call other errors 'not available'", async () => {
    expect(await probeVideo("http://x/v", answering(500))).toBe("ok");
  });
  it("is ok when the request itself fails", async () => {
    const failing = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await probeVideo("http://x/v", failing)).toBe("ok");
  });
  it("asks with HEAD", async () => {
    let method: string | undefined;
    const spy = (async (_u: unknown, init?: RequestInit) => {
      method = init?.method;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await probeVideo("http://x/v", spy);
    expect(method).toBe("HEAD");
  });
});
