import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StateMessageProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Per the frontend-design skill's writing guidance: title states what
 * happened, description says what to do about it — never vague, never
 * apologetic on the system's behalf.
 */
export function StateMessage({ icon: Icon, title, description, action, className }: StateMessageProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <Icon className="size-10 text-muted" aria-hidden="true" />
      <p className="text-lg font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
