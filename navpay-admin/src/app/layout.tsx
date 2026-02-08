import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "NavPay Admin",
  description: "NavPay backoffice",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
