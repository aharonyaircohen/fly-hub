import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBrainPackageImageDiscoveryCache,
  deleteBrainPackageImage,
  discoverBrainPackageImages,
} from "@kody-ade/brain/image-catalog";

describe("Brain image catalog discovery cache", () => {
  afterEach(() => {
    clearBrainPackageImageDiscoveryCache();
    vi.restoreAllMocks();
  });

  it("reuses GHCR package discovery for repeated polls", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            created_at: "2026-07-07T00:00:00.000Z",
            updated_at: "2026-07-07T00:01:00.000Z",
            metadata: { container: { tags: ["saved"] } },
          },
        ],
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      owner: "owner",
      repo: "repo",
      account: "acc",
      githubToken: "token",
    };
    const first = await discoverBrainPackageImages(input);
    const second = await discoverBrainPackageImages(input);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deletes the exact GHCR package version and clears discovery cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 73,
              metadata: { container: { tags: ["saved"] } },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteBrainPackageImage({
        owner: "owner",
        repo: "repo",
        account: "acc",
        githubToken: "token",
        imageRef: "ghcr.io/owner/kody-brain-acc:saved",
      }),
    ).resolves.toEqual({
      deletedImageRefs: ["ghcr.io/owner/kody-brain-acc:saved"],
      alreadyMissing: false,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/orgs/owner/packages/container/kody-brain-acc/versions/73",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("rejects deletion outside the user's Brain package", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteBrainPackageImage({
        owner: "owner",
        repo: "repo",
        account: "acc",
        githubToken: "token",
        imageRef: "ghcr.io/other/package:saved",
      }),
    ).rejects.toMatchObject({
      code: "brain_image_ref_not_owned",
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves state authority when GitHub denies package deletion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 73,
              metadata: { container: { tags: ["saved"] } },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteBrainPackageImage({
        owner: "owner",
        repo: "repo",
        account: "acc",
        githubToken: "token",
        imageRef: "ghcr.io/owner/kody-brain-acc:saved",
      }),
    ).rejects.toMatchObject({
      code: "brain_image_package_delete_forbidden",
      status: 403,
    });
  });
});
