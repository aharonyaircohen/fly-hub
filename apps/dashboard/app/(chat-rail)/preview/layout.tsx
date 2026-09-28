import type { ReactNode } from "react";

import { PreviewRouteWorkspace } from "@dashboard/features/previews/components/PreviewRouteWorkspace";

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PreviewRouteWorkspace />
      {children}
    </>
  );
}
