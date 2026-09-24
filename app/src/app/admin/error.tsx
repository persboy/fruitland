"use client";

import { AlertOctagon } from "lucide-react";
import { StateMessage, Button } from "@/components/ui";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StateMessage
      tone="error"
      icon={AlertOctagon}
      title="مشکلی پیش آمد"
      description="بارگذاری این بخش با خطا مواجه شد. دوباره تلاش کنید."
      action={
        <Button size="sm" onClick={reset}>
          تلاش مجدد
        </Button>
      }
    />
  );
}
