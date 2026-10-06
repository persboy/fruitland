import { Suspense } from "react";
import { CustomersManager } from "@/components/admin/customers/CustomersManager";

export const metadata = { title: "مشتریان | پرزبوی" };

export default function AdminCustomersPage() {
  // useSearchParams (URL-driven list state) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <CustomersManager />
    </Suspense>
  );
}
