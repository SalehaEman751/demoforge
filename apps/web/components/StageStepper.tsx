import { STAGES, type StageState } from "../lib/job-view";

const DOT: Record<StageState, string> = {
  pending: "border-slate-300 bg-white text-slate-500",
  active: "border-accent-600 bg-accent-50 text-accent-700",
  done: "border-accent-600 bg-accent-600 text-white",
  failed: "border-red-600 bg-red-600 text-white",
};

const STATE_TEXT: Record<StageState, string> = { pending: "pending", active: "in progress", done: "done", failed: "failed" };

export function StageStepper({ states }: { states: StageState[] }) {
  return (
    <ol className="flex items-start" aria-label="Progress">
      {STAGES.map((stage, i) => {
        const state = states[i] ?? "pending";
        return (
          <li key={stage.key} className="relative flex flex-1 flex-col items-center text-center" aria-current={state === "active" ? "step" : undefined}>
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute right-1/2 top-[1.125rem] h-0.5 w-full ${states[i - 1] === "done" ? "bg-accent-600" : "bg-slate-200"}`}
              />
            )}
            <span className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold ${DOT[state]}`}>
              {state === "done" ? "✓" : state === "failed" ? "✕" : state === "active" ? <Spinner /> : i + 1}
            </span>
            <span className={`mt-2 text-sm sm:text-base ${state === "pending" ? "text-slate-500" : "font-medium text-slate-900"}`}>{stage.label}</span>
            <span className="sr-only">{STATE_TEXT[state]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Spinner() {
  return <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-600 border-t-transparent" />;
}
