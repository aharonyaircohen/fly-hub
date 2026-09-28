/**
 * @fileType component
 * @domain files
 * @pattern file-search
 * @ai-summary Full-text code search for the /files page. Debounces
 *   300ms, shows results grouped by file with matched snippets, and
 *   supports click-to-navigate to the match.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Loader2, FileCode2, X } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";
import type { SearchResult } from "../lib/repo-files";
import { useFilesTransport } from "../lib/transport";

interface FileSearchProps {
  onResultClick: (path: string, line?: number) => void;
  onClose?: () => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function FileSearch({ onResultClick, onClose }: FileSearchProps) {
  const transport = useFilesTransport();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search when debounced query changes
  useEffect(() => {
    if (!transport?.search || debouncedQuery.trim().length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }

    const doSearch = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await transport.search!(debouncedQuery);
        setResults(data.results);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    };

    doSearch();
  }, [transport, debouncedQuery]);

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setTotal(0);
    onClose?.();
  };

  // Group results by file path
  const groupedResults = results.reduce<Record<string, SearchResult[]>>(
    (acc, result) => {
      const key = result.path;
      if (!acc[key]) acc[key] = [];
      acc[key].push(result);
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 shrink-0">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* eslint-disable-next-line react/forbid-elements -- borderless inline search field; kit Input's chrome would change the composed search bar */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code..."
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        {query && !loading && (
          <Button
            variant="ghost"
            size="clear"
            onClick={handleClear}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="flex items-center justify-center py-8 text-sm text-destructive">
            {error}
          </div>
        )}

        {!error && query.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
            <Search className="mb-2 h-6 w-6" />
            <span>Type at least 2 characters to search</span>
          </div>
        )}

        {!error &&
          query.trim().length >= 2 &&
          !loading &&
          results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
              <span>No results for "{query}"</span>
            </div>
          )}

        {!error && results.length > 0 && (
          <div className="py-1">
            <div className="px-4 py-1 text-xs text-muted-foreground">
              {total} result{total !== 1 ? "s" : ""}
            </div>

            {Object.entries(groupedResults).map(([filePath, fileResults]) => (
              <div key={filePath} className="border-b border-border">
                <div className="flex items-center gap-2 bg-muted/50 px-4 py-1.5">
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="clear"
                    className="truncate text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={() => onResultClick(filePath)}
                  >
                    {filePath}
                  </Button>
                </div>

                {fileResults.map((result, i) => (
                  <Button
                    key={i}
                    variant="ghost"
                    size="clear"
                    className={cn(
                      "block w-full text-left rounded-none px-4 py-1.5 pl-10 text-xs font-normal",
                      "hover:bg-muted/50 hover:text-inherit",
                      "font-mono whitespace-pre-wrap break-all",
                    )}
                    onClick={() =>
                      onResultClick(
                        filePath,
                        result.lineInFragment ?? undefined,
                      )
                    }
                  >
                    {result.lineInFragment && (
                      <span className="mr-2 text-muted-foreground">
                        {result.lineInFragment}:
                      </span>
                    )}
                    <span className="text-foreground/80">{result.snippet}</span>
                  </Button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
