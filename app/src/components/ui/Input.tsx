import { type InputHTMLAttributes, forwardRef, useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Accessible name. Rendered visually hidden — the legacy design uses placeholders, not visible labels. */
  label: string;
  /** Leading icon shown inside the pill (right side in RTL). */
  icon?: LucideIcon;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, icon: Icon, error, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300"
            aria-hidden="true"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          className={cn(
            "w-full rounded-full border border-gray-200 bg-white py-3.5 pl-4 text-center text-sm font-bold text-gray-800 placeholder:font-normal placeholder:text-gray-400 focus:border-emerald-400",
            Icon ? "pr-11" : "pr-4",
            error && "border-red-300",
            className,
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-center text-xs font-medium text-red-500">
          {error}
        </p>
      )}
    </div>
  );
});
