import Link from "next/link";
import { buttonPrimary } from "./ui";

type Props = {
  /** What went wrong, in plain language. */
  message: string;
  /** Machine code (for example PORT_IN_USE), shown so it can be quoted when asking for help. */
  code: string;
  title?: string;
  /** Button label; the ticket's wording is "Try again". */
  actionLabel?: string;
  /** Use one of these: a click handler, or a link. */
  onAction?: () => void;
  href?: string;
  /** Runs before a link is followed (to save the form values). */
  onNavigate?: () => void;
};

/** The friendly error card used for every failure: message, code and a "Try again" button. */
export function ErrorCard({ message, code, title = "That didn't work", actionLabel = "Try again", onAction, href, onNavigate }: Props) {
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <span aria-hidden className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-xl font-bold text-white">
          !
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-3 break-words text-lg text-slate-800">{message}</p>
          <p className="mt-4 text-base text-slate-600">
            Error code: <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-900">{code}</code>
          </p>
          <div className="mt-6">
            {href ? (
              <Link href={href} onClick={onNavigate} className={buttonPrimary}>
                {actionLabel}
              </Link>
            ) : (
              <button type="button" onClick={onAction} className={buttonPrimary}>
                {actionLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
