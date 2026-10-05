"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, WifiOff } from "lucide-react";
import { ApiClientError } from "@/lib/client/apiClient";
import { fetchCurrentUser, isAdminRole, logoutCurrentSession, type SessionUser } from "@/lib/client/adminAuth";
import { Button, StateMessage } from "@/components/ui";
import { AdminUserContext } from "./AdminUserContext";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";

type GateState = { status: "loading" } | { status: "network-error" } | { status: "ok"; user: SessionUser };

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/admin": { title: "میز کار ادمین", subtitle: "خلاصه عملکرد امروز غرفه" },
  "/admin/categories": { title: "دسته‌بندی‌ها", subtitle: "مدیریت دسته‌بندی محصولات" },
  "/admin/site-content": { title: "محتوای سایت", subtitle: "صفحات ثابت، سؤالات متداول، اسلایدها و شبکه‌های اجتماعی" },
  "/admin/settings": { title: "تنظیمات", subtitle: "مدیریت حساب، فروشگاه و ارسال" },
};

/**
 * Client-side gate + chrome (sidebar/topbar) for every page under /admin
 * except /admin/login. The API remains the real authority — this only decides
 * what the browser shows. Unauthenticated or non-admin visitors are sent to
 * the login page (with returnTo, as in the legacy project).
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const toLogin = () => router.replace(`/admin/login?returnTo=${encodeURIComponent(pathname)}`);
    fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (!isAdminRole(user.role)) {
          toLogin();
          return;
        }
        setState({ status: "ok", user });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403 || err.status === 404)) {
          toLogin();
          return;
        }
        setState({ status: "network-error" });
      });
    return () => {
      cancelled = true;
    };
  }, [router, pathname, attempt]);

  async function handleLogout() {
    try {
      await logoutCurrentSession();
    } catch {
      // Logout is idempotent server-side; even on failure we leave the panel.
    }
    router.replace("/admin/login");
  }

  if (state.status === "network-error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F9F8]">
        <StateMessage
          tone="error"
          icon={WifiOff}
          title="ارتباط با سرور برقرار نشد"
          description="اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید."
          action={
            <Button
              size="sm"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              تلاش دوباره
            </Button>
          }
        />
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F9F8]" role="status" aria-label="در حال بارگذاری">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  const meta = pageMeta[pathname] ?? { title: "پنل مدیریت", subtitle: "" };
  const updateUser = (patch: Partial<SessionUser>) =>
    setState((prev) => (prev.status === "ok" ? { status: "ok", user: { ...prev.user, ...patch } } : prev));
  return (
    <AdminUserContext.Provider value={{ user: state.user, updateUser }}>
    <div className="flex min-h-screen bg-[#F7F9F8]">
      <AdminSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} user={state.user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          onMenuClick={() => setDrawerOpen(true)}
          onLogout={handleLogout}
          title={meta.title}
          subtitle={meta.subtitle}
          user={state.user}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
    </AdminUserContext.Provider>
  );
}
