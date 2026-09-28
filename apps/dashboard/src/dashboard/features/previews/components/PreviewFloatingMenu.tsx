/**
 * @fileType component
 * @domain preview
 * @pattern floating-preview-menu
 * @ai-summary Fixed-position menu layer for preview browser chrome. Lets
 * dropdowns escape the horizontally scrollable toolbar and the iframe below it.
 */
"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@dashboard/lib/utils";

interface PreviewFloatingMenuProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  offset?: number;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

interface MenuPosition {
  top: number;
  left: number;
}

export function PreviewFloatingMenu({
  open,
  anchorRef,
  align = "start",
  offset = 4,
  onClose,
  className,
  children,
}: PreviewFloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    let frame = 0;
    const updatePosition = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      const menuWidth = menuRect?.width ?? 0;
      const menuHeight = menuRect?.height ?? 0;
      const viewportGap = 8;
      const desiredLeft =
        align === "end" ? anchorRect.right - menuWidth : anchorRect.left;
      const maxLeft = window.innerWidth - menuWidth - viewportGap;
      const left = Math.max(viewportGap, Math.min(desiredLeft, maxLeft));

      let top = anchorRect.bottom + offset;
      const spaceBelow = window.innerHeight - top - viewportGap;
      const spaceAbove = anchorRect.top - offset - viewportGap;
      if (menuHeight > spaceBelow && spaceAbove > spaceBelow) {
        top = Math.max(viewportGap, anchorRect.top - offset - menuHeight);
      }

      setPosition({ top, left });
    };

    frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchorRef, offset, open]);

  useEffect(() => {
    if (!open) return;

    const onDocumentMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };

    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn("fixed z-[120]", className)}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
