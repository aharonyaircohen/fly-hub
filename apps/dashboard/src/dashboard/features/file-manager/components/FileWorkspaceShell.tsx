import type { ReactNode } from "react";

interface FileWorkspaceShellProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Standalone visual frame for the File Manager workspace. */
export function FileWorkspaceShell({
  title,
  subtitle,
  actions,
  children,
}: FileWorkspaceShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 text-foreground md:px-7 md:py-5">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
            <div className="min-w-0">
              <p className="text-[0.68rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Workspace
              </p>
              <h1 className="truncate text-heading-md font-semibold tracking-tight md:text-heading-lg">
                {title}
              </h1>
            </div>
            <span className="truncate text-body-xs text-muted-foreground">
              {subtitle}
            </span>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
        ) : null}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
