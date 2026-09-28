/**
 * @fileType component
 * @domain snippets
 * @pattern snippet-injection
 * @ai-summary Client-side injector for brand snippets. React never executes
 *   <script> tags it renders, and inserting nodes into <body> during
 *   progressive hydration breaks Suspense hydration — so this waits for the
 *   window load event, puts scripts in <head> (outside React's scope; the
 *   tag-manager approach) and non-script markup at the end of <body>.
 *   Containment: scripts inject once per page load (an executed script
 *   cannot be un-run — StrictMode remounts must not double-fire it), and
 *   visible markup is removed when the brand page unmounts so nothing
 *   leaks into other routes.
 */
"use client";

import { useEffect } from "react";
import type { SnippetConfig, SnippetPlacement } from "./types";

// Script executions per page load — a script that already ran must never
// run again (React dev StrictMode double-mounts effects).
const executedScriptIds = new Set<string>();

/** Returns the removable (non-script) nodes it added. */
function injectSnippet(snippet: SnippetConfig): Element[] {
  const removable: Element[] = [];
  const template = document.createElement("template");
  template.innerHTML = snippet.html;

  for (const node of Array.from(template.content.children)) {
    if (node.tagName === "SCRIPT") {
      if (executedScriptIds.has(snippet.id)) continue;
      executedScriptIds.add(snippet.id);
      // Recreate the script so the browser executes it; head is outside
      // React's hydration scope.
      const script = document.createElement("script");
      for (const attr of Array.from(node.attributes)) {
        script.setAttribute(attr.name, attr.value);
      }
      script.text = node.textContent ?? "";
      script.setAttribute("data-kody-snippet", snippet.id);
      document.head.appendChild(script);
    } else {
      // Non-script markup (pixels, noscript, iframes) goes at the end of
      // body — after `load`, hydration is complete and React ignores it.
      const container = document.createElement("div");
      container.setAttribute("data-kody-snippet", snippet.id);
      container.appendChild(node);
      document.body.appendChild(container);
      removable.push(container);
    }
  }
  return removable;
}

export function BrandSnippets({
  snippets,
  placement,
}: {
  snippets: readonly SnippetConfig[];
  placement: SnippetPlacement;
}) {
  useEffect(() => {
    const active = snippets.filter(
      (snippet) => snippet.enabled && snippet.placement === placement,
    );
    if (active.length === 0) return;

    let removable: Element[] = [];
    const inject = () => {
      removable = active.flatMap(injectSnippet);
    };

    if (document.readyState === "complete") {
      inject();
      return () => removable.forEach((node) => node.remove());
    }
    window.addEventListener("load", inject, { once: true });
    return () => {
      window.removeEventListener("load", inject);
      removable.forEach((node) => node.remove());
    };
    // Snippets are server-provided per render; identity by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(snippets), placement]);

  return null;
}
