"use client";

import { useCallback, useEffect, useState } from "react";
import { videoUrl } from "../lib/api";
import {
  BASELINE_IS_MEASURED,
  downloadName,
  formatDuration,
  formatPercent,
  repairCard,
  speedup,
  successDetail,
} from "../lib/metrics-view";
import type { Job } from "../lib/shared";
import { probeVideo, type VideoStatus } from "../lib/video-probe";
import { buttonPrimary } from "./ui";

const card = "rounded-2xl border border-slate-200 bg-white p-6 sm:p-8";
const cardLabel = "text-base font-semibold uppercase tracking-wide text-slate-600";

/** The browser ignores `download` on a cross-origin link, so fetch the file and save the blob. */
function DownloadLink({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = videoUrl(job.id);
  const name = downloadName(job.id, job.run?.videoPath);

  async function save(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <a
        href={url}
        download={name}
        onClick={save}
        className={buttonPrimary}
      >
        {busy ? "Downloading…" : "Download video"}
      </a>
      {failed && <span className="text-base text-red-700">The download failed. Please try again.</span>}
    </div>
  );
}

/** Checks the video on mount (and again if the player errors); only a 404 counts as missing. */
function useVideoStatus(url: string): [VideoStatus, () => void] {
  const [status, setStatus] = useState<VideoStatus>("ok");
  const check = useCallback(() => {
    void probeVideo(url).then(setStatus);
  }, [url]);
  useEffect(check, [check]);
  return [status, check];
}

function VideoMissing() {
  return (
    <div role="status" className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl border border-slate-300 bg-slate-100 p-6 text-center">
      <p className="text-3xl font-semibold text-slate-900">Video not available</p>
      <p className="mt-3 max-w-md text-lg text-slate-700">The recording for this demo could not be found, so there is nothing to play or download.</p>
    </div>
  );
}

export function Results({ job }: { job: Job }) {
  const m = job.metrics;
  const x = m ? speedup(m) : undefined;
  const repair = m ? repairCard(m) : undefined;
  const [videoStatus, recheckVideo] = useVideoStatus(videoUrl(job.id));

  return (
    <section aria-label="Results" className="space-y-8">
      {videoStatus === "missing" ? (
        <VideoMissing />
      ) : (
        <>
          <video className="w-full rounded-2xl border border-slate-200 bg-black" controls src={videoUrl(job.id)} onError={recheckVideo} />
          <DownloadLink job={job} />
        </>
      )}

      {m && repair && (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className={`${card} sm:col-span-2`}>
            <p className={cardLabel}>Time to demo</p>
            <p className="mt-2 break-words text-5xl font-bold tracking-tight text-accent-700 sm:text-7xl">{formatDuration(m.timeToDemoSec)}</p>
            <p className="mt-4 text-xl text-slate-700">
              vs <span className="font-semibold text-slate-900">{formatDuration(m.manualBaselineSec)}</span> by hand{" "}
              <span className="text-base text-slate-600">({BASELINE_IS_MEASURED ? "measured" : "assumed"})</span>
              {x !== undefined && x > 1 && <span className="ml-2 font-medium text-accent-700">{x}× faster</span>}
            </p>
          </div>
          <div className={card}>
            <p className={cardLabel}>Plan success rate</p>
            <p className="mt-3 text-4xl font-semibold">{formatPercent(m.planSuccessRate)}</p>
            <p className="mt-2 text-base text-slate-600">{successDetail(m)}</p>
          </div>
          <div className={card}>
            <p className={cardLabel}>Steps self-repaired</p>
            <p className="mt-3 text-4xl font-semibold">{repair.headline}</p>
            <p className="mt-2 text-base text-slate-600">{repair.detail}</p>
          </div>
        </div>
      )}

      {job.plan && (
        <details className="rounded-2xl border border-slate-200 bg-white px-6 py-4">
          <summary className="cursor-pointer select-none text-lg font-semibold">Plan JSON</summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-sm leading-6 text-slate-100">
            {JSON.stringify(job.plan, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
