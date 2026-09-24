import { AlertCircle, Loader2 } from "lucide-react";

export function LoadingLine() {
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-gray-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      در حال دریافت اطلاعات...
    </p>
  );
}

export function LoadErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {message}
      </p>
      <button onClick={onRetry} className="cursor-pointer text-xs font-bold text-gray-500 underline hover:text-emerald-600">
        تلاش دوباره
      </button>
    </div>
  );
}
