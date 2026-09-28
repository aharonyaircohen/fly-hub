"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Footprints } from "lucide-react";

import { repoScopedHref } from "@kody-ade/base/routes";
import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";
import { EmptyState } from "../components/EmptyState";

function UserJourneysRedirect() {
  const { auth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth) router.replace(repoScopedHref(auth, "/quality/journeys"));
  }, [auth, router]);

  return <EmptyState icon={<Footprints />} title="Opening Journeys..." />;
}

export default function UserJourneysPage() {
  return (
    <AuthGuard>
      <UserJourneysRedirect />
    </AuthGuard>
  );
}
