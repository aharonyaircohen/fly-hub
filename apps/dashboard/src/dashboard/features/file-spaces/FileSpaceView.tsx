"use client";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { useFileSpaces } from "./use-file-spaces";
import { RepositoryFileSpace } from "./RepositoryFileSpace";

export function FileSpaceView({ slug, path = [] }: { slug: string; path?: string[] }) {
  const query = useFileSpaces();
  const space = query.data?.spaces.find((item) => item.slug === slug);

  return (
    <AuthGuard>
      {query.isPending ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading file space…
        </div>
      ) : !space ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          File space not found.
        </div>
      ) : (
        <RepositoryFileSpace
          title={space.title}
          rootPath={space.rootPath}
          routeBase={`/file-spaces/${space.slug}`}
          initialPath={path.length ? `${space.rootPath}/${path.join("/")}` : ""}
        />
      )}
    </AuthGuard>
  );
}
