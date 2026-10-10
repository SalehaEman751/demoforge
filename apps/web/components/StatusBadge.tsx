import type { Job } from "../lib/shared";

const STYLE: Record<Job["status"], string> = {
  queued: "bg-slate-200 text-slate-800",
  launching: "bg-accent-50 text-accent-800",
  inspecting: "bg-accent-50 text-accent-800",
  planning: "bg-accent-50 text-accent-800",
  running: "bg-accent-50 text-accent-800",
  done: "bg-accent-700 text-white",
  failed: "bg-red-100 text-red-800",
};

const LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  launching: "Launching",
  inspecting: "Inspecting",
  planning: "Planning",
  running: "Recording",
  done: "Done",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: Job["status"] }) {
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STYLE[status]}`}>{LABEL[status]}</span>;
}
