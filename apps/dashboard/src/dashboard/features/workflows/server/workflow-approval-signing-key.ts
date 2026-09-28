export function getWorkflowApprovalSigningKey(): string {
  const signingKey = process.env.KODY_SERVICE_KEY?.trim();
  if (!signingKey) {
    throw new Error("Workflow approval signing is not configured");
  }
  return signingKey;
}
