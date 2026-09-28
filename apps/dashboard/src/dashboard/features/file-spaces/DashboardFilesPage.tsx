"use client";

import { useCallback, useMemo } from "react";
import { Octokit } from "@octokit/rest";
import { useRouter, useSearchParams } from "next/navigation";

import {
  type ActiveFileContext,
  FilesPage,
  type FilesPageProps,
  type FilesTransport,
} from "@dashboard/features/file-manager";
import { useChatScope } from "@dashboard/lib/components/ChatRailShell";
import { createGitHubFilesTransport } from "@dashboard/features/file-manager/lib/github-files-transport";
import { useAuth } from "@dashboard/lib/auth-context";
import { useRepoScopedHref } from "@dashboard/lib/hooks/useRepoScopedHref";
import { Button } from "@kody-ade/base/ui/button";
import {
  buildGuidedFlowFilePickerHref,
  fileMatchesPicker,
  GUIDED_FLOW_FILE_SELECTED_EVENT,
  parseGuidedFlowFilePicker,
  storeGuidedFlowFileSelection,
} from "@kody-ade/kody-chat-dashboard/guided-flows/file-picker";
import { buildActiveFileChatContext } from "./active-file-chat-context";

export type DashboardFilesPageProps = Omit<
  FilesPageProps,
  "resolveHref" | "subtitle" | "transport"
> & {
  transport?: FilesTransport;
  subtitle?: string;
};

/**
 * Dashboard-owned composition for the standalone File Manager.
 * Authentication, repository selection, and route scoping stop here.
 */
export function DashboardFilesPage({
  transport,
  subtitle,
  headerActions,
  ...props
}: DashboardFilesPageProps) {
  const { auth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filePicker = useMemo(
    () => parseGuidedFlowFilePicker(searchParams),
    [searchParams],
  );
  const resolveHref = useRepoScopedHref();
  const { setPreviewContext } = useChatScope();
  const handleActiveFileChange = useCallback(
    (file: ActiveFileContext | null) => {
      setPreviewContext(file ? buildActiveFileChatContext(file) : null);
    },
    [setPreviewContext],
  );
  const resolveFileHref = useCallback(
    (href: string) =>
      resolveHref(
        decodeURI(
          filePicker ? buildGuidedFlowFilePickerHref(href, filePicker) : href,
        ),
      ),
    [filePicker, resolveHref],
  );
  const githubTransport = useMemo(() => {
    if (transport || !auth?.token) return null;
    return createGitHubFilesTransport(
      new Octokit({ auth: auth.token }),
      auth.owner,
      auth.repo,
    );
  }, [auth?.owner, auth?.repo, auth?.token, transport]);

  return (
    <FilesPage
      {...props}
      transport={transport ?? githubTransport}
      resolveHref={resolveFileHref}
      onActiveFileChange={handleActiveFileChange}
      headerActions={(context) => (
        <>
          {headerActions?.(context)}
          {filePicker ? (
            <Button
              size="sm"
              disabled={
                !context.isFile ||
                !context.selectedPath ||
                !fileMatchesPicker(context.selectedPath, filePicker)
              }
              onClick={() => {
                if (!context.selectedPath) return;
                const selection = {
                  ...filePicker,
                  filePath: context.selectedPath,
                  fileName:
                    context.selectedPath.split("/").pop() ??
                    context.selectedPath,
                };
                storeGuidedFlowFileSelection(window.sessionStorage, selection);
                window.dispatchEvent(
                  new CustomEvent(GUIDED_FLOW_FILE_SELECTED_EVENT, {
                    detail: selection,
                  }),
                );
                if (filePicker.returnHref) {
                  router.push(filePicker.returnHref);
                } else {
                  window.history.back();
                }
              }}
            >
              Use this file
            </Button>
          ) : null}
        </>
      )}
      subtitle={
        subtitle ?? (auth ? `${auth.owner}/${auth.repo}` : "Your files")
      }
    />
  );
}
