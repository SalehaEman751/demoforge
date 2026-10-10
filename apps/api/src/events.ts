import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JobEventSchema, type JobEvent } from "@demoforge/shared";

/** A done or error event ends the stream. */
export const isTerminalEvent = (e: JobEvent): boolean => e.type === "done" || e.type === "error";

/**
 * Per-job event log. Events are kept in memory, appended to <jobDir>/events.jsonl,
 * and can be replayed (also after a restart) and followed live.
 */
export class JobEvents {
  private readonly cache = new Map<string, JobEvent[]>();
  private readonly subs = new Map<string, Set<(e: JobEvent) => void>>();

  constructor(private readonly jobDir: (id: string) => string) {}

  emit(id: string, event: JobEvent): void {
    this.history(id); // make sure earlier events are loaded before appending
    this.cache.get(id)!.push(event);
    try {
      mkdirSync(this.jobDir(id), { recursive: true });
      appendFileSync(join(this.jobDir(id), "events.jsonl"), `${JSON.stringify(event)}\n`);
    } catch {
      // Persistence is best effort; the in-memory copy still serves live clients.
    }
    for (const fn of [...(this.subs.get(id) ?? [])]) {
      try {
        fn(event);
      } catch {
        // A broken subscriber must not stop the pipeline.
      }
    }
  }

  /** All events so far, oldest first. */
  history(id: string): JobEvent[] {
    let list = this.cache.get(id);
    if (!list) {
      list = [];
      const file = join(this.jobDir(id), "events.jsonl");
      if (existsSync(file)) {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            list.push(JobEventSchema.parse(JSON.parse(line)));
          } catch {
            // skip a torn or invalid line
          }
        }
      }
      this.cache.set(id, list);
    }
    return [...list];
  }

  /** Follow live events. Returns an unsubscribe function. */
  subscribe(id: string, fn: (e: JobEvent) => void): () => void {
    let set = this.subs.get(id);
    if (!set) this.subs.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
}
