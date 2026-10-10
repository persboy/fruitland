import { OrderDetail } from "@/components/admin/orders/OrderDetail";

export const metadata = { title: "جزئیات سفارش | پرزبوی" };

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}
