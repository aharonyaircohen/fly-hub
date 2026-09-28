# Kody Chat

Embeddable React chat with host-owned transport, persistence, context,
attachments, navigation, and plugins. Kody Chat does not ship provider keys,
privileged tools, Dashboard routes, or storage credentials.

## Install

```bash
npm install @kody-ade/kody-chat react react-dom
```

Import `@kody-ade/kody-chat/styles.css` once, then provide a host:

```tsx
import { KodyChat, type KodyChatHost } from "@kody-ade/kody-chat";
import "@kody-ade/kody-chat/styles.css";

const host: KodyChatHost = {
  transport: {
    async send(input, { signal, emit }) {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      if (!response.ok) throw new Error("Chat request failed");
      emit({ type: "text-replace", text: await response.text() });
      emit({ type: "done" });
    },
  },
};

export function App() {
  return <KodyChat host={host} title="Support" />;
}
```

The host may also provide conversation loading/saving, safe page context,
attachment upload, navigation, event plugins, cancellation, and error
reporting. Authentication, authorization, model access, privileged tools,
file validation, and administrative storage stay on the host server.

## Conversations and persistence

Provide `host.conversations` to enable the built-in conversation controls:

```tsx
const host: KodyChatHost = {
  transport,
  conversationId: "support-123",
  conversations: {
    list: () => api.listConversations(),
    create: (input) => api.createConversation(input),
    rename: (id, title) => api.renameConversation(id, title),
    remove: (id) => api.deleteConversation(id),
    load: (id) => api.loadMessages(id),
    save: (id, messages) => api.saveMessages(id, messages),
  },
};
```

The host owns storage, access control, retention, and tenant isolation. A
retryable storage failure is shown in the chat with a `Retry save` action and
is also sent to `onError` as a typed `ChatError`.

## Errors

`onError` receives a stable error with a `kind`, `message`, and `retryable`
flag. Supported kinds are `authentication`, `transport`, `storage`,
`attachment`, and `plugin`. Transport errors render in the assistant message;
storage errors render as a recoverable notice.

## Security boundary

The browser host may contain only safe context and callbacks to authenticated
application endpoints. Provider secrets, administrative database clients,
privileged tool implementations, and authorization decisions must stay on the
host server.

Public imports are `@kody-ade/kody-chat`, `/react`, `/core`, `/knowledge`,
and `/styles.css`. All other paths are private.
