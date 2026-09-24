import { ShieldCheck } from "lucide-react";
import { Card, StateMessage } from "@/components/ui";

export const metadata = { title: "پنل مدیریت | پرزبوی" };

export default function AdminHomePage() {
  return (
    <Card>
      <StateMessage icon={ShieldCheck} title="با موفقیت وارد شدید" />
    </Card>
  );
}
