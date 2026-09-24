"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F7F9F8] p-6 text-center">
          <p className="text-base font-extrabold text-gray-900">مشکلی در بارگذاری برنامه پیش آمد</p>
          <button
            onClick={reset}
            className="cursor-pointer rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-600"
          >
            تلاش دوباره
          </button>
        </div>
      </body>
    </html>
  );
}
