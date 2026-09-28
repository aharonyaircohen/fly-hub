/** Minimal structural contract keeps the embeddable chat core package-agnostic. */
export interface ChatProviderModel {
  toolChoice?: {
    required?: boolean;
    named?: boolean;
  };
}

export interface ChatProviderCapabilities {
  supportsRequiredToolChoice: boolean;
  supportsNamedToolChoice: boolean;
}

/**
 * Return only declared wire-level behavior that the chat turn needs to know.
 * Unknown capabilities stay conservative; provider and model names are not
 * treated as capability evidence.
 */
export function getChatProviderCapabilities(
  model: ChatProviderModel,
): ChatProviderCapabilities {
  return {
    supportsRequiredToolChoice: model.toolChoice?.required === true,
    supportsNamedToolChoice: model.toolChoice?.named === true,
  };
}
