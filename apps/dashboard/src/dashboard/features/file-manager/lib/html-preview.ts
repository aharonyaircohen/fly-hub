import { FILE_HTML_PREVIEW_CSP } from "./html-preview-security";

export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function htmlPreviewDocument(content: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${FILE_HTML_PREVIEW_CSP}">`;
  const doctype = content.match(/^\s*<!doctype html(?:\s[^>]*)?>/i)?.[0];

  if (!doctype) {
    return `${policy}\n${content}`;
  }

  return `${doctype}\n${policy}${content.slice(doctype.length)}`;
}
