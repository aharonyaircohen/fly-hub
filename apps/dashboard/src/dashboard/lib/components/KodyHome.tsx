"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@dashboard/lib/auth-context";
import { DashboardHome } from "./DashboardHome";

export function KodyHome() {
  const { auth, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !auth) router.replace("/chat");
  }, [auth, loading, router]);

  if (loading || !auth) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <DashboardHome />;
}
