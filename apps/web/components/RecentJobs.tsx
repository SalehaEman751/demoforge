"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isFinished, listJobs } from "../lib/api";
import type { Job } from "../lib/shared";
import { StatusBadge } from "./StatusBadge";

const MAX_SHOWN = 5;

export const timeAgo = (ms: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export function RecentJobs() {
  const [jobs, setJobs] = useState<Job[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (): Promise<void> => {
      try {
        const list = await listJobs();
        if (cancelled) return;
        setJobs(list.slice(0, MAX_SHOWN));
        setFailed(false);
        // Keep the list fresh while something is still running.
        if (list.slice(0, MAX_SHOWN).some((j) => !isFinished(j))) timer = setTimeout(load, 3000);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-4 text-base font-semibold uppercase tracking-wide text-slate-600">
        Recent jobs
      </h2>
      {failed && <p className="text-base text-slate-600">Could not load recent jobs. Is the API running?</p>}
      {jobs?.length === 0 && <p className="text-base text-slate-600">No demos yet. Your first one will show up here.</p>}
      {jobs && jobs.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {jobs?.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-medium">{j.projectSource}</span>
                  <span className="block truncate text-sm text-slate-600">{j.instructions || "No instructions"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-slate-500">{timeAgo(j.createdAt)}</span>
                  <StatusBadge status={j.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
