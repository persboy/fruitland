import { MapPinOff } from "lucide-react";
import { StateMessage } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center">
      <StateMessage icon={MapPinOff} title="این صفحه پیدا نشد" description="آدرس را بررسی کنید یا به صفحه‌ی اصلی بازگردید." />
    </div>
  );
}
