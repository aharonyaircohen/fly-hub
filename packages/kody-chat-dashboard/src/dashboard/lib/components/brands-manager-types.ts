/**
 * @fileType types
 * @domain client-chat
 * @pattern brands-manager-types
 * @ai-summary Shared data shapes for the client brand admin UI.
 */

import type {
  ClientBrandAccess,
  ClientBrandAppearance,
} from "@kody-ade/base/client-brand";

export interface BrandRow {
  slug: string;
  name: string;
  accent: string;
  appearance?: ClientBrandAppearance;
  locale?: string;
  welcomeText?: string;
  modelId?: string;
  agentSlug?: string;
  access: ClientBrandAccess;
  source: "repo" | "builtin";
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface BrandsQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export interface SavePayload {
  slug: string;
  name: string;
  accent: string;
  appearance?: ClientBrandAppearance;
  locale?: string;
  welcomeText?: string;
  modelId?: string;
  agentSlug?: string;
  access: ClientBrandAccess;
  isUpdate: boolean;
}

export interface BrandLanguageOption {
  code: string;
  name: string;
}

export interface BrandModelOption {
  id: string;
  label: string;
}

export interface BrandAgentOption {
  slug: string;
  title: string;
}
