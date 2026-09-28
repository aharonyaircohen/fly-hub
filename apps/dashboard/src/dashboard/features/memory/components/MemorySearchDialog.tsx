"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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
import type { Memory } from "@dashboard/lib/api/memory";
import { filterMemories } from "../lib/memory-files";

interface MemorySearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memories: readonly Readonly<Memory>[];
  onSelect: (memory: Readonly<Memory>) => void;
}

export function MemorySearchDialog({
  open,
  onOpenChange,
  memories,
  onSelect,
}: MemorySearchDialogProps) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => filterMemories(memories, query),
    [memories, query],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Search memory</DialogTitle>
          <DialogDescription>
            Search titles, content, type, and scope.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="memory-search">Search memory</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="memory-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="max-h-80 overflow-y-auto rounded-md border border-border">
            {matches.length ? (
              <ul className="divide-y divide-border">
                {matches.map((memory) => (
                  <li key={memory.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="clear"
                      className="w-full justify-start px-3 py-3 text-left"
                      aria-label={`Open ${memory.content.title}`}
                      onClick={() => {
                        onOpenChange(false);
                        onSelect(memory);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {memory.content.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {memory.kind} · {memory.content.summary}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No matching memories
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
