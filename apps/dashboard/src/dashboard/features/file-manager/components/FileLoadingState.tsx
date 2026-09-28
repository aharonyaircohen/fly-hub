"use client";

import { FileText, Loader2 } from "lucide-react";

interface FileLoadingStateProps {
  fileName: string;
}

export function FileLoadingState({ fileName }: FileLoadingStateProps) {
  return (
    <div
      role="status"
      aria-label={`Loading preview of ${fileName}`}
      className="flex h-full items-center justify-center p-8"
    >
      <div className="flex w-full max-w-md flex-col items-center rounded-3xl border border-border bg-card px-8 py-10 text-center shadow-sm">
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-primary/15 bg-primary/10">
          <FileText className="h-7 w-7 text-primary" />
          <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin rounded-full bg-card p-0.5 text-primary" />
        </div>
        <p className="mt-5 text-base font-medium text-foreground">
          Loading preview…
        </p>
        <p className="mt-1 max-w-full truncate text-sm text-muted-foreground">
          {fileName}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Large files can take a moment.
        </p>
      </div>
    </div>
  );
}
