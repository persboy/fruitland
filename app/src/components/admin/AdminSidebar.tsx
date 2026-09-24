"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Leaf, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, type SessionUser } from "@/lib/client/adminAuth";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Only pages that actually exist are listed (no dead links, MASTER-PROMPT §38).
// Each Phase 4 page adds its own entry here when it is built.
const navItems: NavItem[] = [{ href: "/admin", label: "میز کار", icon: LayoutDashboard }];

export function AdminSidebar({ open, onClose, user }: { open: boolean; onClose: () => void; user: SessionUser }) {
  const pathname = usePathname();
  const adminName = user.displayName || "ادمین";
  const adminRole = ROLE_LABELS[user.role] ?? "ادمین";

  return (
    <>
      {open && (
        <button
          aria-label="بستن منو"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-72 flex-col border-l border-gray-100 bg-white transition-transform duration-300 ease-out lg:static lg:z-auto lg:flex lg:w-64 lg:shrink-0 lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-100 px-5">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-200">
              <Leaf className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
            </span>
            <span className="text-[15px] font-bold text-gray-900">
              سبزیجات و میوه<span className="text-emerald-500"> فرش</span>
            </span>
          </Link>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600 lg:hidden"
            aria-label="بستن منو"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const isActive = item.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "bg-emerald-50 text-emerald-600" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0",
                    isActive ? "text-emerald-500" : "text-gray-400 group-hover:text-gray-500",
                  )}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
                {isActive && <span className="mr-auto h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              {adminName.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-800">{adminName}</p>
              <p className="truncate text-xs text-gray-400">{adminRole}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
