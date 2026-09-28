"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { kodyAuthClient } from "./auth/kody-auth-client";

function KodySignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"google" | "github" | "email" | null>(
    null,
  );

  const signIn = async (provider: "google" | "github") => {
    setError(null);
    setPending(provider);
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          callbackURL: new URL("/chat", window.location.origin).toString(),
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        url?: unknown;
      } | null;
      if (!response.ok || typeof result?.url !== "string") {
        const label = provider === "github" ? "GitHub" : "Google";
        setError(`${label} sign-in is not available.`);
        return;
      }
      window.location.assign(result.url);
    } catch {
      const label = provider === "github" ? "GitHub" : "Google";
      setError(`${label} sign-in failed. Try again.`);
    } finally {
      setPending(null);
    }
  };

  const submitTestLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending("email");
    try {
      const result = await kodyAuthClient.signIn.email({
        email,
        password,
        callbackURL: "/chat",
      });
      if (result.error)
        setError("Email login failed. Check the email and password.");
    } catch {
      setError("Email login failed. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Sign in to Kody</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start chatting now. Connect a repository only when you need repository
          features.
        </p>
        <div className="mt-6 grid gap-3">
          <Button
            type="button"
            disabled={pending !== null}
            onClick={() => void signIn("google")}
          >
            {pending === "google" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void signIn("github")}
          >
            {pending === "github" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Continue with GitHub
          </Button>
          <form
            className="mt-3 grid gap-3 border-t pt-4"
            onSubmit={submitTestLogin}
          >
              <Input
                aria-label="Email"
                className="rounded-md border bg-background px-3 py-2 text-sm"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="QA email"
                required
              />
              <Input
                aria-label="Password"
                className="rounded-md border bg-background px-3 py-2 text-sm"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="QA password"
                minLength={8}
                required
              />
              <Button type="submit" disabled={pending !== null}>
                {pending === "email" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Sign in
              </Button>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
          </form>
        </div>
      </section>
    </main>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = kodyAuthClient.useSession();
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <KodySignIn />;
  return <>{children}</>;
}
