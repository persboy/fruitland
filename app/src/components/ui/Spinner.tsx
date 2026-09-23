import { cn } from "@/lib/cn";

export function Spinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const dimension = { sm: "size-4", md: "size-6", lg: "size-8" }[size];
  return (
    <span
      role="status"
      aria-label="در حال بارگذاری"
      className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", dimension, className)}
    />
  );
}
