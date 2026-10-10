"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, createJob, type CreateJobInput } from "../lib/api";
import { loadDraft, saveDraft } from "../lib/draft";
import { ErrorCard } from "./ErrorCard";
import { buttonPrimary, card } from "./ui";

const EXAMPLES = [
  "Show how a user signs up and adds a task",
  "Walk through the main pages and highlight the key features",
  "Show how someone searches for an item and opens its details",
];

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm placeholder:text-slate-500 focus:border-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-600/30";

/** Empty means "not set"; otherwise a whole number from 1 to 65535. */
const portValid = (port: string): boolean => {
  const p = port.trim();
  if (p === "") return true;
  const n = Number(p);
  return /^\d+$/.test(p) && n >= 1 && n <= 65535;
};

type Failure = { message: string; code: string };

/** Shown under the button when a setup check is red. Submitting always stays possible. `mild`: mock mode, the demo will still run. */
export type SetupWarning = { text: string; mild: boolean };

export function JobForm({ setupWarning }: { setupWarning?: SetupWarning }) {
  const router = useRouter();
  const sourceRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [instructions, setInstructions] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [port, setPort] = useState("");
  const [subdir, setSubdir] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure>();

  // Bring back the values from the last submit (after "Try again" on the job page).
  useEffect(() => {
    const d = loadDraft();
    if (!d) return;
    setSource(d.source);
    setInstructions(d.instructions);
    setStartCommand(d.startCommand);
    setPort(d.port);
    setSubdir(d.subdir);
    setTrusted(d.trusted);
    if (d.startCommand || d.port || d.subdir) setAdvancedOpen(true);
  }, []);

  const valid = source.trim() !== "" && trusted && portValid(port);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    saveDraft({ source, instructions, startCommand, port, subdir, trusted });
    const input: CreateJobInput = { source: source.trim(), instructions: instructions.trim(), allowAuthProbe: true };
    if (startCommand.trim()) input.startCommand = startCommand.trim();
    if (port.trim()) input.port = Number(port.trim());
    if (subdir.trim()) input.subdir = subdir.trim();
    setSubmitting(true);
    setFailure(undefined);
    try {
      const { id } = await createJob(input);
      router.push(`/jobs/${id}`);
    } catch (err) {
      setFailure(
        err instanceof ApiError
          ? { message: err.message, code: err.code }
          : { message: "Something went wrong. Please try again.", code: "unknown_error" },
      );
      setSubmitting(false);
    }
  }

  // On a failed submit the card replaces the form. The values live in this component's state,
  // so going back shows the form exactly as it was.
  if (failure) {
    return (
      <ErrorCard
        title="We couldn't start the demo"
        message={failure.message}
        code={failure.code}
        onAction={() => {
          setFailure(undefined);
          setTimeout(() => sourceRef.current?.focus(), 0);
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-8`}>
      <div>
        <label htmlFor="source" className="mb-2 block text-lg font-semibold">
          Project
        </label>
        <input
          id="source"
          ref={sourceRef}
          className={inputClass}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Path to your project, or a GitHub URL"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div>
        <label htmlFor="instructions" className="mb-2 block text-lg font-semibold">
          What should the demo show? <span className="font-normal text-slate-600">(optional)</span>
        </label>
        <textarea
          id="instructions"
          className={`${inputClass} min-h-32`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
        />
        <div className="mt-3 flex flex-wrap gap-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInstructions(ex)}
              className="rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-left text-base text-slate-800 hover:border-accent-700 hover:text-accent-800"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)} className="rounded-lg border border-slate-300 px-5 py-4">
        <summary className="cursor-pointer select-none text-lg font-semibold">Advanced</summary>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label htmlFor="startCommand" className="mb-2 block text-base font-medium">
              Start command
            </label>
            <input
              id="startCommand"
              className={inputClass}
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              placeholder="npm run dev (detected automatically if empty)"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="port" className="mb-2 block text-base font-medium">
              Port
            </label>
            <input
              id="port"
              className={inputClass}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
              placeholder="3000"
              aria-invalid={!portValid(port)}
            />
            {!portValid(port) && <p className="mt-2 text-base text-red-700">Enter a number from 1 to 65535.</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="subdir" className="mb-2 block text-base font-medium">
              Subfolder
            </label>
            <input
              id="subdir"
              className={inputClass}
              value={subdir}
              onChange={(e) => setSubdir(e.target.value)}
              placeholder="apps/web (if the app is not at the root)"
              spellCheck={false}
            />
          </div>
        </div>
      </details>

      <label className="flex items-start gap-3 text-lg">
        <input
          type="checkbox"
          checked={trusted}
          onChange={(e) => setTrusted(e.target.checked)}
          required
          className="mt-1 h-5 w-5 shrink-0 rounded border-slate-400 accent-accent-700"
        />
        <span>I trust this project and want to run it on this machine</span>
      </label>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="submit" disabled={!valid || submitting} className={buttonPrimary}>
            {submitting ? "Starting…" : "Generate demo"}
          </button>
          <p className="text-base text-slate-600">Runs locally. Your code never leaves your machine.</p>
        </div>
        {setupWarning && (
          <p
            role="status"
            className={`rounded-lg border px-4 py-3 text-base ${
              setupWarning.mild ? "border-amber-300 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            {setupWarning.text}
          </p>
        )}
      </div>
    </form>
  );
}
