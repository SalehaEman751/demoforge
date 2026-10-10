export type VideoStatus = "ok" | "missing";

/**
 * Asks the API whether the video exists (HEAD, so nothing is downloaded). Only a 404 means
 * "missing": any other answer, or no answer, leaves the player to deal with it.
 */
export async function probeVideo(url: string, doFetch: typeof fetch = fetch): Promise<VideoStatus> {
  try {
    const res = await doFetch(url, { method: "HEAD" });
    return res.status === 404 ? "missing" : "ok";
  } catch {
    return "ok";
  }
}
