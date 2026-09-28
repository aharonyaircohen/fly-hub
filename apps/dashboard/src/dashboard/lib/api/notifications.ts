import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Notifications API ============

import type {
  NotificationRule,
  NotificationEvent,
  NotificationChannel,
} from "../notifications";

export interface NotificationsListResponse {
  rules: NotificationRule[];
  manifest: { issueNumber: number | null };
}

export const notificationsApi = {
  list: async (): Promise<NotificationRule[]> => {
    const res = await fetch(`${API_BASE}/notifications`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<NotificationsListResponse>(res);
    return data.rules;
  },

  create: async (input: {
    name: string;
    enabled?: boolean;
    event: NotificationEvent;
    channel: NotificationChannel;
    template?: string;
    actorLogin?: string;
  }): Promise<NotificationRule> => {
    const res = await fetch(`${API_BASE}/notifications`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ rule: NotificationRule }>(res);
    return data.rule;
  },

  update: async (
    id: string,
    input: {
      name?: string;
      enabled?: boolean;
      event?: NotificationEvent;
      channel?: NotificationChannel;
      template?: string | null;
      actorLogin?: string;
    },
  ): Promise<NotificationRule> => {
    const res = await fetch(
      `${API_BASE}/notifications/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(input),
      },
    );
    const data = await handleResponse<{ rule: NotificationRule }>(res);
    return data.rule;
  },

  remove: async (id: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/notifications/${encodeURIComponent(id)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ ok: true }>(res);
  },

  test: async (input: {
    channel: NotificationChannel;
    text: string;
    actorLogin?: string;
  }): Promise<{ ok: true }> => {
    const res = await fetch(`${API_BASE}/notifications/test`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse<{ ok: true }>(res);
  },
};
