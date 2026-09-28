"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Label } from "@kody-ade/base/ui/label";
import type { QualityMap } from "./types";

export function QualityRunDialog({
  open,
  map,
  initialScenario,
  running,
  onClose,
  onRun,
}: {
  open: boolean;
  map: QualityMap;
  initialScenario?: string;
  running: boolean;
  onClose: () => void;
  onRun: (scenarioSlug: string) => Promise<void>;
}) {
  const executable = useMemo(
    () =>
      map.scenarios.filter((scenario) => {
        return Boolean(
          scenario.status === "active" &&
          scenario.environmentId &&
          scenario.journeySlugs.length > 0 &&
          scenario.journeySlugs.every((journeySlug) => {
            const journey = map.journeys.find(
              (candidate) => candidate.slug === journeySlug,
            );
            return Boolean(
              journey?.status === "active" &&
              journey.actionSlugs.length > 0 &&
              journey.actionSlugs.every((slug) =>
                map.actions.some(
                  (action) =>
                    action.slug === slug && action.status === "active",
                ),
              ),
            );
          }),
        );
      }),
    [map.actions, map.journeys, map.scenarios],
  );
  const [scenarioSlug, setScenarioSlug] = useState("");

  useEffect(() => {
    setScenarioSlug(
      executable.some((scenario) => scenario.slug === initialScenario)
        ? (initialScenario ?? "")
        : (executable[0]?.slug ?? ""),
    );
  }, [initialScenario, open, executable]);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start Quality Run</DialogTitle>
          <DialogDescription>
            Kody will act as a live user and run the Scenario&apos;s Journeys in
            order.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 py-2">
          <Label>Scenario</Label>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={scenarioSlug}
            onChange={(event) => setScenarioSlug(event.target.value)}
          >
            {executable.map((scenario) => (
              <option key={scenario.slug} value={scenario.slug}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>
        {executable.length === 0 ? (
          <p className="text-sm text-amber-300">
            An active Scenario needs a website to test and active Journeys with
            active Actions. The test runs through the repository&apos;s GitHub
            Engine; it does not run on the selected website.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!scenarioSlug || running}
            onClick={() => void onRun(scenarioSlug)}
          >
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Start Quality Run
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
