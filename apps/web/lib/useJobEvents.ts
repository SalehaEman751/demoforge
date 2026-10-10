"use client";

import { useEffect, useState } from "react";
import { ApiError, eventsUrl, getJob } from "./api";
import { followJobEvents, type StreamState } from "./job-event-stream";
import { JobEventSchema, type Job, type JobEvent } from "./shared";

export type JobEventsState = {
  /** Events in index order, each once, even after a replay. */
  events: JobEvent[];
  /** Latest job from GET /api/jobs/:id: loaded first, and again on every stage change and when the stream ends or is lost. */
  job: Job | undefined;
  /** "closed" = finished normally; "lost" = stream dropped twice, so `job` is the source of truth. */
  connection: StreamState | "idle";
  error: string | undefined;
  /** Code of that error: an ApiError code such as "not_found" or "network_error". */
  errorCode: string | undefined;
};

const initial: JobEventsState = { events: [], job: undefined, connection: "idle", error: undefined, errorCode: undefined };

const parseEvent = (data: unknown): JobEvent | null => {
  const r = JobEventSchema.safeParse(data);
  return r.success ? r.data : null;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown): string => (e instanceof ApiError ? e.code : "unknown_error");

/**
 * Follows one job.
 *
 * It loads the job first, then follows the SSE stream. The server replays every past event,
 * so a reload mid-run (or of a finished job) rebuilds the full timeline and log; replayed
 * events are deduped by index and the stream reconnects once on a drop. The job is refetched
 * on every stage event (that is when `plan`, `run` and `metrics` appear) and when the stream
 * ends or is lost, so `job` alone can still render the page if events are missing.
 */
export function useJobEvents(jobId: string | undefined): JobEventsState {
  const [state, setState] = useState<JobEventsState>(initial);

  useEffect(() => {
    if (!jobId) {
      setState(initial);
      return;
    }
    let cancelled = false;
    let stop: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const byIndex = new Map<number, JobEvent>();
    setState({ ...initial, connection: "connecting" });

    const refreshJob = async (): Promise<Job | undefined> => {
      try {
        const job = await getJob(jobId);
        if (!cancelled) setState((s) => ({ ...s, job, error: undefined, errorCode: undefined }));
        return job;
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: message(e), errorCode: codeOf(e) }));
        return undefined;
      }
    };
    // A replay delivers many stage events at once; coalesce them into one fetch.
    const scheduleRefresh = (): void => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshJob();
      }, 150);
    };

    void (async () => {
      const job = await refreshJob();
      if (cancelled) return;
      if (!job) {
        setState((s) => ({ ...s, connection: "lost" }));
        return;
      }
      stop = followJobEvents<JobEvent>({
        url: eventsUrl(jobId),
        createSource: (url) => new EventSource(url),
        parse: parseEvent,
        onEvent: (index, event) => {
          byIndex.set(index, event);
          const events = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e);
          setState((s) => ({ ...s, events }));
          if (event.type === "stage") scheduleRefresh();
        },
        onState: (connection) => {
          setState((s) => ({ ...s, connection }));
          if (connection === "closed" || connection === "lost") void refreshJob();
        },
      });
    })();

    return () => {
      cancelled = true;
      stop?.();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [jobId]);

  return state;
}
