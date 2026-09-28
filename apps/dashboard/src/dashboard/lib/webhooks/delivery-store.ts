import "server-only";

import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

const WEBHOOK_DELIVERY_KIND = "webhook-delivery-health";
export const RECENT_WEBHOOK_DELIVERY_MS = 30 * 24 * 60 * 60 * 1000;

export interface WebhookDeliveryRecord {
  lastReceivedAt: string;
  deliveryId: string;
  event: string;
}

interface StoredWebhookDeliveryRecord {
  doc?: Partial<WebhookDeliveryRecord> & { version?: unknown };
}

function tenantId(owner: string, repo: string): string {
  return `${owner.trim()}/${repo.trim()}`.toLowerCase();
}

export async function recordWebhookDelivery(input: {
  owner: string;
  repo: string;
  deliveryId: string;
  event: string;
  receivedAt?: string;
}): Promise<void> {
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  await createBackendClient().mutation(api.repoDocs.save, {
    tenantId: tenantId(input.owner, input.repo),
    kind: WEBHOOK_DELIVERY_KIND,
    doc: {
      version: 1,
      lastReceivedAt: receivedAt,
      deliveryId: input.deliveryId,
      event: input.event,
    },
    updatedAt: receivedAt,
  });
}

export async function readRecentWebhookDelivery(
  owner: string,
  repo: string,
  options: {
    now?: Date;
    maxAgeMs?: number;
  } = {},
): Promise<WebhookDeliveryRecord | null> {
  const record = (await createBackendClient().query(api.repoDocs.get, {
    tenantId: tenantId(owner, repo),
    kind: WEBHOOK_DELIVERY_KIND,
  })) as StoredWebhookDeliveryRecord | null;
  const doc = record?.doc;
  if (
    doc?.version !== 1 ||
    typeof doc.lastReceivedAt !== "string" ||
    typeof doc.deliveryId !== "string" ||
    typeof doc.event !== "string"
  ) {
    return null;
  }

  const receivedAt = Date.parse(doc.lastReceivedAt);
  const now = (options.now ?? new Date()).getTime();
  const age = now - receivedAt;
  if (
    !Number.isFinite(receivedAt) ||
    age < 0 ||
    age > (options.maxAgeMs ?? RECENT_WEBHOOK_DELIVERY_MS)
  ) {
    return null;
  }

  return {
    lastReceivedAt: doc.lastReceivedAt,
    deliveryId: doc.deliveryId,
    event: doc.event,
  };
}
