import type { StepRow, StepStatus } from "../lib/job-view";

const LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  ok: "Done",
  repaired: "Repaired automatically",
  failed: "Failed",
  skipped: "Skipped",
};

function StatusIcon({ status }: { status: StepStatus }) {
  const common = "h-6 w-6 shrink-0";
  switch (status) {
    case "running":
      return <span className={`${common} animate-spin rounded-full border-2 border-accent-600 border-t-transparent`} />;
    case "ok":
      return (
        <svg className={`${common} text-accent-600`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="8" />
          <path d="M6.5 10.5l2.5 2.5 4.5-5" />
        </svg>
      );
    case "repaired":
      return (
        <svg className={`${common} text-accent-600`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="8" />
          <path d="M6.5 10.5l2.5 2.5 4.5-5" />
          <path d="M14.5 2.5l1.5 1.5" />
        </svg>
      );
    case "failed":
      return (
        <svg className={`${common} text-red-600`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="10" cy="10" r="8" />
          <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
        </svg>
      );
    case "skipped":
      return (
        <svg className={`${common} text-slate-500`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="10" cy="10" r="8" />
          <path d="M6.5 10h7" />
        </svg>
      );
    default:
      return (
        <svg className={`${common} text-slate-300`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="10" cy="10" r="8" />
        </svg>
      );
  }
}

export function StepList({ title, rows }: { title?: string; rows: StepRow[] }) {
  return (
    <section aria-labelledby="steps-heading">
      <h2 id="steps-heading" className="mb-4 text-base font-semibold uppercase tracking-wide text-slate-600">
        {title ? `Plan: ${title}` : "Plan"}
      </h2>
      <ol className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-4 px-5 py-4">
            <StatusIcon status={r.status} />
            <span className={`flex-1 text-lg ${r.status === "pending" ? "text-slate-600" : "text-slate-900"}`}>{r.caption}</span>
            <span className="text-sm text-slate-500">{LABEL[r.status]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
