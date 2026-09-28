import { API_BASE, buildHeaders, handleResponse } from "./client";
export interface DiscussionAuthor {
  login: string;
  avatarUrl?: string;
}

export interface DiscussionComment {
  id: string;
  databaseId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  author: DiscussionAuthor | null;
}

export type DiscussionDisabledReason =
  | "discussions_disabled"
  | "category_missing"
  | "provision_failed";

// ============ Messaging channels (team chat over Discussions) ============

export interface MessageChannel {
  number: number;
  id: string;
  name: string;
  url: string;
  commentsCount: number;
  updatedAt: string;
  author: DiscussionAuthor | null;
}

export type MessageChannelsPayload =
  | { enabled: true; channels: MessageChannel[] }
  | {
      enabled: false;
      reason: DiscussionDisabledReason;
      message?: string;
      channels: never[];
    };

export interface MessageThreadPayload {
  channel: { number: number; id: string; name: string; url: string };
  comments: DiscussionComment[];
}

export const messagesApi = {
  listChannels: async (): Promise<MessageChannelsPayload> => {
    const res = await fetch(`${API_BASE}/messages`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    return handleResponse<MessageChannelsPayload>(res);
  },

  createChannel: async (data: {
    name: string;
    topic?: string;
    actorLogin?: string;
  }): Promise<MessageChannel> => {
    const res = await fetch(`${API_BASE}/messages`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ channel: MessageChannel }>(res);
    return payload.channel;
  },

  fetchThread: async (channelNumber: number): Promise<MessageThreadPayload> => {
    const res = await fetch(`${API_BASE}/messages/${channelNumber}`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    return handleResponse<MessageThreadPayload>(res);
  },

  postMessage: async (
    channelNumber: number,
    body: string,
    actorLogin?: string,
  ): Promise<DiscussionComment> => {
    const res = await fetch(`${API_BASE}/messages/${channelNumber}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ body, ...(actorLogin && { actorLogin }) }),
    });
    const payload = await handleResponse<{ comment: DiscussionComment }>(
      res,
    );
    return payload.comment;
  },

  deleteChannel: async (channelNumber: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/messages/${channelNumber}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    await handleResponse<{ ok: true }>(res);
  },
};
