"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import { Textarea } from "@kody-ade/base/ui/textarea";
import { slugifyTitle } from "@kody-ade/base/slug";

import type {
  QualityAction,
  QualityJourney,
  QualityScenario,
} from "./contracts";
import type { QualityMap, QualityRecord, QualityResource } from "./types";

type Editable = QualityAction | QualityJourney | QualityScenario;

const authoringDescriptions: Record<
  Exclude<QualityResource, "runs">,
  string
> = {
  actions:
    "An Action is one reusable user step. Describe the expected result, not clicks or selectors.",
  journeys:
    "A Journey is one user goal inside a Scenario. Add the Actions needed to complete that goal.",
  scenarios:
    "A Scenario is the complete test you want to run. Add Journeys, starting conditions, and required proof.",
};

function defaultRecord(
  resource: Exclude<QualityResource, "runs">,
  map: QualityMap,
): Editable {
  const updatedAt = new Date().toISOString();
  if (resource === "actions") {
    return {
      slug: "",
      name: "",
      outcome: "",
      area: "",
      status: "draft",
      updatedAt,
    };
  }
  if (resource === "journeys") {
    return {
      slug: "",
      name: "",
      goal: "",
      priority: "normal",
      status: "draft",
      actionSlugs: [],
      updatedAt,
    };
  }
  const production = map.environments.find(
    (environment) =>
      environment.url && environment.label.toLowerCase() === "production",
  );
  const defaultJourney = map.journeys.find(
    (journey) => journey.status === "active",
  );
  return {
    slug: "",
    journeySlugs: defaultJourney ? [defaultJourney.slug] : [],
    name: "",
    kind: "happy",
    given: "",
    expectedVisible: "",
    expectedState: "",
    environmentId:
      production?.id ??
      map.environments.find((environment) => environment.url)?.id,
    cleanup: "",
    status: "draft",
    updatedAt,
  };
}

function isAction(record: Editable): record is QualityAction {
  return "outcome" in record;
}
function isJourney(record: Editable): record is QualityJourney {
  return "actionSlugs" in record;
}
function isScenario(record: Editable): record is QualityScenario {
  return "journeySlugs" in record;
}

