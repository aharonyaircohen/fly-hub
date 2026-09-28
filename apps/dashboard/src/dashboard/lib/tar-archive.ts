/**
 * @fileType utility
 * @domain kody
 * @pattern tar-archive
 * @ai-summary Minimal pure tar reader for GitHub tarball archives. Parses
 *   512-byte ustar headers, handles the ustar prefix field and GNU long-name
 *   ('L') entries, and returns regular files only. Lets the backend export
 *   route fetch a whole backend in one API call instead of one REST
 *   request per file (see the rate-limit rules in apps/dashboard/CLAUDE.md).
 */

export interface TarFileEntry {
  path: string;
  content: Buffer;
}

const BLOCK_SIZE = 512;

function readString(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString("utf8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`tar: invalid octal field at offset ${offset}`);
  }
  return value;
}

function isEndBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

/**
 * Parse an (already gunzipped) tar archive and return its regular files.
 * Directory, pax, and other metadata entries are skipped; GNU long-name
 * ('L') entries are applied to the following file.
 */
export function parseTarEntries(archive: Buffer): TarFileEntry[] {
  const entries: TarFileEntry[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    if (isEndBlock(header)) break;

    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) {
      throw new Error("tar: truncated archive");
    }
    const content = archive.subarray(dataStart, dataEnd);

    if (typeflag === "L") {
      // GNU long name: content is the real name of the next entry.
      pendingLongName = readString(content, 0, content.length);
    } else if (typeflag === "0" || typeflag === "\0") {
      const name = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      const path = pendingLongName ?? (prefix ? `${prefix}/${name}` : name);
      pendingLongName = null;
      entries.push({ path, content: Buffer.from(content) });
    } else {
      // Directories, pax headers ('x'/'g'), links, … — not exported files.
      pendingLongName = null;
    }

    offset = dataEnd + ((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE);
  }

  return entries;
}
