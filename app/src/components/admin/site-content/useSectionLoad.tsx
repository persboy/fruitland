"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, LockKeyhole, RotateCw } from "lucide-react";
import { Button, Card, Skeleton, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

/** Loads one Site Content section and classifies the failure (401 / 403 / other) exactly like the Categories page. */
export function useSectionLoad<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 403) setState({ status: "forbidden" });
        else if (err instanceof ApiClientError && err.status === 401) setState({ status: "unauthenticated" });
        else setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fetcher is a stable module function; only `attempt` should re-run the load
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const setData = useCallback((update: (data: T) => T) => {
    setState((s) => (s.status === "ready" ? { status: "ready", data: update(s.data) } : s));
  }, []);

  return { state, reload, setData };
}

/** Renders every non-ready state (loading / error / forbidden / session expired); renders nothing when ready. */
export function SectionState<T>({ state, noun, onRetry }: { state: LoadState<T>; noun: string; onRetry: () => void }): ReactNode {
  if (state.status === "loading") {
    return (
      <Card>
        <div role="status" aria-label={`در حال دریافت ${noun}`} className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            در حال دریافت اطلاعات...
          </p>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card>
        <StateMessage
          tone="error"
          icon={AlertCircle}
          title={`دریافت ${noun} انجام نشد`}
          description={state.message}
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              تلاش دوباره
            </Button>
          }
        />
      </Card>
    );
  }
  if (state.status === "forbidden") {
    return (
      <Card>
        <StateMessage tone="error" icon={LockKeyhole} title="دسترسی ندارید" description={`شما اجازه‌ی مدیریت ${noun} را ندارید.`} />
      </Card>
    );
  }
  if (state.status === "unauthenticated") {
    return (
      <Card>
        <StateMessage
          tone="error"
          icon={LockKeyhole}
          title="نشست شما منقضی شده است"
          description="برای ادامه دوباره وارد شوید."
          action={
            <Link
              href={`/admin/login?returnTo=${encodeURIComponent("/admin/site-content")}`}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600"
            >
              ورود
            </Link>
          }
        />
      </Card>
    );
  }
  return null;
}

export const StatusBadge = ({ active, on = "فعال", off = "غیرفعال" }: { active: boolean; on?: string; off?: string }) => (
  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${active ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
    {active ? on : off}
  </span>
);