export function QualityEditorDialog({
  resource,
  open,
  record,
  map,
  saving,
  onClose,
  onSave,
}: {
  resource: Exclude<QualityResource, "runs">;
  open: boolean;
  record: QualityRecord | null;
  map: QualityMap;
  saving: boolean;
  onClose: () => void;
  onSave: (record: Editable) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Editable>(() =>
    defaultRecord(resource, map),
  );

  useEffect(() => {
    setDraft((record as Editable | null) ?? defaultRecord(resource, map));
  }, [map, open, record, resource]);

  const activeActions = map.actions.filter(
    (action) => action.status === "active",
  );
  const activeJourneys = map.journeys.filter(
    (journey) => journey.status === "active",
  );

  const valid =
    draft.name.trim().length > 0 &&
    (isAction(draft)
      ? draft.outcome.trim().length > 0 && draft.area.trim().length > 0
      : isJourney(draft)
        ? draft.goal.trim().length > 0
        : draft.journeySlugs.length > 0 &&
          draft.given.trim().length > 0 &&
          draft.expectedVisible.trim().length > 0 &&
          draft.expectedState.trim().length > 0 &&
          (draft.status !== "active" || !!draft.environmentId));

  function updateName(name: string) {
    setDraft((current) => ({
      ...current,
      name,
      ...(!record ? { slug: slugifyTitle(name) } : {}),
    }));
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {record ? "Edit" : "New"} {resource.slice(0, -1)}
          </DialogTitle>
          <DialogDescription>
            {authoringDescriptions[resource]}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5">
            <Label>Name</Label>
            <Input
              value={draft.name}
              onChange={(event) => updateName(event.target.value)}
            />
          </label>

          {isAction(draft) ? (
            <>
              <label className="grid gap-1.5">
                <Label>Expected result</Label>
                <Textarea
                  value={draft.outcome}
                  onChange={(event) =>
                    setDraft({ ...draft, outcome: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1.5">
                <Label>Product area</Label>
                <Input
                  value={draft.area}
                  onChange={(event) =>
                    setDraft({ ...draft, area: event.target.value })
                  }
                />
              </label>
            </>
          ) : null}

          {isJourney(draft) ? (
            <>
              <label className="grid gap-1.5">
                <Label>User goal</Label>
                <Textarea
                  value={draft.goal}
                  onChange={(event) =>
                    setDraft({ ...draft, goal: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1.5">
                <Label>Priority</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      priority: event.target
                        .value as QualityJourney["priority"],
                    })
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">
                  Actions in order
                </legend>
                {activeActions.length === 0 &&
                draft.actionSlugs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Create an Action first.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {draft.actionSlugs.map((slug, index) => {
                      const action = map.actions.find(
                        (candidate) => candidate.slug === slug,
                      );
                      return (
                        <div
                          key={slug}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {index + 1}. {action?.name ?? slug}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Move ${action?.name ?? slug} up`}
                            disabled={index === 0}
                            onClick={() => {
                              const next = [...draft.actionSlugs];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              setDraft({ ...draft, actionSlugs: next });
                            }}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Move ${action?.name ?? slug} down`}
                            disabled={index === draft.actionSlugs.length - 1}
                            onClick={() => {
                              const next = [...draft.actionSlugs];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index],
                              ];
                              setDraft({ ...draft, actionSlugs: next });
                            }}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${action?.name ?? slug}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                actionSlugs: draft.actionSlugs.filter(
                                  (candidate) => candidate !== slug,
                                ),
                              })
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                    {activeActions
                      .filter(
                        (action) => !draft.actionSlugs.includes(action.slug),
                      )
                      .map((action) => (
                        <Button
                          key={action.slug}
                          type="button"
                          variant="outline"
                          className="justify-start"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              actionSlugs: [...draft.actionSlugs, action.slug],
                            })
                          }
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add {action.name}
                        </Button>
                      ))}
                  </div>
                )}
              </fieldset>
            </>
          ) : null}

          {isScenario(draft) ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">
                  Journeys in order
                </legend>
                {activeJourneys.length === 0 &&
                draft.journeySlugs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Create a Journey first.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {draft.journeySlugs.map((slug, index) => {
                      const journey = map.journeys.find(
                        (candidate) => candidate.slug === slug,
                      );
                      return (
                        <div
                          key={slug}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {index + 1}. {journey?.name ?? slug}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Move ${journey?.name ?? slug} up`}
                            disabled={index === 0}
                            onClick={() => {
                              const next = [...draft.journeySlugs];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              setDraft({ ...draft, journeySlugs: next });
                            }}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Move ${journey?.name ?? slug} down`}
                            disabled={index === draft.journeySlugs.length - 1}
                            onClick={() => {
                              const next = [...draft.journeySlugs];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index],
                              ];
                              setDraft({ ...draft, journeySlugs: next });
                            }}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${journey?.name ?? slug}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                journeySlugs: draft.journeySlugs.filter(
                                  (candidate) => candidate !== slug,
                                ),
                              })
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                    {activeJourneys
                      .filter(
                        (journey) => !draft.journeySlugs.includes(journey.slug),
                      )
                      .map((journey) => (
                        <Button
                          key={journey.slug}
                          type="button"
                          variant="outline"
                          className="justify-start"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              journeySlugs: [
                                ...draft.journeySlugs,
                                journey.slug,
                              ],
                            })
                          }
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add {journey.name}
                        </Button>
                      ))}
                  </div>
                )}
              </fieldset>
              <label className="grid gap-1.5">
                <Label>Kind</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as QualityScenario["kind"],
                    })
                  }
                >
                  {[
                    "happy",
                    "validation",
                    "permission",
                    "failure",
                    "recovery",
                    "persistence",
                  ].map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <Label>Starting conditions</Label>
                <Textarea
                  value={draft.given}
                  onChange={(event) =>
                    setDraft({ ...draft, given: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1.5">
                <Label>Visible proof</Label>
                <Textarea
                  value={draft.expectedVisible}
                  onChange={(event) =>
                    setDraft({ ...draft, expectedVisible: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1.5">
                <Label>Stored-state proof</Label>
                <Textarea
                  value={draft.expectedState}
                  onChange={(event) =>
                    setDraft({ ...draft, expectedState: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1.5">
                <Label>Website to test</Label>
                <select
                  aria-label="Website to test"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.environmentId ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      environmentId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Select website</option>
                  {map.environments
                    .filter((environment) => environment.url)
                    .map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.label}
                      </option>
                    ))}
                </select>
                {map.environments.every((environment) => !environment.url) ? (
                  <span className="text-xs text-amber-300">
                    Add a website URL on the Preview page first. Kody runs the
                    test through the repository&apos;s GitHub Engine; this
                    website is only the page being tested.
                  </span>
                ) : null}
              </label>
              <label className="grid gap-1.5">
                <Label>Cleanup</Label>
                <Textarea
                  value={draft.cleanup ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, cleanup: event.target.value })
                  }
                />
              </label>
            </>
          ) : null}

          <label className="grid gap-1.5">
            <Label>Status</Label>
            <select
              aria-label="Status"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as Editable["status"],
                })
              }
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={() => void onSave(draft)}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
