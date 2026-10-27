"use client";

import { CalendarDays, GraduationCap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./AppNav.module.css";

const LINKS = [
  { href: "/", label: "Schools", icon: GraduationCap },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
] as const;

/** The app's one bar: name, the two places there are to be, and the theme. */
export function AppNav() {
  const pathname = usePathname();

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          School planner
        </Link>

        <nav className={styles.links} aria-label="Main">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={styles.link}
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
                data-tour={link.href === "/calendar" ? "calendar" : undefined}
              >
                <link.icon
                  className={styles.linkIcon}
                  size={15}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
