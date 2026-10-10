import { describe, expect, it } from "vitest";
import { followJobEvents, type StreamSource, type StreamState } from "./job-event-stream";

type Ev = { type: string; message?: string };

class FakeSource implements StreamSource {
  onopen: StreamSource["onopen"] = null;
  onmessage: StreamSource["onmessage"] = null;
  onerror: StreamSource["onerror"] = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
  send(id: string, ev: Ev): void {
    this.onmessage?.({ data: JSON.stringify(ev), lastEventId: id } as MessageEvent);
  }
  drop(): void {
    this.onerror?.({} as Event);
  }
}

const setup = (maxReconnects?: number) => {
  const sources: FakeSource[] = [];
  const got: [number, Ev][] = [];
  const states: StreamState[] = [];
  const stop = followJobEvents<Ev>({
    url: "x",
    createSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    parse: (d) => (d && typeof d === "object" && "type" in d ? (d as Ev) : null),
    onEvent: (i, e) => got.push([i, e]),
    onState: (s) => states.push(s),
    schedule: (fn) => {
      fn();
      return () => undefined;
    },
    maxReconnects,
  });
  return { sources, got, states, stop };
};

describe("followJobEvents", () => {
  it("delivers events in order and closes after done", () => {
    const { sources, got, states } = setup();
    sources[0]!.send("0", { type: "stage", message: "a" });
    sources[0]!.send("1", { type: "done" });
    expect(got.map(([i]) => i)).toEqual([0, 1]);
    expect(sources[0]!.closed).toBe(true);
    expect(states[states.length - 1]).toBe("closed");
  });

  it("dedupes a replay after reconnecting once", () => {
    const { sources, got } = setup();
    sources[0]!.send("0", { type: "stage" });
    sources[0]!.send("1", { type: "log" });
    sources[0]!.drop();
    expect(sources.length).toBe(2);
    sources[1]!.send("0", { type: "stage" });
    sources[1]!.send("1", { type: "log" });
    sources[1]!.send("2", { type: "done" });
    expect(got.map(([i]) => i)).toEqual([0, 1, 2]);
  });

  it("gives up after the second drop", () => {
    const { sources, states } = setup();
    sources[0]!.drop();
    sources[1]!.drop();
    expect(sources.length).toBe(2);
    expect(states[states.length - 1]).toBe("lost");
  });

  it("does not reconnect after a terminal event", () => {
    const { sources } = setup();
    sources[0]!.send("0", { type: "error" });
    sources[0]!.drop();
    expect(sources.length).toBe(1);
  });

  it("ignores invalid data and stops cleanly", () => {
    const { sources, got, stop } = setup();
    sources[0]!.onmessage?.({ data: "not json", lastEventId: "0" } as MessageEvent);
    expect(got.length).toBe(0);
    stop();
    expect(sources[0]!.closed).toBe(true);
    sources[0]!.drop();
    expect(sources.length).toBe(1);
  });
});
