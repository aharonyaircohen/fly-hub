/**
 * @fileType component
 * @domain onboarding
 * @pattern first-run-welcome
 * @ai-summary Repository-free first-run page. Chat owns the onboarding
 *   guidance; this page offers the single action that starts it.
 */
"use client";

import { FormEvent, useState } from "react";
import { KeyRound, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { useAuth } from "@dashboard/lib/auth-context";
import { ONBOARDING_FLOW_ID } from "@kody-ade/kody-chat-dashboard/guided-flows/registry";

export function WelcomeSetup() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startChat = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/kody/auth/me", {
        headers: { "x-kody-token": token.trim() },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        authenticated?: boolean;
        user?: { login: string; avatar_url: string; githubId: number };
      };
      if (!response.ok || !data.authenticated || !data.user) {
        throw new Error("Invalid GitHub token.");
      }
      signIn(token, {
        login: data.user.login,
        avatar_url: data.user.avatar_url,
        id: data.user.githubId,
      });
      router.push(
        `/chat?guidedFlow=${ONBOARDING_FLOW_ID}&guidedFlowOnce=1`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      title="Welcome to Kody"
      icon={Sparkles}
      iconClassName="text-teal-300"
    >
      <div className="max-w-xl space-y-5">
        <p className="text-base leading-7 text-muted-foreground">
          Sign in with GitHub to start a private chat. You can attach a
          repository later when you need repository tools.
        </p>
        <form className="space-y-3" onSubmit={startChat}>
          <div className="relative">
            <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="GitHub personal access token"
              className="pl-9"
              autoComplete="off"
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={submitting || !token.trim()}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Start private chat
          </Button>
        </form>
      </div>
    </PageShell>
  );
}
