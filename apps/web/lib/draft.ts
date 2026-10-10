/**
 * The form values, kept in sessionStorage so "Try again" can bring the person back to the
 * form exactly as they left it, even after the job page (a different route) was shown.
 * Storage can be missing or blocked, so every call is safe to make and never throws.
 */
import { z } from "zod";
import type { Job } from "./shared";

export const DraftSchema = z.object({
  source: z.string().default(""),
  instructions: z.string().default(""),
  startCommand: z.string().default(""),
  port: z.string().default(""),
  subdir: z.string().default(""),
  trusted: z.boolean().default(false),
});
export type Draft = z.infer<typeof DraftSchema>;

export const EMPTY_DRAFT: Draft = { source: "", instructions: "", startCommand: "", port: "", subdir: "", trusted: false };

const KEY = "demoforge:form";

export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const browserStore = (): DraftStore | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined; // access can throw when storage is blocked
  }
};

export function loadDraft(store: DraftStore | undefined = browserStore()): Draft | undefined {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return undefined;
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveDraft(draft: Draft, store: DraftStore | undefined = browserStore()): void {
  try {
    store?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Full or blocked storage only means the form starts empty next time.
  }
}

export function clearDraft(store: DraftStore | undefined = browserStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Draft to restore when a failed job sends the person back to the form. The job only knows the
 * project and the instructions, so the advanced fields and the trust tick come from the saved
 * form, and only when it was for the same project. A job opened from the recent list (no saved
 * form) comes back with the trust box unticked.
 */
export function retryDraft(
  job: Pick<Job, "projectSource" | "instructions">,
  store: DraftStore | undefined = browserStore(),
): Draft {
  const saved = loadDraft(store);
  const base = saved && saved.source.trim() === job.projectSource.trim() ? saved : EMPTY_DRAFT;
  const draft: Draft = { ...base, source: job.projectSource, instructions: job.instructions };
  saveDraft(draft, store);
  return draft;
}
