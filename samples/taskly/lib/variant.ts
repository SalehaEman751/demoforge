// Seeded-failure switch for the self-heal demo (ticket E1-5). Not a product feature.
const KEY = "taskly:variant";

/** Reads `?variant=` from the current URL (any page) and remembers it for the tab session. */
export function captureVariant(): void {
  try {
    const v = new URLSearchParams(window.location.search).get("variant");
    if (v === null) return;
    if (v === "renamed") window.sessionStorage.setItem(KEY, v);
    else window.sessionStorage.removeItem(KEY); // any other value resets to default
  } catch {
    /* storage unavailable: variant simply stays off */
  }
}

export function isRenamedVariant(): boolean {
  captureVariant(); // covers landing directly on /dashboard?variant=renamed
  try {
    return window.sessionStorage.getItem(KEY) === "renamed";
  } catch {
    return false;
  }
}
