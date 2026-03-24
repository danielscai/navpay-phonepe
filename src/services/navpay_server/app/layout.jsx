import "./globals.css";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import SideNav from "./components/SideNav.jsx";

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"]
});

const bodyFont = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600"]
});

export const metadata = {
  title: "NavPay 管理台",
  description: "NavPay dashboard"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="brand">NavPay</div>
            <SideNav />
          </aside>
          <main className="content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
