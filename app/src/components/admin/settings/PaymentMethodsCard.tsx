import { BadgeCheck, Wallet } from "lucide-react";
import { Card } from "@/components/ui";
import { CardTitle } from "./fields";

/** Read-only: cash/card-on-delivery is the only approved payment method (Project Instructions §8). */
export function PaymentMethodsCard() {
  return (
    <Card>
      <div className="mb-3">
        <CardTitle icon={Wallet}>روش‌های پرداخت</CardTitle>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 p-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">پرداخت در محل (COD)</p>
          <p className="text-xs text-gray-500">پرداخت نقدی یا کارت‌خوان هنگام تحویل</p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white">
          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
          فعال
        </span>
      </div>
    </Card>
  );
}
