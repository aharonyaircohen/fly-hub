/**
 * @fileType component
 * @domain vault
 * @pattern settings-card
 * @ai-summary Browser-scoped Vercel "Protection Bypass for Automation" secret.
 *   Stored in localStorage.kody_auth via useAuth().updateIntegrations — not in
 *   the repo secrets vault. Lives on /secrets so all credentials share a page.
 */
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAuth } from "../auth-context";

export function VercelBypassCard() {
  const { auth, updateIntegrations } = useAuth();
  const [vercelSecret, setVercelSecret] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    // Keep the saved credential out of the DOM. Entering a replacement is
    // write-only; the existing value is never hydrated into the password
    // field where browser tooling or extensions could read it.
    setVercelSecret("");
  }, [auth?.vercelBypassSecret]);

  const hasChanges = vercelSecret.trim().length > 0;

  function save() {
    const secret = vercelSecret.trim();
    if (!secret) {
      toast.error("Bypass secret cannot be empty — use Clear to remove it");
      return;
    }
    updateIntegrations({ vercelBypassSecret: secret });
    toast.success("Vercel bypass secret saved");
  }

  function clear() {
    updateIntegrations({ vercelBypassSecret: null });
    setVercelSecret("");
    setConfirmClear(false);
    toast.success("Vercel bypass secret cleared");
  }

  return (
    <>
      <Card className="border-white/[0.08] bg-white/[0.03]">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Vercel preview bypass</h2>
          </div>
          <p className="text-xs text-white/50 -mt-2">
            Vercel &quot;Protection Bypass for Automation&quot; secret. Lets the
            dashboard embed protected preview deployments in the iframe. Stored
            in this browser only — not in the vault.
          </p>
          <div className="space-y-2">
            <Label htmlFor="vercel-secret" className="text-xs text-white/70">
              Secret
            </Label>
            {auth?.vercelBypassSecret && (
              <p className="text-[11px] text-emerald-300/80">
                A bypass secret is saved. Enter a new value to replace it.
              </p>
            )}
            <Input
              id="vercel-secret"
              type="password"
              placeholder="••••••••"
              value={vercelSecret}
              onChange={(e) => setVercelSecret(e.target.value)}
              className="bg-black/30 border-white/10 font-mono"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={save} disabled={!hasChanges}>
              Save
            </Button>
            {auth?.vercelBypassSecret && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmClear(true)}
                className="text-rose-300 hover:text-rose-200"
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear Vercel bypass?"
        description="Removes the saved Vercel preview bypass secret from this browser."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={clear}
      />
    </>
  );
}
