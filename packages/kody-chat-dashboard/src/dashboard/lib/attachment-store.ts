import { authHeaders } from "./kody-chat-live-session";

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface AttachmentRecord extends AttachmentRef {
  blob: Blob;
  createdAt: string;
}

type PendingAttachment = AttachmentRecord;
const pending = new Map<string, PendingAttachment>();
const SEPARATOR = "::";

function pendingId(): string {
  return `pending-${crypto.randomUUID()}`;
}

function encodeStoredId(conversationId: string, attachmentId: string): string {
  return `${conversationId}${SEPARATOR}${attachmentId}`;
}

function decodeStoredId(
  id: string,
): { conversationId: string; attachmentId: string } | null {
  const separator = id.indexOf(SEPARATOR);
  if (separator < 1) return null;
  return {
    conversationId: id.slice(0, separator),
    attachmentId: id.slice(separator + SEPARATOR.length),
  };
}

async function upload(
  conversationId: string,
  record: AttachmentRecord,
): Promise<AttachmentRef> {
  const form = new FormData();
  form.set(
    "file",
    new File([record.blob], record.name, { type: record.mimeType }),
  );
  const response = await fetch(
    `/api/kody/chat/conversations/${encodeURIComponent(conversationId)}/attachments`,
    { method: "POST", headers: authHeaders(), body: form },
  );
  if (!response.ok) {
    throw new Error(`Attachment upload failed (${response.status})`);
  }
  const stored = (await response.json()) as AttachmentRef;
  return {
    ...stored,
    id: encodeStoredId(conversationId, stored.id),
  };
}

export async function putAttachment(data: {
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  conversationId?: string;
}): Promise<AttachmentRef> {
  const record: AttachmentRecord = {
    id: pendingId(),
    name: data.name,
    mimeType: data.mimeType,
    size: data.size,
    blob: data.blob,
    createdAt: new Date().toISOString(),
  };
  if (data.conversationId) return await upload(data.conversationId, record);
  pending.set(record.id, record);
  return record;
}

export async function persistPendingAttachment(
  conversationId: string,
  ref: AttachmentRef,
): Promise<AttachmentRef> {
  const record = pending.get(ref.id);
  if (!record) return ref;
  const stored = await upload(conversationId, record);
  pending.delete(ref.id);
  return stored;
}

export async function getAttachment(
  id: string,
): Promise<AttachmentRecord | null> {
  const local = pending.get(id);
  if (local) return local;
  const stored = decodeStoredId(id);
  if (!stored) return null;
  const response = await fetch(
    `/api/kody/chat/conversations/${encodeURIComponent(stored.conversationId)}/attachments/${encodeURIComponent(stored.attachmentId)}`,
    { headers: authHeaders(), cache: "no-store" },
  );
  if (!response.ok) return null;
  const blob = await response.blob();
  return {
    id,
    name: "",
    mimeType: blob.type,
    size: blob.size,
    blob,
    createdAt: "",
  };
}

export async function getAttachmentDataUrl(id: string): Promise<string | null> {
  const record = await getAttachment(id);
  return record ? await blobToDataUrl(record.blob) : null;
}

export async function deleteAttachment(id: string): Promise<void> {
  if (pending.delete(id)) return;
  const stored = decodeStoredId(id);
  if (!stored) return;
  const response = await fetch(
    `/api/kody/chat/conversations/${encodeURIComponent(stored.conversationId)}/attachments/${encodeURIComponent(stored.attachmentId)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!response.ok) {
    throw new Error(`Attachment delete failed (${response.status})`);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
