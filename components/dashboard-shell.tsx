"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { classNames } from "@/lib/utils";
import { SignOutButton } from "@/components/sign-out-button";

type DashboardShellProps = {
  children: React.ReactNode;
};

const navItems = [
  { href: "/templates", label: "Templates" },
  { href: "/groups", label: "Groups" },
  { href: "/schedules", label: "Schedules" },
  { href: "/logs", label: "Logs" }
];

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          Auto Post MVP
        </Link>
        <p className="sidebar-copy">
          Quản lý template, group và lịch đăng Facebook bằng extension trên máy khách.
        </p>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={classNames("nav-link", pathname.startsWith(item.href) && "nav-link-active")}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <SignOutButton />
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
