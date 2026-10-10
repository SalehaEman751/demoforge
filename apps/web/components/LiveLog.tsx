"use client";

import { useEffect, useRef, useState } from "react";
import type { LogLine } from "../lib/job-view";

const COLOR: Record<LogLine["kind"], string> = {
  stage: "text-accent-300 font-semibold",
  info: "text-slate-200",
  success: "text-accent-300",
  error: "text-red-300",
};

export function LiveLog({ lines }: { lines: LogLine[] }) {
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // follow new lines only while the reader is at the bottom

  useEffect(() => {
    const el = box.current;
    if (open && el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-base font-semibold uppercase tracking-wide text-slate-600"
      >
        <span>Live log ({lines.length})</span>
        <span aria-hidden>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          role="log"
          aria-live="off"
          className="mt-4 max-h-96 overflow-y-auto rounded-2xl bg-slate-900 p-5 font-mono text-sm leading-6"
        >
          {lines.length === 0 && <p className="text-slate-500">Waiting for events…</p>}
          {lines.map((l, i) => (
            <p key={i} className={`whitespace-pre-wrap break-words ${COLOR[l.kind]}`}>
              {l.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
