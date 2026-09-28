/**
 * @fileType component
 * @domain kody
 * @pattern mobile-nav-sheet
 * @ai-summary Mobile sheet shell for the shared application Sidebar.
 */
"use client";

import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@kody-ade/base/ui/sheet";

import type { SettingsNavItem, SettingsNavSection } from "../feature-catalog";
import { RepoSwitcher } from "./RepoSwitcher";
import { Sidebar } from "./Sidebar";

interface MobileMenuProps {
  account?: React.ComponentProps<typeof Sidebar>["account"];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  sections: readonly SettingsNavSection[];
  pinnedItem: SettingsNavItem | null;
  headerExtra?: ReactNode;
  workspacePrimary?: ReactNode;
  extras?: ReactNode;
  bottomCta?: ReactNode;
}

export function MobileMenu({
  open,
  onOpenChange,
  sections,
  pinnedItem,
  headerExtra = <RepoSwitcher variant="rail" />,
  workspacePrimary,
  extras,
  bottomCta,
  account,
}: MobileMenuProps) {
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[92vw] sm:w-[390px] !p-0 !gap-0 overflow-hidden !bg-black/95 !text-white/90 border-white/[0.08]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Application navigation and actions.</SheetDescription>
        </SheetHeader>

        <Sidebar
          presentation="mobile"
          sections={sections}
          pinnedItem={pinnedItem}
          onNavigate={close}
          headerExtra={headerExtra}
          navigationExtra={workspacePrimary}
          extras={extras}
          bottomCta={bottomCta}
          account={account}
        />
      </SheetContent>
    </Sheet>
  );
}
