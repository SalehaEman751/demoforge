"use client";

import { useState } from "react";
import type { HealthState } from "../lib/useHealth";
import { API_DOWN_FIX, fixCommands, problems, warningCopy } from "../lib/health-view";
import { buttonSecondary } from "./ui";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the command is still on screen to select by hand.
    }
  }
  return (
    <button type="button" onClick={copy} className="shrink-0 rounded-md border border-slate-600 px-3 py-1 text-sm font-semibold text-slate-100 hover:border-white">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Command({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-900 px-4 py-3">
      <code className="min-w-0 break-all font-mono text-base text-slate-100">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

type Problem = { key: string; title: string; detail?: string; commands: string[] };

/**
 * Warns about red setup checks on the home page. It never blocks anything: the form stays usable.
 * Renders nothing while loading and when every check is green.
 */
export function HealthBanner({ state }: { state: HealthState }) {
  const items: Problem[] = state.unreachable
    ? [
        {
          key: "api",
          title: "The DemoForge API is not responding",
          detail: `${state.unreachable.message} (code: ${state.unreachable.code})`,
          commands: [API_DOWN_FIX],
        },
      ]
    : problems(state.health).map((i) => ({ key: i.id, title: i.label, detail: i.detail, commands: fixCommands(i.fix) }));

  if (items.length === 0) return null;
  // Mock mode: same content, calmer amber, because nothing here stops this demo from running.
  const mocks = !state.unreachable && state.health?.mocks === true;
  const copy = warningCopy(items.length, mocks);
  const tone = mocks ? "border-amber-300 bg-amber-50" : "border-red-200 bg-red-50";
  const ink = mocks ? "text-amber-950" : "text-red-900";

  return (
    <section role="alert" aria-labelledby="health-heading" className={`rounded-2xl border ${tone} p-6 sm:p-8`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="health-heading" className={`text-2xl font-semibold ${ink}`}>
            {copy.heading}
          </h2>
          <p className={`mt-2 text-base ${ink}`}>{copy.body}</p>
        </div>
        <button type="button" onClick={state.recheck} disabled={state.loading} className={buttonSecondary}>
          {state.loading ? "Checking…" : "Check again"}
        </button>
      </div>
      <ul className="mt-6 space-y-6">
        {items.map((p) => (
          <li key={p.key}>
            <p className="text-lg font-semibold text-slate-900">{p.title}</p>
            {p.detail && <p className="mt-1 break-words text-base text-slate-800">{p.detail}</p>}
            {p.commands.length > 0 && (
              <>
                <p className="mt-3 text-base font-medium text-slate-900">{p.commands.length > 1 ? "Run these, one at a time:" : "Fix it by running:"}</p>
                {p.commands.map((c) => (
                  <Command key={c} text={c} />
                ))}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
