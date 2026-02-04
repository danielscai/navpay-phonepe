"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "用户列表" },
  { href: "/orders", label: "订单列表" }
];

export default function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {links.map((link) => {
        const active = link.href === "/"
          ? pathname === "/" || pathname.startsWith("/users")
          : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="nav-link"
            data-active={active}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
