import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { KodyChat } from "@kody-ade/kody-chat";
import "@kody-ade/kody-chat/styles.css";

const STORAGE_PREFIX = "external-kody-chat:";
const CATALOG_KEY = "external-kody-chat:catalog";

function readCatalog() {
  const value = localStorage.getItem(CATALOG_KEY);
  return value
    ? JSON.parse(value)
    : [{ id: "external-demo", title: "External demo" }];
}

function writeCatalog(conversations) {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(conversations));
}

const host = {
  conversationId: "external-demo",
  conversations: {
    async list() {
      return readCatalog();
    },
    async create() {
      const conversation = {
        id: `external-${Date.now()}`,
        title: "New conversation",
      };
      writeCatalog([...readCatalog(), conversation]);
      return conversation;
    },
    async rename(conversationId, title) {
      const renamed = readCatalog().map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, title }
          : conversation,
      );
      writeCatalog(renamed);
    },
    async remove(conversationId) {
      writeCatalog(
        readCatalog().filter(
          (conversation) => conversation.id !== conversationId,
        ),
      );
      localStorage.removeItem(`${STORAGE_PREFIX}${conversationId}`);
    },
    async load(conversationId) {
      const value = localStorage.getItem(`${STORAGE_PREFIX}${conversationId}`);
      return value ? JSON.parse(value) : [];
    },
    async save(conversationId, messages) {
      if (localStorage.getItem("external-kody-chat:fail-save") === "true") {
        throw {
          kind: "storage",
          message: "External storage failed",
          retryable: true,
        };
      }
      localStorage.setItem(
        `${STORAGE_PREFIX}${conversationId}`,
        JSON.stringify(messages),
      );
    },
  },
  getContext() {
    return { surface: "external-demo" };
  },
  async uploadAttachment(file) {
    return {
      id: `attachment-${file.name}`,
      name: file.name,
      mediaType: file.type,
      size: file.size,
    };
  },
  transport: {
    async send(input, { signal, emit }) {
      if (input.message.content === "fail") {
        throw new Error("External transport failed");
      }
      if (input.message.content === "navigate") {
        emit({ type: "navigate", href: "/external/help" });
      }
      if (input.message.content === "unauthorized") {
        const response = await fetch("/api/private");
        throw new Error(await response.text());
      }
      const reply = input.message.attachments?.length
        ? `Attachment received in ${input.conversationId}`
        : input.message.content === "context"
          ? `Context: ${input.context?.surface}`
          : input.message.content === "slow"
            ? "This reply should be cancelled"
            : "Hello from external host";
      for (const word of reply.split(" ")) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 35);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Cancelled", "AbortError"));
            },
            { once: true },
          );
        });
        emit({ type: "text-delta", text: `${word} ` });
      }
      emit({ type: "done" });
    },
  },
};

function App() {
  const [navigation, setNavigation] = useState("");
  const [pluginEvent, setPluginEvent] = useState("");
  const connectedHost = useMemo(
    () => ({
      ...host,
      navigate: setNavigation,
      plugins: [
        {
          id: "external-audit",
          onEvent(event) {
            setPluginEvent(event.type);
          },
        },
      ],
    }),
    [],
  );
  return (
    <>
      <KodyChat host={connectedHost} title="External Kody Chat" />
      <button
        onClick={() =>
          localStorage.setItem("external-kody-chat:fail-save", "true")
        }
        type="button"
      >
        Fail saves
      </button>
      <button
        onClick={() =>
          localStorage.setItem("external-kody-chat:fail-save", "false")
        }
        type="button"
      >
        Allow saves
      </button>
      <output data-testid="navigation-result">{navigation}</output>
      <output data-testid="plugin-event">{pluginEvent}</output>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
