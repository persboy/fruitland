import { Suspense } from "react";
import { OrdersManager } from "@/components/admin/orders/OrdersManager";

export const metadata = { title: "سفارش‌ها | پرزبوی" };

export default function AdminOrdersPage() {
  // useSearchParams (URL-driven list state) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <OrdersManager />
    </Suspense>
  );
}
