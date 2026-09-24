"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Menu } from "lucide-react";
import { displayNameOf, type SessionUser } from "@/lib/client/adminAuth";

export function AdminTopbar(props: {
  onMenuClick: () => void;
  onLogout: () => Promise<void>;
  title: string;
  subtitle?: string;
  user: SessionUser;
}) {
  const { onMenuClick, onLogout, title, subtitle, user } = props;
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the popup on outside click (not a fixed overlay: the header's backdrop-blur would clip it).
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const displayName = displayNameOf(user);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-gray-100 bg-white/80 px-4 backdrop-blur sm:px-6">
      <button
        onClick={onMenuClick}
        className="cursor-pointer rounded-lg p-2 text-gray-500 hover:bg-gray-50 lg:hidden"
        aria-label="باز کردن منو"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-bold text-gray-900 sm:text-base">{title}</h1>
        {subtitle && <p className="hidden truncate text-xs text-gray-400 sm:block">{subtitle}</p>}
      </div>

      <div className="relative mr-auto" ref={containerRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex cursor-pointer items-center gap-2 rounded-full border border-gray-100 py-1 pl-2.5 pr-1 hover:bg-gray-50"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
            {displayName.slice(0, 2)}
          </div>
          <span className="hidden text-xs font-medium text-gray-600 sm:block">{displayName}</span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-gray-400 sm:block" aria-hidden="true" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full z-40 mt-2 w-48 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg shadow-gray-200/60"
          >
            <div className="border-b border-gray-50 px-4 py-3">
              <p className="truncate text-xs font-bold text-gray-900">{displayName}</p>
              <p className="mt-0.5 text-[11px] text-gray-400" dir="ltr">
                {user.phone}
              </p>
            </div>
            <button
              role="menuitem"
              onClick={async () => {
                setLoggingOut(true);
                await onLogout();
              }}
              disabled={loggingOut}
              className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {loggingOut ? "در حال خروج..." : "خروج از حساب"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
