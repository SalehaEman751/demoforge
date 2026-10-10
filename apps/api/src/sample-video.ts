import { execFile } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fileSize } from "./media.js";

/** Sample clip used as every mock job's video: apps/api/.cache/demo.mp4. */
export const SAMPLE_VIDEO_FILE = fileURLToPath(new URL("../.cache/demo.mp4", import.meta.url));

/** 5 s, 1280x720 test pattern, H.264 yuv420p, moov atom first so browsers can play and seek it, no audio. */
export const sampleVideoArgs = (out: string): string[] => [
  "-hide_banner",
  "-loglevel", "error",
  "-y",
  "-f", "lavfi",
  "-i", "testsrc=duration=5:size=1280x720:rate=30",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-an",
  "-f", "mp4",
  out,
];

export type EnsureSampleOptions = {
  file?: string;
  ffmpegBin?: string;
  log?: (msg: string) => void;
  timeoutMs?: number;
};

/**
 * Make sure the sample video exists, generating it with ffmpeg when missing.
 * Never throws: if ffmpeg is missing or fails it logs one warning and returns false.
 */
export async function ensureSampleVideo(opts: EnsureSampleOptions = {}): Promise<boolean> {
  const file = opts.file ?? SAMPLE_VIDEO_FILE;
  const log = opts.log ?? ((m: string) => console.warn(m));
  if (fileSize(file)) return true;

  // Write to a temp name and rename, so a half-written file is never served.
  const tmp = `${file}.${process.pid}.tmp.mp4`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      execFile(opts.ffmpegBin ?? "ffmpeg", sampleVideoArgs(tmp), { timeout: opts.timeoutMs ?? 60_000 }, (err, _out, stderr) => {
        if (!err) return resolve();
        const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
        reject(new Error(missing ? "ffmpeg is not installed" : stderr.trim().split("\n").at(-1) || err.message));
      });
    });
    if (!fileSize(tmp)) throw new Error("ffmpeg produced an empty file");
    renameSync(tmp, file);
    return true;
  } catch (e) {
    rmSync(tmp, { force: true });
    log(
      `[api] WARNING: could not create the mock sample video at ${file} (${e instanceof Error ? e.message : String(e)}). ` +
        "Mock jobs will have no playable video. Install ffmpeg and restart to fix this.",
    );
    return false;
  }
}
