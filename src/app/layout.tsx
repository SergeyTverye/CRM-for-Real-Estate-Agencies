import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CRM «Магазин недвижимости»", template: "%s — CRM" },
  description: "CRM-система агентства недвижимости",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
