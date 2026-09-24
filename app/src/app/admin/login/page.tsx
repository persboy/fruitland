import { Suspense } from "react";
import { AdminLoginClient } from "./AdminLoginClient";

export const metadata = { title: "ورود به پنل مدیریت | پرزبوی" };

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginClient />
    </Suspense>
  );
}
