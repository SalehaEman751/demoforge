import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";

export const FINAL_FRAME_HOLD_SEC = 1.5;
const FFMPEG_TIMEOUT_MS = 120_000;

export type ConvertResult = { ok: true } | { ok: false; reason: string };

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/**
 * Converts `webmPath` to an H.264 mp4 at `mp4Path`, holding the last frame for 1.5s.
 * Never throws: a missing ffmpeg, a non-zero exit, a timeout or an empty output all return
 * `{ ok: false }` and leave no partial mp4 behind, so the caller can keep the webm.
 */
export async function convertToMp4(webmPath: string, mp4Path: string, ffmpegBin = "ffmpeg"): Promise<ConvertResult> {
  if ((await sizeOf(webmPath)) === 0) return { ok: false, reason: `no recording to convert at ${webmPath}` };

  const args = [
    "-nostdin",
    "-y",
    "-loglevel", "error",
    "-i", webmPath,
    "-vf", `tpad=stop_mode=clone:stop_duration=${FINAL_FRAME_HOLD_SEC}`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "23",
    "-movflags", "+faststart",
    "-an",
    mp4Path,
  ];

  const failure = await new Promise<string | null>((resolve) => {
    execFile(ffmpegBin, args, { timeout: FFMPEG_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (!err) return resolve(null);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return resolve("ffmpeg not found");
      const detail = String(stderr).trim().split("\n").pop() ?? "";
      resolve(`ffmpeg failed: ${detail || err.message}`);
    });
  });

  if (failure === null && (await sizeOf(mp4Path)) > 0) return { ok: true };
  await rm(mp4Path, { force: true });
  return { ok: false, reason: failure ?? "ffmpeg produced an empty mp4" };
}
