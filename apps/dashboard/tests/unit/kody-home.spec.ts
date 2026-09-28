import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  auth: null as object | null,
  loading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@dashboard/lib/auth-context", () => ({
  useAuth: () => ({ auth: mocks.auth, loading: mocks.loading }),
}));
vi.mock("@dashboard/lib/components/DashboardHome", () => ({
  DashboardHome: () => createElement("div", null, "Repository dashboard"),
}));

import { KodyHome } from "@dashboard/lib/components/KodyHome";

describe("Kody home", () => {
  beforeEach(() => {
    mocks.auth = null;
    mocks.loading = false;
    vi.clearAllMocks();
  });

  it("does not render repository dashboard content without a repository", () => {
    expect(renderToStaticMarkup(createElement(KodyHome))).not.toContain(
      "Repository dashboard",
    );
  });

  it("renders repository dashboard content when a repository is connected", () => {
    mocks.auth = {};
    expect(renderToStaticMarkup(createElement(KodyHome))).toContain(
      "Repository dashboard",
    );
  });
});
