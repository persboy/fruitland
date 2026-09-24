import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StateMessageProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** "error" uses the legacy red tile; "neutral" the emerald one. */
  tone?: "neutral" | "error";
  className?: string;
}

/**
 * Same look as the legacy ErrorState: tinted rounded-2xl icon tile, bold
 * title, muted description. Title states what happened, description says
 * what to do about it.
 */
export function StateMessage({ icon: Icon, title, description, action, tone = "neutral", className }: StateMessageProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 p-8 text-center", className)}>
      <span
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl",
          tone === "error" ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600",
        )}
      >
        <Icon className="h-7 w-7" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-extrabold text-gray-900">{title}</h2>
        {description && <p className="max-w-sm text-sm text-gray-400">{description}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">{action}</div>}
    </div>
  );
}
