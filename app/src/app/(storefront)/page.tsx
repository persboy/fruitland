import { Sprout } from "lucide-react";
import { StateMessage } from "@/components/ui";

export default function HomePage() {
  return (
    <StateMessage
      icon={Sprout}
      title="فروشگاه در حال ساخت است"
      description="صفحه‌ی اصلی فروشگاه در فاز ۶ نقشه‌ی راه پیاده‌سازی می‌شود."
      className="flex-1 justify-center"
    />
  );
}
