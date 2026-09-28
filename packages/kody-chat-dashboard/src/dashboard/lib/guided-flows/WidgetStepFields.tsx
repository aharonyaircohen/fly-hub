"use client";

import type { GuidedFlowDraftViewStep } from "./authoring";
import type { ViewRendererDefinition } from "../view-renderers/definition";

export function WidgetStepFields({
  index,
  step,
  renderers,
  readOnly,
  onChange,
}: {
  index: number;
  step: GuidedFlowDraftViewStep;
  renderers: readonly ViewRendererDefinition[];
  readOnly: boolean;
  onChange: (step: GuidedFlowDraftViewStep) => void;
}) {
  return (
    <div className="mt-3 space-y-3">
      <label className="block text-sm text-white/70">
        Widget
        <select
          aria-label={`Step ${index + 1} widget`}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
          value={step.rendererSlug}
          disabled={readOnly}
          onChange={(event) => {
            const renderer = renderers.find(
              (candidate) => candidate.slug === event.target.value,
            );
            if (!renderer) return;
            onChange({
              ...step,
              rendererSlug: renderer.slug,
              rendererVersion: renderer.version ?? 1,
              rendererData: undefined,
              rendererDataJson: "{}",
            });
          }}
        >
          {renderers.map((renderer) => (
            <option key={renderer.slug} value={renderer.slug}>
              {renderer.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-white/70">
        Widget input (JSON)
        <textarea
          aria-label={`Step ${index + 1} widget input`}
          className="mt-1 min-h-24 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm text-white"
          value={step.rendererDataJson ?? "{}"}
          disabled={readOnly}
          onChange={(event) =>
            onChange({
              ...step,
              rendererData: undefined,
              rendererDataJson: event.target.value,
            })
          }
        />
      </label>
      <label className="block text-sm text-white/70">
        Continue when the widget sends
        <input
          aria-label={`Step ${index + 1} completion action`}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
          value={step.completionActionId ?? "complete"}
          disabled={readOnly}
          onChange={(event) =>
            onChange({ ...step, completionActionId: event.target.value })
          }
        />
      </label>
    </div>
  );
}
