import { Suspense } from "react";
import { CouriersManager } from "@/components/admin/couriers/CouriersManager";

export const metadata = { title: "پیک‌ها | پرزبوی" };

export default function AdminCouriersPage() {
  // useSearchParams (URL-driven list state) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <CouriersManager />
    </Suspense>
  );
}
