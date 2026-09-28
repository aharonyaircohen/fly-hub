export interface InternalLink {
  href: string;
  label: string;
}

export function isSafeInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function shouldInterceptInternalLinkClick(input: {
  href?: string | null;
  target?: string | null;
  download?: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): boolean {
  return Boolean(
    input.href &&
      isSafeInternalHref(input.href) &&
      !input.href.startsWith("#") &&
      input.target !== "_blank" &&
      !input.download &&
      (input.button ?? 0) === 0 &&
      !input.metaKey &&
      !input.ctrlKey &&
      !input.shiftKey &&
      !input.altKey,
  );
}

export function formatInternalLinks(links: readonly InternalLink[]): string {
  return links
    .filter((link) => isSafeInternalHref(link.href) && link.label.trim())
    .map((link) => `[${link.label.trim()}](${link.href})`)
    .join("\n");
}

export function stripConflictingInternalLinks(
  answer: string,
  links: readonly InternalLink[],
): string {
  return links.reduce((current, link) => {
    const label = link.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `\\[${label}\\]\\((?!${escapeRegExp(link.href)})[^)]+\\)`,
      "g",
    );
    return current.replace(pattern, "");
  }, answer);
}

/** Keep tool-validated Markdown destinations and make untrusted links plain text. */
export function stripUntrustedMarkdownLinks(
  answer: string,
  links: readonly InternalLink[],
): string {
  const trusted = new Set(
    links
      .filter((link) => isSafeInternalHref(link.href))
      .map((link) => link.href),
  );
  return answer.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) =>
    trusted.has(href) ? match : label,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
