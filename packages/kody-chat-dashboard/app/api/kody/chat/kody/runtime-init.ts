let initialized = false;

/** Initialize chat runtime hooks once, only from a server route. */
export async function ensureKodyRuntimeInitialized(): Promise<void> {
  if (initialized) return;

  const [{ after }, { setEventFlushScheduler }, { registerBrainHostHooks }, { ensureTriggerStateWriter }] = await Promise.all([
    import("next/server"),
    import("@kody-ade/base/events"),
    import("@kody-ade/brain/register"),
    import("@kody-ade/kody-chat-dashboard/user-state"),
  ]);

  setEventFlushScheduler(after);
  registerBrainHostHooks();
  ensureTriggerStateWriter();
  initialized = true;
}
