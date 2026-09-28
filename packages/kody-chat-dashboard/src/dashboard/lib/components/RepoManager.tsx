/**
 * @fileType component
 * @domain kody
 * @pattern first-run-connect
 * @ai-summary First-run connect screen. Shown by KodyDashboard when no repo
 *   is stored yet (auth === null) — there's no header to click before the
 *   first repo exists, so the connect form lives on the page here. Once a repo
 *   is connected, switching/adding/removing repos all happen in the header
 *   RepoSwitcher dropdown; this screen is only the bootstrap entry point.
 *   The PAT stays in this browser only — nothing is sent to a Kody backend.
 */
"use client";

import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import { PageShell } from "./PageShell";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Button } from "@kody-ade/base/ui/button";
import { AddRepoForm } from "./AddRepoForm";
import { useAuth } from "../auth-context";
import {
  clearPendingBrowserRepositoryAuth,
  loadPendingBrowserRepositoryAuth,
  saveAccountRepositoryAuth,
} from "../account-repository-persistence";

export function RepoManager() {
  const { auth } = useAuth();
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);

  useEffect(() => {
    setPendingImport(loadPendingBrowserRepositoryAuth());
  }, []);

  async function importRepositories() {
    if (!pendingImport) return;
    setImporting(true);
    setImportError(false);
    const saved = await saveAccountRepositoryAuth(pendingImport);
    if (saved) {
      clearPendingBrowserRepositoryAuth();
      window.location.reload();
      return;
    }
    setImportError(true);
    setImporting(false);
  }

  function dismissImport() {
    clearPendingBrowserRepositoryAuth();
    setPendingImport(null);
  }

  // Empty-state mode: when `auth` is null this is the very first repo the
  // user is adding. `addRepo` bootstraps the entire kody_auth object from the
  // server response and the form reloads to `/` on success.
  const isBootstrap = !auth;

  return (
    <PageShell
      title="Connect a repository"
      icon={Github}
      iconClassName="text-white/80"
      width="wide"
    >
      <div className="space-y-6">
        <p className="text-sm text-white/60">
          Add repository context when you need repository pages, tools, and
          agency. Your private Chat and its history stay the same.
        </p>

        {pendingImport ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="font-medium">Use your existing repositories?</p>
              <p className="text-sm text-white/60">
                Kody found repository connections saved by the older
                browser-only setup. Import them only if they belong to this
                account.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => void importRepositories()}
                  disabled={importing}
                >
                  {importing ? "Importing..." : "Import repositories"}
                </Button>
                <Button
                  variant="outline"
                  onClick={dismissImport}
                  disabled={importing}
                >
                  Do not import
                </Button>
              </div>
              {importError ? (
                <p role="alert" className="text-sm text-red-300">
                  Repositories could not be imported. Try again.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="p-4">
            <AddRepoForm isBootstrap={isBootstrap} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
