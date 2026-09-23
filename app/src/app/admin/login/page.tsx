import { AdminLoginFlow } from "./AdminLoginFlow";

export const metadata = { title: "ورود مدیران — پرزبوی" };

export default function AdminLoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm pt-8">
      <AdminLoginFlow />
    </div>
  );
}
