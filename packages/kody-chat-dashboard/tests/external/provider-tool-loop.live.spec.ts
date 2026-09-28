import { describe, expect, it } from "vitest";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import type { ChatModel } from "@kody-ade/base/variables/models";
import { chatModelAdapter } from "../../app/api/kody/chat/model-adapters";

const RUN_LIVE = process.env.RUN_PROVIDER_LIVE === "1";

const providerCases: Array<{
  name: string;
  key: string | undefined;
  model: ChatModel;
  expectsOpaqueToolMetadata?: boolean;
}> = [
  {
    name: "Gemini 3.6 Flash",
    key: process.env.GEMINI_API_KEY,
    expectsOpaqueToolMetadata: true,
    model: {
      id: "google/gemini-3.6-flash",
      label: "Gemini 3.6 Flash",
      provider: "google",
      adapter: "google",
      adapterBaseURL: "https://generativelanguage.googleapis.com/v1beta",
      protocol: "openai",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      modelName: "gemini-3.6-flash",
      apiKeySecret: "GEMINI_API_KEY",
      enabled: true,
    },
  },
  {
    name: "MiniMax M3",
    key: process.env.MINIMAX_API_KEY,
    model: {
      id: "minimax/MiniMax-M3",
      label: "MiniMax M3",
      provider: "minimax",
      adapter: "openai-compatible",
      adapterBaseURL: "https://api.minimax.io/v1",
      protocol: "openai",
      baseURL: "https://api.minimax.io/v1",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
      enabled: true,
    },
  },
  {
    name: "OpenRouter Free",
    key: process.env.OPENROUTER_API_KEY,
    model: {
      id: "openrouter/free",
      label: "OpenRouter Free",
      provider: "openrouter",
      adapter: "openai-compatible",
      adapterBaseURL: "https://openrouter.ai/api/v1",
      protocol: "openai",
      baseURL: "https://openrouter.ai/api/v1",
      modelName: "openrouter/free",
      apiKeySecret: "OPENROUTER_API_KEY",
      enabled: true,
    },
  },
];

describe.skipIf(!RUN_LIVE)("live provider adapter tool loops", () => {
  it.each(providerCases)(
    "$name preserves a two-step streamed tool loop",
    async ({ key, model, expectsOpaqueToolMetadata }) => {
      expect(key, `${model.apiKeySecret} is required`).toBeTruthy();

      const calls: Array<{ name: string; args: unknown }> = [];
      const toolCallMetadata: unknown[] = [];
      const languageModel = chatModelAdapter(model).create(model, key!);
      const response = streamText({
        model: languageModel,
        system:
          "Follow the requested tool sequence exactly and use tool results.",
        prompt:
          "First call lookup_project with project A-Guy-Web. Then call lookup_blocker with the blockerCode returned by lookup_project. Only after both results, give a short summary.",
        tools: {
          lookup_project: tool({
            description: "Return the blocker code for a project.",
            inputSchema: z.object({ project: z.string() }),
            execute: async (args) => {
              calls.push({ name: "lookup_project", args });
              return {
                project: "A-Guy-Web",
                blockerCode: "B7",
                activeTasks: 2,
              };
            },
          }),
          lookup_blocker: tool({
            description:
              "Return blocker details for a code from lookup_project.",
            inputSchema: z.object({ blockerCode: z.string() }),
            execute: async (args) => {
              calls.push({ name: "lookup_blocker", args });
              return {
                blockerCode: args.blockerCode,
                blocker: "Release check is failing on lint",
              };
            },
          }),
        },
        stopWhen: stepCountIs(5),
        timeout: 90_000,
      });

      let finalText = "";
      for await (const part of response.fullStream) {
        if (part.type === "text-delta") finalText += part.text;
        if (part.type === "tool-call") {
          toolCallMetadata.push(part.providerMetadata);
        }
        if (part.type === "error") throw part.error;
      }

      expect(calls).toEqual([
        {
          name: "lookup_project",
          args: { project: "A-Guy-Web" },
        },
        {
          name: "lookup_blocker",
          args: { blockerCode: "B7" },
        },
      ]);
      expect(finalText.trim()).not.toBe("");
      if (expectsOpaqueToolMetadata) {
        expect(toolCallMetadata).toHaveLength(2);
        expect(
          toolCallMetadata.every(
            (metadata) =>
              metadata != null &&
              typeof metadata === "object" &&
              Object.keys(metadata).length > 0,
          ),
        ).toBe(true);
      }
    },
    120_000,
  );
});
