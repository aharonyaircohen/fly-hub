/**
 * Widget host pure helpers: bundle URL construction with query-param auth,
 * CMS access, Kody-action validation, and mount-contract module validation.
 * The React component itself is
 * not rendered here (no DOM test environment in this repo — see
 * kody-chat-no-auto-dispatch.spec.ts).
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  buildWidgetBundleUrl,
  createWidgetCmsClient,
  normalizeWidgetSubmitResult,
  normalizeWidgetTextRequest,
  resolveWidgetMount,
  resolveWidgetPreviewData,
} from "../../src/dashboard/lib/chat/surface/widget-host";

describe("buildWidgetBundleUrl", () => {
  it("targets the widgets route with owner/repo/token query auth", () => {
    const url = buildWidgetBundleUrl("quiz", {
      owner: "acme",
      repo: "site",
      token: "tok",
    });
    expect(url).toBe("/api/kody/widgets/quiz?owner=acme&repo=site&token=tok");
  });

  it("encodes every URL component", () => {
    const url = buildWidgetBundleUrl("quiz", {
      owner: "acme co",
      repo: "site/one",
      token: "a&b=c",
    });
    const parsed = new URL(url, "https://dash.test");
    expect(parsed.pathname).toBe("/api/kody/widgets/quiz");
    expect(parsed.searchParams.get("owner")).toBe("acme co");
    expect(parsed.searchParams.get("repo")).toBe("site/one");
    expect(parsed.searchParams.get("token")).toBe("a&b=c");
  });
});

describe("resolveWidgetMount", () => {
  it("returns the default export when it is a function", () => {
    const mount = () => undefined;
    expect(resolveWidgetMount({ default: mount })).toBe(mount);
  });

  it("returns null for modules that break the contract", () => {
    expect(resolveWidgetMount(null)).toBeNull();
    expect(resolveWidgetMount(undefined)).toBeNull();
    expect(resolveWidgetMount({})).toBeNull();
    expect(resolveWidgetMount({ default: "nope" })).toBeNull();
    expect(resolveWidgetMount({ mount: () => undefined })).toBeNull();
  });
});

describe("resolveWidgetPreviewData", () => {
  it("returns widget-owned preview data without interpreting it", () => {
    const previewData = { prompt: "What is 2 + 2?" };
    expect(resolveWidgetPreviewData({ previewData })).toBe(previewData);
  });

  it("returns undefined when the widget has no preview data", () => {
    expect(resolveWidgetPreviewData(null)).toBeUndefined();
    expect(resolveWidgetPreviewData({})).toBeUndefined();
  });
});

describe("createWidgetCmsClient", () => {
  const headers = {
    "x-kody-owner": "acme",
    "x-kody-repo": "school",
    "x-kody-token": "secret",
  };

  it("lists CMS documents with the active repository credentials", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = createWidgetCmsClient(headers, async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({
        docs: [{ _id: "question-1", prompt: "2 + 2?" }],
        total: 1,
        limit: 10,
        offset: 0,
      });
    });

    const result = await client.list("record questions", {
      filters: { recordId: { equals: "example" } },
      search: { query: "two", fields: ["prompt"] },
      sort: [{ field: "order", direction: "asc" }],
      limit: 10,
      offset: 0,
      ids: ["question-1"],
    });

    expect(result.docs).toEqual([{ _id: "question-1", prompt: "2 + 2?" }]);
    expect(calls).toHaveLength(1);
    const request = new URL(calls[0]!.input, "https://dashboard.test");
    expect(request.pathname).toBe("/api/kody/cms/record%20questions");
    expect(request.searchParams.get("filters")).toBe(
      JSON.stringify({ recordId: { equals: "example" } }),
    );
    expect(request.searchParams.get("q")).toBe("two");
    expect(request.searchParams.get("searchFields")).toBe("prompt");
    expect(request.searchParams.get("sort")).toBe("order:asc");
    expect(request.searchParams.get("limit")).toBe("10");
    expect(request.searchParams.get("offset")).toBe("0");
    expect(request.searchParams.getAll("ids")).toEqual(["question-1"]);
    expect(calls[0]!.init?.headers).toEqual(headers);
  });

  it("gets one CMS document without changing the host credentials", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = createWidgetCmsClient(headers, async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({
        document: { _id: "question-1", prompt: "2 + 2?" },
      });
    });

    const document = await client.get("questions", "question/1");

    expect(document).toEqual({ _id: "question-1", prompt: "2 + 2?" });
    expect(calls[0]!.input).toBe("/api/kody/cms/questions/question%2F1");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.headers).not.toBe(headers);
    expect(headers).toEqual({
      "x-kody-owner": "acme",
      "x-kody-repo": "school",
      "x-kody-token": "secret",
    });
  });

  it("returns a safe error when CMS rejects a request", async () => {
    const client = createWidgetCmsClient(headers, async () =>
      Response.json({ error: "forbidden" }, { status: 403 }),
    );

    await expect(client.get("questions", "hidden")).rejects.toThrow(
      "CMS request failed (403)",
    );
  });
});

describe("normalizeWidgetTextRequest", () => {
  it("trims the requested text field and rejects invalid requests", () => {
    expect(
      normalizeWidgetTextRequest({ content: "  Try again.  " }, "content"),
    ).toBe("Try again.");
    expect(
      normalizeWidgetTextRequest({ content: " \n " }, "content"),
    ).toBeNull();
    expect(normalizeWidgetTextRequest({ content: 42 }, "content")).toBeNull();
    expect(normalizeWidgetTextRequest(null, "content")).toBeNull();
  });
});

describe("normalizeWidgetSubmitResult", () => {
  it("accepts a non-empty action and opaque object data", () => {
    expect(
      normalizeWidgetSubmitResult({
        actionId: "  correct  ",
        data: { selectedOptionId: "seven" },
      }),
    ).toEqual({
      actionId: "correct",
      data: { selectedOptionId: "seven" },
    });
  });

  it("rejects malformed completion requests", () => {
    expect(normalizeWidgetSubmitResult({ actionId: " " })).toBeNull();
    expect(
      normalizeWidgetSubmitResult({ actionId: "correct", data: [] }),
    ).toBeNull();
    expect(normalizeWidgetSubmitResult(null)).toBeNull();
  });
});
