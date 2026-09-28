"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { shouldInterceptInternalLinkClick } from "@kody-ade/base/internal-links";

export function InternalLinkNavigation() {
  const router = useRouter();

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (event.defaultPrevented) return;

      if (
        !shouldInterceptInternalLinkClick({
          href: anchor.getAttribute("href"),
          target: anchor.getAttribute("target"),
          download: anchor.hasAttribute("download"),
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        })
      ) {
        return;
      }

      event.preventDefault();
      router.push(anchor.href.replace(window.location.origin, ""));
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [router]);

  return null;
}
