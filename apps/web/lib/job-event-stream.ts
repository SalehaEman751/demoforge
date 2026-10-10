/**
 * Framework-free SSE follower for GET /api/jobs/:id/events.
 *
 * - The server replays every past event first, and tags each frame with `id: <index>`.
 *   Events are deduped by that index, so a replay after a reconnect adds nothing twice.
 * - After a drop (no done/error seen yet) it reconnects `maxReconnects` times (default once),
 *   then gives up so the caller can fall back to GET /api/jobs/:id.
 * - After a done/error event it closes the source itself: the server ends the stream,
 *   and EventSource would otherwise treat that as a drop and reconnect forever.
 */

export type StreamSource = {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close(): void;
};

export type EventLike = { type: string };

export type StreamState = "connecting" | "live" | "reconnecting" | "closed" | "lost";

export type StreamOptions<E extends EventLike> = {
  url: string;
  createSource: (url: string) => StreamSource;
  /** Returns the typed event, or null for data that is not a valid event. */
  parse: (data: unknown) => E | null;
  /** Called once per distinct event index, in arrival order. */
  onEvent: (index: number, event: E) => void;
  onState?: (state: StreamState) => void;
  maxReconnects?: number;
  /** Runs `fn` after the reconnect delay; returns a cancel function. Injectable for tests. */
  schedule?: (fn: () => void, ms: number) => () => void;
  reconnectDelayMs?: number;
};

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Starts following the stream. Returns a function that stops everything. */
export function followJobEvents<E extends EventLike>(opts: StreamOptions<E>): () => void {
  const maxReconnects = opts.maxReconnects ?? 1;
  const schedule = opts.schedule ?? defaultSchedule;
  const delay = opts.reconnectDelayMs ?? 1000;
  const seen = new Set<number>();
  let reconnects = 0;
  let stopped = false;
  let finished = false; // a done/error event was delivered
  let source: StreamSource | undefined;
  let cancelRetry: (() => void) | undefined;

  const state = (s: StreamState): void => {
    if (!stopped) opts.onState?.(s);
  };

  const open = (): void => {
    let fallbackIndex = 0; // only used if a frame has no id; replays restart at 0 on each connection
    const src = opts.createSource(opts.url);
    source = src;

    src.onopen = () => {
      if (source === src) state("live");
    };

    src.onmessage = (msg) => {
      if (stopped || source !== src) return;
      let event: E | null = null;
      try {
        event = opts.parse(JSON.parse(String(msg.data)));
      } catch {
        event = null;
      }
      const id = Number.parseInt(msg.lastEventId, 10);
      const index = Number.isInteger(id) && id >= 0 ? id : fallbackIndex;
      fallbackIndex = index + 1;
      if (!event || seen.has(index)) return;
      seen.add(index);
      opts.onEvent(index, event);
      if (event.type === "done" || event.type === "error") {
        finished = true;
        src.close();
        state("closed");
      }
    };

    src.onerror = () => {
      if (stopped || source !== src || finished) return;
      src.close(); // stop EventSource's own endless retry; we retry once ourselves
      if (reconnects < maxReconnects) {
        reconnects += 1;
        state("reconnecting");
        cancelRetry = schedule(() => {
          if (!stopped) open();
        }, delay);
      } else {
        state("lost");
      }
    };
  };

  state("connecting");
  open();

  return () => {
    stopped = true;
    cancelRetry?.();
    source?.close();
  };
}
