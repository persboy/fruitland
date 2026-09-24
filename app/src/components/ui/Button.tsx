import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  /** md = the pill call-to-action (forms, login); sm = compact rounded-xl button (toolbars, dialogs). */
  size?: "sm" | "md";
  isLoading?: boolean;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-emerald-500 text-white hover:bg-emerald-600",
  secondary: "border border-gray-200 text-gray-600 hover:bg-gray-50",
  danger: "bg-red-500 text-white hover:bg-red-600",
  ghost: "text-gray-600 hover:bg-gray-50",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "rounded-full px-5 py-3.5 text-sm font-extrabold",
  sm: "rounded-xl px-4 py-2.5 text-sm font-bold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", isLoading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {isLoading && <Spinner size="sm" />}
      {children}
    </button>
  );
});
