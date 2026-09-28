"use client";

import { useCallback } from "react";
import { useAuth } from "../auth-context";
import { repoScopedHref } from "@kody-ade/base/routes";

export function useRepoScopedHref() {
  const { auth } = useAuth();

  return useCallback(
    (href: string) => (auth ? repoScopedHref(auth, href) : href),
    [auth],
  );
}
