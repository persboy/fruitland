"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/client/adminAuth";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Loads one resource on mount. `fetcher` must be a stable (module-level) function. */
export function useLoadable<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, attempt]);

  const setData = useCallback((data: T) => setState({ status: "ready", data }), []);
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, setData, reload };
}
