import { Suspense } from "react";
import { DiscountCodesManager } from "@/components/admin/discounts/DiscountCodesManager";

export const metadata = { title: "کدهای تخفیف | پرزبوی" };

export default function AdminDiscountsPage() {
  // useSearchParams (URL-driven list state) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <DiscountCodesManager />
    </Suspense>
  );
}
