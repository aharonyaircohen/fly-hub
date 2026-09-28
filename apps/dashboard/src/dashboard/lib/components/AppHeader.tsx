/**
 * @fileType component
 * @domain kody
 * @pattern app-header
 * @ai-summary The single persistent top header, rendered once by ChatRailShell
 *   at the top of the main content column (right of the nav sidebar). It stays
 *   put across views — the view switches below it, the header never
 *   disappears. Reuses KodyHeader for the shared chrome (repo title,
 *   notifications, mobile hamburger) with no page-specific filter/refresh
 *   bits — pages render those as their own toolbar below this header. View
 *   navigation (Dashboard / Tasks / Vibe) lives in the rail's "Views" group.
 *   Not shown on /vibe, which keeps its own header.
 */
"use client";

import { useState } from "react";

import { KodyHeader } from "./KodyHeader";
import { MobileMenu } from "@kody-ade/kody-chat-dashboard/components/MobileMenu";
import { DASHBOARD_NAV_ITEM, HOME_NAV_ITEM } from "./settings-nav";
import { useSidebarNavSections } from "./use-sidebar-nav-sections";
import { useAuth } from "../auth-context";

export function AppHeader() {
  const [navOpen, setNavOpen] = useState(false);
  const { auth } = useAuth();
  const hasRepository = Boolean(auth?.owner && auth.repo);
  const navSections = useSidebarNavSections();

  return (
    <>
      <KodyHeader
        onOpenMobileMenu={() => setNavOpen(true)}
        onRefresh={() => {}}
        isFetching={false}
        showRefresh={false}
      />
      <MobileMenu
        open={navOpen}
        onOpenChange={setNavOpen}
        sections={hasRepository ? navSections : []}
        pinnedItem={hasRepository ? DASHBOARD_NAV_ITEM : HOME_NAV_ITEM}
      />
    </>
  );
}
