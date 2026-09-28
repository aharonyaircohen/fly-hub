/**
 * @fileType component
 * @domain client-chat
 * @pattern languages-manager
 * @ai-summary CRUD UI for client language packs. Repo packs live at
 *   `languages/<code>.json` in the backend; built-in English is the
 *   fallback row that becomes a repo override when edited. A brand's
 *   `locale` selects the pack on /client surfaces.
 */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Languages,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Textarea } from "@kody-ade/base/ui/textarea";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { selectionPath } from "../selection-routing";
import { cn } from "../utils";
import {
  CLIENT_LANGUAGE_STRING_KEYS,
  isValidLanguageCode,
} from "../client-language";

interface LanguageRow {
  code: string;
  name: string;
  strings: Record<string, string>;
  source: "repo" | "builtin";
  htmlUrl: string;
}

interface SavePayload {
  code: string;
  name: string;
  strings: Record<string, string>;
  isUpdate: boolean;
}

const languagesQueryKeys = {
  all: ["kody-languages"] as const,
  list: (owner: string | null, repo: string | null) =>
    ["kody-languages", owner, repo] as const,
};

async function listLanguagesApi(
  headers: Record<string, string>,
): Promise<LanguageRow[]> {
  const res = await fetch("/api/kody/languages", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    languages?: LanguageRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.languages ?? [];
}

async function saveLanguageApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
): Promise<void> {
  const { code, isUpdate, ...rest } = payload;
  const url = isUpdate
    ? `/api/kody/languages/${encodeURIComponent(code)}`
    : "/api/kody/languages";
  const method = isUpdate ? "PATCH" : "POST";
  const body = JSON.stringify(
    isUpdate ? { ...rest, actorLogin } : { code, ...rest, actorLogin },
  );
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function deleteLanguageApi(
  headers: Record<string, string>,
  code: string,
  actorLogin?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (actorLogin) params.set("actorLogin", actorLogin);
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(
    `/api/kody/languages/${encodeURIComponent(code)}${suffix}`,
    { method: "DELETE", headers },
  );
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

function overrideCount(language: LanguageRow): number {
  if (language.code === "en") return 0;
  return CLIENT_LANGUAGE_STRING_KEYS.filter(
    (key) => (language.strings[key] ?? "") !== "",
  ).length;
}

export function LanguagesManager({
  selectedCode = null,
}: {
  selectedCode?: string | null;
}) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const listQueryKey = languagesQueryKeys.list(
    auth?.owner ?? null,
    auth?.repo ?? null,
  );
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<LanguageRow[]>({
    queryKey: listQueryKey,
    queryFn: () => listLanguagesApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const languages = useMemo(() => data ?? [], [data]);
  const repoCount = languages.filter((l) => l.source === "repo").length;

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      saveLanguageApi(headers, payload, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: languagesQueryKeys.all });
      toast.success("Language saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save language"),
  });

  const remove = useMutation({
    mutationFn: (language: LanguageRow) =>
      deleteLanguageApi(headers, language.code, actorLogin),
    onSuccess: (_data, language) => {
      queryClient.invalidateQueries({ queryKey: languagesQueryKeys.all });
      toast.success("Language deleted");
      setDeleting(null);
      if (selectedCode === language.code) {
        selectLanguage(null, true);
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete language"),
  });

  const [editing, setEditing] = useState<{
    language: LanguageRow | null;
    isNew: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<LanguageRow | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter((language) =>
      `${language.code} ${language.name} ${language.source}`
        .toLowerCase()
        .includes(q),
    );
  }, [languages, search]);

  const selectedLanguage = useMemo(
    () => languages.find((language) => language.code === selectedCode) ?? null,
    [languages, selectedCode],
  );

  useEffect(() => {
    if (isLoading || !data) return;
    if (filtered.length === 0) {
      if (selectedCode) router.replace("/languages");
      return;
    }
    if (
      selectedCode &&
      !filtered.some((language) => language.code === selectedCode)
    ) {
      router.replace("/languages");
      return;
    }
    if (!selectedCode && autoSelectFirst) {
      router.replace(selectionPath("/languages", filtered[0]!.code));
    }
  }, [autoSelectFirst, data, filtered, isLoading, router, selectedCode]);

  const selectLanguage = (code: string | null, replace = false) => {
    const path = code ? selectionPath("/languages", code) : "/languages";
    if (replace) router.replace(path);
    else router.push(path);
  };

  return (
    <>
      <MasterDetailShell
        title="Languages"
        icon={Languages}
        iconClassName="text-amber-300"
        subtitle={
          auth
            ? `${auth.owner}/${auth.repo} · ${repoCount} repo languages`
            : `${languages.length} ${languages.length === 1 ? "language" : "languages"}`
        }
        error={
          error
            ? `Couldn't load languages: ${error instanceof Error ? error.message : "Unknown error"}`
            : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search languages…"
        searchAriaLabel="Search languages"
        accent="sky"
        hasSelection={!!selectedLanguage}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label="Refresh languages"
            >
              <RefreshCw
                className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setEditing({ language: null, isNew: true })}
              title="New language"
              aria-label="New language"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selectedLanguage ? (
            <LanguageDetail
              language={selectedLanguage}
              onBack={() => selectLanguage(null)}
              onEdit={() =>
                setEditing({ language: selectedLanguage, isNew: false })
              }
              onDelete={() => setDeleting(selectedLanguage)}
            />
          ) : (
            <EmptyState
              icon={<Languages />}
              title="Select a language"
              hint="Pick one from the list to view or translate the client chat strings."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<Languages />} title="Loading languages…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Languages />}
            title={languages.length === 0 ? "No languages yet" : "No matches"}
            hint={
              languages.length === 0
                ? "Add a language pack to translate the client chat surface."
                : `Nothing matched "${search}".`
            }
            action={
              languages.length === 0 ? (
                <Button
                  size="sm"
                  onClick={() => setEditing({ language: null, isNew: true })}
                >
                  <Plus className="h-4 w-4" />
                  New language
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((language) => (
              <li key={language.code}>
                <LanguageListRow
                  language={language}
                  isActive={selectedCode === language.code}
                  onSelect={() => selectLanguage(language.code)}
                  onDelete={() => setDeleting(language)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      {editing && (
        <LanguageEditor
          initial={editing.language}
          isNew={editing.isNew}
          existingCodes={new Set(languages.map((language) => language.code))}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await save.mutateAsync(payload);
            setEditing(null);
            selectLanguage(payload.code, true);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name}?`}
        description="Brands using this locale fall back to the built-in English strings."
        confirmLabel={remove.isPending ? "Deleting..." : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function LanguageListRow({
  language,
  isActive,
  onSelect,
  onDelete,
}: {
  language: LanguageRow;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const overrides = overrideCount(language);
  return (
    <div
      className={cn(
        "relative flex items-stretch transition-colors hover:bg-white/[0.04]",
        isActive && "bg-amber-500/10",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-4 py-3 pr-14 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white/90">
            {language.name}
          </span>
          <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/55">
            {language.source}
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          languages/{language.code}.json
        </p>
        <p className="mt-1 truncate text-xs text-white/50">
          {language.source === "builtin"
            ? "Built-in defaults"
            : `${overrides}/${CLIENT_LANGUAGE_STRING_KEYS.length} strings translated`}
        </p>
      </button>
      {language.source === "repo" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="absolute right-3 top-3 h-8 w-8 px-0 text-red-300 hover:text-red-200"
          title="Delete language"
          aria-label={`Delete ${language.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function LanguageDetail({
  language,
  onBack,
  onEdit,
  onDelete,
}: {
  language: LanguageRow;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="min-h-full">
      <div className="border-b border-amber-500/20 bg-amber-500/[0.04]">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 gap-1 text-muted-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            All languages
          </Button>

          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="break-words text-2xl font-semibold tracking-tight text-white/90 md:text-3xl">
                  {language.name}
                </h1>
                <span className="rounded bg-white/[0.07] px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-white/55">
                  {language.source}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{language.code}</span>
                <span>·</span>
                <span>
                  Selected by brands whose locale is “{language.code}”
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              {language.source === "repo" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="text-red-300 hover:text-red-200"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </header>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
        <section className="rounded-md border border-white/[0.08] bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-medium text-white/80">
            Language JSON
          </h2>
          <pre className="overflow-x-auto rounded-md border border-white/[0.06] bg-black/20 p-3 font-mono text-xs leading-5 text-white/80">
            {languageToJson(language)}
          </pre>
        </section>

        <section className="rounded-md border border-white/[0.08] bg-white/[0.03] p-4">
          <h2 className="mb-2 text-sm font-medium text-white/80">Source</h2>
          <p className="break-all text-sm text-white/75">
            {language.source === "repo"
              ? language.htmlUrl || "Repo language file"
              : "Built-in English defaults. Editing creates a repo-owned language file."}
          </p>
        </section>
      </div>
    </article>
  );
}

function languageToJson(language: LanguageRow): string {
  return JSON.stringify(
    {
      code: language.code,
      name: language.name,
      strings: language.strings,
    },
    null,
    2,
  );
}

/** Template for a new pack: every known key, empty = English fallback. */
function newLanguageTemplate(): string {
  return JSON.stringify(
    {
      code: "",
      name: "",
      strings: Object.fromEntries(
        CLIENT_LANGUAGE_STRING_KEYS.map((key) => [key, ""]),
      ),
    },
    null,
    2,
  );
}

function LanguageEditor({
  initial,
  isNew,
  saving,
  existingCodes,
  onClose,
  onSave,
}: {
  initial: LanguageRow | null;
  isNew: boolean;
  saving: boolean;
  existingCodes: Set<string>;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}) {
  const [json, setJson] = useState(() =>
    initial ? languageToJson(initial) : newLanguageTemplate(),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    let parsed: {
      code?: unknown;
      name?: unknown;
      strings?: unknown;
    };
    try {
      parsed = JSON.parse(json);
    } catch {
      setFormError("Invalid JSON — fix the syntax and try again.");
      return;
    }
    const code = String(parsed.code ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    const name = String(parsed.name ?? "").trim();
    const strings = parsed.strings;
    if (!isValidLanguageCode(code)) {
      setFormError('"code" must be a BCP-47-style tag like "he" or "fr-ca".');
      return;
    }
    if (isNew && existingCodes.has(code)) {
      setFormError(`Language "${code}" already exists.`);
      return;
    }
    if (!isNew && initial && code !== initial.code) {
      setFormError(
        `"code" can't change here (this file is languages/${initial.code}.json).`,
      );
      return;
    }
    if (!name) {
      setFormError('"name" is required.');
      return;
    }
    if (
      typeof strings !== "object" ||
      strings === null ||
      Array.isArray(strings) ||
      Object.values(strings).some((value) => typeof value !== "string")
    ) {
      setFormError('"strings" must be an object of key → text.');
      return;
    }
    setFormError(null);
    await onSave({
      code,
      name,
      strings: strings as Record<string, string>,
      isUpdate: !isNew,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "New language" : `Edit ${initial?.name ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            Edit the language JSON directly. Empty string values fall back to
            the built-in English text; unknown keys are dropped on save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            aria-label="Language JSON"
            value={json}
            onChange={(event) => setJson(event.target.value)}
            spellCheck={false}
            rows={22}
            className="font-mono text-xs leading-5"
          />

          {formError && <p className="text-sm text-red-300">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isNew ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
