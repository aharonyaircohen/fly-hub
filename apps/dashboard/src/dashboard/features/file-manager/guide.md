---
id: file-manager
title: Shared File Manager
summary: Provide the reusable browser, editor, preview, search, upload, and file-operation workspace used by Dashboard features.
routes:
aliases:
  - file manager
  - file workspace
  - shared files component
---

# Shared File Manager

## What this feature does

The File Manager is generic shared infrastructure. Callers supply a transport, route base, root path, upload policy, filters, and optional operations. It powers repository Files, Docs and configured file spaces, Capability files, Memory files, Reports, and guidance workspaces without knowing those domains.

## When to use it

Use it whenever a Dashboard feature needs a tree-based file workspace. Feature-specific paths, formats, persistence, and policy belong in the caller's adapter, not inside the shared manager.

## Available actions and options

- Lazy directory browsing, breadcrumbs, refresh, responsive split-pane navigation, and full-text search when the transport supports it.
- Read source and metadata; render Markdown, text/code, HTML, images, PDF, audio, video, and supported advanced document previews.
- Toggle preview/source, copy content or path, and compare commit history when supported.
- Edit text with Monaco, track unsaved changes, undo, and save with keyboard shortcuts.
- Create files/folders, upload one or many files, rename/move, copy, and delete only when the active transport supplies those optional operations.
- Restrict visible entries and uploads through caller-owned filters and upload policy.

## Requirements and permissions

- Every workspace needs a configured `FilesTransport` with required read operations.
- Write controls require matching optional transport methods and authenticated write permission.
- Uploads must satisfy the caller's extension policy and size limit; the default GitHub blob ceiling is 100 MB.
- Paths are resolved inside the caller-provided root and route base.
- HTML preview runs sandboxed with a restrictive Content Security Policy.

## What will not work

- The shared manager cannot invent a missing transport operation.
- Feature-specific rules must not be added to shared components or file operations.
- A read-only workspace cannot save, upload, move, copy, create, or delete.
- Markdown-only spaces reject other extensions.
- HTML previews cannot open frames, submit forms, load plugins, or escape the sandbox.
- Binary formats without a supported native or advanced renderer cannot be edited as text.

## Known limitations

- GitHub-backed operations are subject to GitHub size, rate, SHA-conflict, and permission limits.
- Preview support varies by format and available renderer.
- Search and history are optional transport capabilities.
- Unsaved local edits are not persisted until a successful transport save.

## Common failures and recovery

- **Operation is missing:** the caller's transport is read-only or does not implement that action.
- **Upload rejected:** correct the extension or reduce the file below the active policy limit.
- **Write conflict:** refresh the file and reapply changes against the latest version.
- **Preview unavailable:** use source/download where supported or open the file in its authoritative system.
- **Path not found:** return to the configured root and refresh the tree.

## Related tools and capabilities

The File Manager is UI infrastructure, not an Agent Capability. Agents must use the feature-owned read/write tools for the active workspace and obey their permissions.

## Authoritative sources

- `apps/dashboard/src/dashboard/features/file-manager/lib/transport.tsx`
- `apps/dashboard/src/dashboard/features/file-manager/components/FilesPage.tsx`
- `apps/dashboard/src/dashboard/features/file-manager/components/FileViewer.tsx`
- `apps/dashboard/src/dashboard/features/file-manager/components/FileEditor.tsx`
- `apps/dashboard/src/dashboard/features/file-manager/lib/file-upload-policy.ts`
- `apps/dashboard/src/dashboard/features/file-manager/lib/html-preview-security.ts`
