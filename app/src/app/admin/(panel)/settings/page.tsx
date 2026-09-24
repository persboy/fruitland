import { DeliverySettingsCard } from "@/components/admin/settings/DeliverySettingsCard";
import { PaymentMethodsCard } from "@/components/admin/settings/PaymentMethodsCard";
import { ProfileCard } from "@/components/admin/settings/ProfileCard";
import { StoreInfoCard } from "@/components/admin/settings/StoreInfoCard";

export const metadata = { title: "تنظیمات | پرزبوی" };

export default function AdminSettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900">تنظیمات</h2>
        <p className="text-sm text-gray-400">مدیریت حساب، فروشگاه و ارسال</p>
      </div>

      <ProfileCard />
      <StoreInfoCard />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <DeliverySettingsCard />
        <PaymentMethodsCard />
      </div>
    </div>
  );
}
