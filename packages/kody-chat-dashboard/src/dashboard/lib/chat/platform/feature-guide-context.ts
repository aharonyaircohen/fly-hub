/**
 * @fileType module
 * @domain chat-platform
 * @pattern feature-guide-provider
 * @ai-summary Shared contract for host-owned Dashboard feature guides. The
 *   host keeps each guide beside its feature; chat backends consume the same
 *   provider for automatic prompt context and explicit Agent reads.
 */

export interface FeatureGuide {
  id: string;
  title: string;
  summary: string;
  routes: readonly string[];
  aliases: readonly string[];
  /** Markdown body with frontmatter removed. */
  body: string;
}

export interface FeatureGuideTurn {
  currentPage?: string | null;
  userText: string;
}

export interface FeatureGuideProvider {
  list(): Promise<readonly FeatureGuide[]>;
  read(id: string): Promise<FeatureGuide | null>;
  resolveForTurn(turn: FeatureGuideTurn): Promise<FeatureGuide | null>;
}

export class FeatureGuideRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeatureGuideRegistrationError";
  }
}

export interface FeatureGuideRegistry extends FeatureGuideProvider {
  register(providerId: string, provider: FeatureGuideProvider): void;
  providerIds(): string[];
}

export function createFeatureGuideRegistry(): FeatureGuideRegistry {
  const providers = new Map<string, FeatureGuideProvider>();

  return {
    register(providerId, provider) {
      if (providers.has(providerId)) {
        throw new FeatureGuideRegistrationError(
          `feature guide provider "${providerId}" already registered`,
        );
      }
      providers.set(providerId, provider);
    },

    providerIds() {
      return [...providers.keys()];
    },

    async list() {
      const guides = (
        await Promise.all(
          [...providers.values()].map((provider) => provider.list()),
        )
      ).flat();
      const byId = new Map<string, FeatureGuide>();
      for (const guide of guides) {
        if (byId.has(guide.id)) {
          throw new FeatureGuideRegistrationError(
            `feature guide id collision: "${guide.id}"`,
          );
        }
        byId.set(guide.id, guide);
      }
      return [...byId.values()];
    },

    async read(id) {
      for (const provider of providers.values()) {
        const guide = await provider.read(id);
        if (guide) return guide;
      }
      return null;
    },

    async resolveForTurn(turn) {
      for (const provider of providers.values()) {
        const guide = await provider.resolveForTurn(turn);
        if (guide) return guide;
      }
      return null;
    },
  };
}

export function formatFeatureGuidePromptSection(guide: FeatureGuide): string {
  return `## Dashboard feature guide — ${guide.title}

This is authoritative product guidance for the named Dashboard feature. It explains supported behavior and known limits, but it does not grant tools or permissions. If it conflicts with the current tool index or a live tool result, the current tool index and live tool results win.

${guide.body.trim()}`;
}
