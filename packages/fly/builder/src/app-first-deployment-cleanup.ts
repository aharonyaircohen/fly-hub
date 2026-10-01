export async function cleanupFirstDeployment(input: {
  createdApps: string[];
  createdVolumes: Array<{ app: string; id: string }>;
  destroyApp(app: string): Promise<void>;
  destroyVolume(app: string, id: string): Promise<void>;
  appExists(app: string): Promise<boolean>;
}) {
  const errors: string[] = [];
  for (const app of [...input.createdApps].reverse()) {
    try {
      await input.destroyApp(app);
      if (await input.appExists(app))
        throw new Error("Fly has not confirmed removal");
    } catch (error) {
      errors.push(
        `${app}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const volume of input.createdVolumes) {
    if (input.createdApps.includes(volume.app)) continue;
    try {
      await input.destroyVolume(volume.app, volume.id);
    } catch (error) {
      errors.push(
        `volume ${volume.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    status: errors.length ? "needs_attention" : "completed",
    detail: errors.length
      ? `Cleanup needs attention. Remaining resources: ${errors.join("; ")}`
      : input.createdApps.length || input.createdVolumes.length
        ? "Cleanup completed. Resources created by this failed setup were removed. Existing apps and saved backups were kept."
        : "This setup did not create a new app or storage volume. Existing apps and saved backups were kept.",
  };
}
