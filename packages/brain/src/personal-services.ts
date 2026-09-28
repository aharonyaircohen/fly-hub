/** Host-owned services required by the personal Brain control plane. */
export interface PersonalBrainUser {
  id: string;
  label: string;
  email?: string;
}

export type PersonalBrainStateName =
  "app" | "images" | "image-save" | "runtime" | "models" | "agent-access";

export interface PersonalBrainServices {
  resolveUser(): Promise<PersonalBrainUser | null>;
  getCredential(userId: string, name: string): Promise<string | null>;
  getCredentials(userId: string): Promise<Record<string, string>>;
  getRuntimeModel?(userId: string): Promise<{
    engineModel?: string;
    engineModelConfig?: import("@kody-ade/base/variables/models").EngineRuntimeModelConfig;
  }>;
  loadState(
    userId: string,
    name: PersonalBrainStateName,
  ): Promise<unknown | null>;
  saveState(
    userId: string,
    name: PersonalBrainStateName,
    data: unknown,
    expectedDataUpdatedAt?: string | null,
  ): Promise<void>;
  enqueueRestore?(input: {
    userId: string;
    githubAccount: string;
    githubOwner?: string;
    githubToken: string;
    operationId: string;
    imageRef: string;
    reset: boolean;
    dashboardUrl: string;
  }): Promise<void>;
}

let personalBrainServices: PersonalBrainServices | null = null;

export function setPersonalBrainServices(
  services: PersonalBrainServices,
): void {
  personalBrainServices = services;
}

export function getPersonalBrainServices(): PersonalBrainServices {
  if (!personalBrainServices) {
    throw new Error("Personal Brain services are not registered");
  }
  return personalBrainServices;
}

export function resetPersonalBrainServicesForTests(): void {
  personalBrainServices = null;
}
