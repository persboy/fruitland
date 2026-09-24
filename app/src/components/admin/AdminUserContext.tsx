"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/client/adminAuth";

interface AdminUserContextValue {
  user: SessionUser;
  /** Merge changes into the signed-in admin so the sidebar/topbar update immediately (e.g. after editing the name). */
  updateUser: (patch: Partial<SessionUser>) => void;
}

export const AdminUserContext = createContext<AdminUserContextValue | null>(null);

export function useAdminUser(): AdminUserContextValue {
  const ctx = useContext(AdminUserContext);
  if (!ctx) throw new Error("useAdminUser must be used inside <AdminShell>");
  return ctx;
}
