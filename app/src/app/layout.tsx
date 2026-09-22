import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "پرزبوی | میوه و سبزیجات آنلاین",
  description: "فروشگاه آنلاین میوه و سبزیجات پرزبوی",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
