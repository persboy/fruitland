import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { AlertCircle, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/cn";

// Same look as the legacy settings forms: rounded-xl inputs with a small label above.
const controlClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50 disabled:text-gray-400";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(function Field(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-gray-500">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(controlClass, error && "border-red-300", className)}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-[11px] font-medium text-red-500">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${inputId}-hint`} className="mt-1 text-[11px] text-gray-400">
            {hint}
          </p>
        )
      )}
    </div>
  );
});

export function TextAreaField({
  label,
  className,
  ...props
}: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-500">
        {label}
      </label>
      <textarea id={id} rows={3} className={cn(controlClass, "resize-none", className)} {...props} />
    </div>
  );
}

export function InfoRow({ label, value, ltr, full }: { label: string; value: ReactNode; ltr?: boolean; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p dir={ltr ? "ltr" : undefined} className={cn("mt-0.5 text-sm font-semibold text-gray-800", ltr && "text-right")}>
        {value}
      </p>
    </div>
  );
}

export function CardTitle({ icon: Icon, children }: { icon: typeof BadgeCheck; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
      <Icon className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      {children}
    </p>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

export function InlineSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
      <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
