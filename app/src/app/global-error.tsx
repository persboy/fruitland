"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
          <p className="text-lg font-medium text-ink">مشکلی در بارگذاری برنامه پیش آمد</p>
          <button
            onClick={reset}
            className="h-11 rounded-md bg-brand-500 px-4 text-white hover:bg-brand-600"
          >
            تلاش دوباره
          </button>
        </div>
      </body>
    </html>
  );
}
