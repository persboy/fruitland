import { Suspense } from "react";
import { ProductsManager } from "@/components/admin/products/ProductsManager";

export const metadata = { title: "محصولات | پرزبوی" };

export default function AdminProductsPage() {
  // useSearchParams (URL-driven list state) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ProductsManager />
    </Suspense>
  );
}
