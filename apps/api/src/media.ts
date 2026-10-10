import { createReadStream, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

export type ByteRange = { start: number; end: number };

/**
 * Parse a single-range `Range: bytes=...` header against a file size.
 * Returns the range, "unsatisfiable" (send 416), or undefined (ignore it and send the whole file,
 * which RFC 9110 allows for headers we do not handle, such as multiple ranges).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return undefined;
  if (size === 0) return "unsatisfiable";

  if (a === "") {
    // Suffix range: the last N bytes.
    const n = Number(b);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** True when `file` resolves to a path inside `dir` (no escaping the job folder). */
export const isInside = (dir: string, file: string): boolean => {
  const rel = relative(resolve(dir), resolve(dir, file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** Size of a regular file, or undefined if it is missing or not a file. */
export const fileSize = (file: string): number | undefined => {
  try {
    const st = statSync(file);
    return st.isFile() ? st.size : undefined;
  } catch {
    return undefined;
  }
};

/** Send a file with Range support (200 full, 206 partial, 416 unsatisfiable). */
export function sendFile(req: FastifyRequest, reply: FastifyReply, file: string, size: number): FastifyReply {
  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  reply.header("Content-Type", type).header("Accept-Ranges", "bytes").header("Cache-Control", "no-cache");

  const range = parseRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    return reply.code(416).header("Content-Range", `bytes */${size}`).send();
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const length = size === 0 ? 0 : end - start + 1;
  reply.header("Content-Length", length);
  if (range) reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`);
  else reply.code(200);

  if (length === 0) return reply.send();
  // For HEAD, Fastify's automatic HEAD route drops the body but keeps these headers.
  return reply.send(createReadStream(file, { start, end }));
}
