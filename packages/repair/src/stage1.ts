import type { ElementInventory } from "@demoforge/shared";

type Target = { role: string; name: string };

const SAME_ROLE_MIN = 0.5; // a typo or a partly renamed label
const OTHER_ROLE_MIN = 0.8; // wrong role is only believed when the name is nearly identical

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** 0..1. The better of character similarity and the share of words the shorter name has in common. */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const chars = 1 - editDistance(x, y) / Math.max(x.length, y.length);
  const xs = new Set(x.split(" "));
  const ys = y.split(" ");
  const common = ys.filter((w) => xs.has(w)).length;
  const words = common / Math.min(xs.size, ys.length);
  return Math.max(chars, words);
}

/**
 * Stage 1: pure string matching against the inventory, no model. Returns the corrected target,
 * or null if the target already exists as written, nothing is close enough, or two candidates tie.
 */
export function stage1Match(target: Target, inventory: ElementInventory): Target | null {
  const seen = new Map<string, { role: string; name: string; score: number }>();
  for (const page of inventory.pages) {
    for (const el of page.elements) {
      if (el.role === target.role && norm(el.name) === norm(target.name)) return null; // not a naming problem
      if (el.role === "heading" && target.role !== "heading") continue; // headings are never click or fill targets
      const score = similarity(target.name, el.name);
      if (score < (el.role === target.role ? SAME_ROLE_MIN : OTHER_ROLE_MIN)) continue;
      seen.set(`${el.role}\u0000${el.name}`, { role: el.role, name: el.name, score });
    }
  }
  const ranked = [...seen.values()].sort(
    (a, b) => b.score - a.score || Number(b.role === target.role) - Number(a.role === target.role),
  );
  const [best, second] = ranked;
  if (!best) return null;
  if (second && second.score === best.score && (second.role === target.role) === (best.role === target.role)) return null;
  return { role: best.role, name: best.name };
}
