"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getHealth, type Health } from "./api";

export type HealthState = {
  /** Undefined until the first answer, and when the API could not be reached. */
  health: Health | undefined;
  /** Set when GET /api/health itself failed (the API is down or answered nonsense). */
  unreachable: { code: string; message: string } | undefined;
  loading: boolean;
  recheck: () => void;
};

/** Calls GET /api/health once on mount, and again on `recheck`. Never throws. */
export function useHealth(): HealthState {
  const [state, setState] = useState<Omit<HealthState, "recheck">>({ health: undefined, unreachable: undefined, loading: true });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    getHealth().then(
      (health) => {
        if (!cancelled) setState({ health, unreachable: undefined, loading: false });
      },
      (e: unknown) => {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : undefined;
        setState({
          health: undefined,
          unreachable: { code: err?.code ?? "unknown_error", message: err?.message ?? "The health check failed." },
          loading: false,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [round]);

  const recheck = useCallback(() => setRound((r) => r + 1), []);
  return { ...state, recheck };
}
