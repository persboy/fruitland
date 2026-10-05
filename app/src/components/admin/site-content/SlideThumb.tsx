"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Preview of an EXTERNAL image URL. It must fail gracefully: a broken or blocked
 * URL shows a placeholder instead of a broken-image icon. Remount with `key={src}`
 * when the URL changes so a previous failure never sticks.
 */
export function SlideThumb({ src, className }: { src: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span
        role="img"
        aria-label="تصویر قابل نمایش نیست"
        className={cn("flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300", className)}
      >
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external admin-entered URL: next/image would need a remotePatterns allow-list (no media infrastructure in this phase)
    <img
      src={src}
      alt="پیش‌نمایش تصویر اسلاید"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={cn("h-14 w-20 shrink-0 rounded-lg bg-gray-50 object-cover", className)}
    />
  );
}
