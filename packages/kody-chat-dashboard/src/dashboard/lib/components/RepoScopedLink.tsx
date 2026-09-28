"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";

type RepoScopedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

export function RepoScopedLink({ href, ...props }: RepoScopedLinkProps) {
  const scopedHref = useRepoScopedHref();
  return <Link href={scopedHref(href)} {...props} />;
}
