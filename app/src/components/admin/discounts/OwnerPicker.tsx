"use client";

import { useEffect, useState } from "react";
import { Search, UserCheck } from "lucide-react";
import type { CustomerListItemDto } from "@fruitland/shared";
import { Button } from "@/components/ui";
import { fetchCustomers } from "@/lib/client/adminCustomers";
import { errorMessage } from "@/lib/client/adminAuth";

const SEARCH_DEBOUNCE_MS = 350;
const RESULT_LIMIT = 8;

export interface PickedOwner {
  id: string;
  label: string;
}

const labelOf = (c: CustomerListItemDto) => [[c.firstName, c.lastName].filter(Boolean).join(" ") || "بدون نام", c.phone].join(" — ");

type Result = { key: string; items: CustomerListItemDto[] } | { key: string; error: string };

/**
 * Chooses the owner of a PERSONAL code from the existing customers endpoint
 * (`GET /admin/customers?search=&status=active`) — only active customers are offered,
 * and the server re-checks role + isActive when the code is created.
 */
export function OwnerPicker({ value, onChange }: { value: PickedOwner | null; onChange: (owner: PickedOwner | null) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    fetchCustomers({ page: 1, limit: RESULT_LIMIT, search: debounced, status: "active" })
      .then(({ data }) => {
        if (!cancelled) setResult({ key: debounced, items: data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key: debounced, error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  if (value) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">مشتری مالک کد</p>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
          <UserCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-800">{value.label}</span>
          <Button type="button" size="xs" variant="secondary" className="me-auto" onClick={() => onChange(null)}>
            تغییر مشتری
          </Button>
        </div>
      </div>
    );
  }

  const settled = trimmed !== "" && result !== null && result.key === trimmed;
  return (
    <div>
      <label htmlFor="discount-owner-search" className="mb-1 block text-xs font-medium text-gray-500">
        مشتری مالک کد (جست‌وجوی نام یا شماره موبایل)
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
        <input
          id="discount-owner-search"
          type="search"
          value={query}
          maxLength={50}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-400">فقط مشتریان فعال نمایش داده می‌شوند.</p>

      {trimmed !== "" && !settled && (
        <p role="status" className="mt-2 text-xs text-gray-400">
          در حال جست‌وجو...
        </p>
      )}
      {settled && result && "error" in result && (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-500">
          {result.error}
        </p>
      )}
      {settled && result && "items" in result && result.items.length === 0 && <p className="mt-2 text-xs text-gray-500">مشتری فعالی با این مشخصات پیدا نشد.</p>}
      {settled && result && "items" in result && result.items.length > 0 && (
        <ul aria-label="نتایج جست‌وجوی مشتری" className="mt-2 divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {result.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChange({ id: c.id, label: labelOf(c) })}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-50"
              >
                <span>{labelOf(c)}</span>
                <span className="text-xs font-bold text-emerald-600">انتخاب</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
