"use client";

import { TriangleAlert } from "lucide-react";
import { StateMessage, Button } from "@/components/ui";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StateMessage
      icon={TriangleAlert}
      title="مشکلی پیش آمد"
      description="بارگذاری این بخش با خطا مواجه شد. دوباره تلاش کنید."
      action={
        <Button variant="secondary" size="sm" onClick={reset}>
          تلاش دوباره
        </Button>
      }
    />
  );
}
