import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// IRANYekanX (licensed, purchased) — same font and weights as the legacy project.
// Self-hosted via next/font/local: no external font request. See fonts/iranyekanx/FontLicense.txt.
const iranYekanX = localFont({
  src: [
    { path: "./fonts/iranyekanx/IRANYekanX-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/iranyekanx/IRANYekanX-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/iranyekanx/IRANYekanX-DemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/iranyekanx/IRANYekanX-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/iranyekanx/IRANYekanX-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-iranyekanx",
  display: "swap",
});

export const metadata: Metadata = {
  title: "پرزبوی | میوه و سبزیجات آنلاین",
  description: "فروشگاه آنلاین میوه و سبزیجات پرزبوی",
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className={iranYekanX.variable}>
      <body className="font-sans antialiased text-gray-800">{children}</body>
    </html>
  );
}
