"use client";

import { useEffect, useRef } from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section";
};

/**
 * Fades its children up the first time they scroll into view, then leaves
 * them be. One shared component so every reveal in the app moves alike.
 *
 * It marks the element itself (data-shown) rather than keeping React state:
 * the reveal is a one-way trip the browser reports, and nothing else renders
 * from it.
 */
export function Reveal({ children, className, as: Tag = "div" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => el.setAttribute("data-shown", "");
    // Old browsers, or none at all: just show it.
    if (typeof IntersectionObserver === "undefined") {
      show();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal ${className ?? ""}`}>
      {children}
    </Tag>
  );
}
