"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { ErrorCard } from "../../../components/ErrorCard";
import { LiveLog } from "../../../components/LiveLog";
import { Results } from "../../../components/Results";
import { StageStepper } from "../../../components/StageStepper";
import { StatusBadge } from "../../../components/StatusBadge";
import { StepList } from "../../../components/StepList";
import { clearDraft, retryDraft } from "../../../lib/draft";
import { failureInfo, logLines, stageStates, stepRows } from "../../../lib/job-view";
import { useJobEvents } from "../../../lib/useJobEvents";

const backLink = (
  <Link className="text-lg font-medium text-accent-800 hover:underline" href="/">
    ← New demo
  </Link>
);

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { events, job, connection, error, errorCode } = useJobEvents(id);

  const states = useMemo(() => stageStates(job, events), [job, events]);
  const rows = useMemo(() => stepRows(job?.plan, job, events), [job, events]);
  const lines = useMemo(() => logLines(events), [events]);
  const failure = useMemo(() => failureInfo(job, events), [job, events]);

  // A finished demo no longer needs the saved form values; a failed one keeps them for "Try again".
  const done = job?.status === "done";
  useEffect(() => {
    if (done) clearDraft();
  }, [done]);

  // The job itself could not be loaded (unknown id, API down).
  if (error && !job) {
    const missing = errorCode === "not_found";
    return (
      <div className="space-y-10">
        {backLink}
        <ErrorCard
          title="We couldn't open this demo"
          message={error}
          code={errorCode ?? "unknown_error"}
          {...(missing ? { href: "/", actionLabel: "Start a new demo" } : { onAction: () => window.location.reload() })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        {backLink}
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold">{job?.projectSource ?? "Loading…"}</h1>
            {job?.instructions && <p className="mt-2 text-lg text-slate-700">{job.instructions}</p>}
          </div>
          {job && <StatusBadge status={job.status} />}
        </div>
      </div>

      <StageStepper states={states} />

      {connection === "reconnecting" && <p className="text-base font-medium text-slate-700">Connection dropped. Reconnecting…</p>}
      {connection === "lost" && job && job.status !== "done" && job.status !== "failed" && (
        <p className="text-base font-medium text-slate-700">Live updates were interrupted. Reload the page to pick them up again.</p>
      )}

      {failure && (
        <ErrorCard
          title="We couldn't make this demo"
          message={failure.message}
          code={failure.code}
          href="/"
          onNavigate={() => {
            if (job) retryDraft(job);
          }}
        />
      )}

      {done && job && <Results job={job} />}

      {job?.plan && <StepList title={job.plan.title} rows={rows} />}

      <LiveLog lines={lines} />
    </div>
  );
}
