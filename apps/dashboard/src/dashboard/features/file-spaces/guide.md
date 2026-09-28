---
id: file-spaces
title: Files and File Spaces
summary: Browse and edit repository files through the built-in Files workspace or configured rooted spaces.
routes:
  - /files
  - /files/**
  - /file-spaces
  - /file-spaces/**
aliases:
  - repository files
  - file spaces
  - docs space
  - files page
---

# Files and File Spaces

## What this feature does

Files exposes the connected repository through the shared File Manager. File Spaces create named, ordered views rooted at selected repository folders. The built-in Docs space points at `docs`; custom spaces are stored in repository-scoped Dashboard configuration.

## When to use it

Use Files for unrestricted repository browsing and supported file operations. Use a File Space when users need a focused workspace rooted at one folder.

## Available actions and options

- Browse the full repository at `/files` and open deep file paths.
- List configured spaces, open a space, and browse from its fixed root.
- Create, rename, reorder, and remove custom File Spaces.
- Configure a title, stable slug, and repository root path for each custom space.
- Read, edit, create, upload, move, copy, and delete through the GitHub transport when permissions and workspace policy allow.
- Search repository contents and inspect supported file previews and history.

## Requirements and permissions

- An authenticated connected repository is required.
- GitHub read permission is required for browsing; write permission is required for mutations.
- File Space slugs must be valid and unique.
- A custom root must be a repository-relative path.
- Repository File Spaces show and upload every repository file type within the shared size limit.

## What will not work

- A File Space cannot access files outside its configured root.
- Removing a File Space removes its Dashboard configuration, not the repository files inside its root.
- Reordering spaces does not move repository folders.
- File Spaces do not create a separate storage system; GitHub remains authoritative for repository content.

## Known limitations

- Built-in spaces may have fixed identity and behavior.
- GitHub API limits, branch state, SHA conflicts, and repository permissions apply.
- File Space configuration and repository file writes have different persistence paths.

## Common failures and recovery

- **Space root not found:** correct the configured root or create the folder in the repository.
- **Duplicate slug:** choose a different stable slug.
- **Write rejected:** confirm repository permission and refresh to the latest file SHA.
- **File hidden:** verify it is inside the active space root and refresh the workspace.

## Related tools and capabilities

Agents must use the active repository file tools and read before overwriting. The shared File Manager provides UI behavior but does not grant file access.

## Authoritative sources

- `apps/dashboard/src/dashboard/features/file-spaces/model.ts`
- `apps/dashboard/src/dashboard/features/file-spaces/FileSpacesManager.tsx`
- `apps/dashboard/src/dashboard/features/file-spaces/FileSpaceView.tsx`
- `apps/dashboard/src/dashboard/features/file-spaces/RepositoryFileSpace.tsx`
- `apps/dashboard/src/dashboard/features/file-spaces/DashboardFilesPage.tsx`
