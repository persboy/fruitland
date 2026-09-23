"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut, WifiOff } from "lucide-react";
import { ApiClientError } from "@/lib/client/apiClient";
import {
  ROLE_LABELS,
  fetchCurrentUser,
  isAdminRole,
  logoutCurrentSession,
  type SessionUser,
} from "@/lib/client/adminAuth";
import { Button, Skeleton, StateMessage } from "@/components/ui";

type GateState = { status: "loading" } | { status: "network-error" } | { status: "ok"; user: SessionUser };

/**
 * Client-side gate for every page under /admin (except /admin/login). The API
 * remains the real authority — this only decides what the browser shows.
 * Unauthenticated or non-admin visitors are sent to the login page.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (!isAdminRole(user.role)) {
          router.replace("/admin/login");
          return;
        }
        setState({ status: "ok", user });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403 || err.status === 404)) {
          router.replace("/admin/login");
          return;
        }
        setState({ status: "network-error" });
      });
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logoutCurrentSession();
    } catch {
      // Logout is idempotent server-side; even on failure we leave the panel.
    }
    router.replace("/admin/login");
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="در حال بارگذاری">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (state.status === "network-error") {
    return (
      <StateMessage
        icon={WifiOff}
        title="ارتباط با سرور برقرار نشد"
        description="اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید."
        action={<Button onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}>تلاش دوباره</Button>}
      />
    );
  }

  const { user } = state;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <div className="flex flex-col">
          {/* §17: until a name is registered, use a generic identity, never an invented one. */}
          <span className="text-base font-medium text-ink">{user.name?.trim() || "کاربر"}</span>
          <span className="text-sm text-muted">{ROLE_LABELS[user.role] ?? user.role}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={handleLogout} isLoading={isLoggingOut}>
          <LogOut className="size-4" aria-hidden="true" />
          خروج
        </Button>
      </div>
      {children}
    </div>
  );
}
