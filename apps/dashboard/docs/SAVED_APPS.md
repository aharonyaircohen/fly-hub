# Saved apps

The Apps page supports **Save app** and **Create from saved app**. Saving captures
the runtime machine and its password gateway, their root filesystems, every
configured mounted volume, image startup configuration, Fly machine settings,
and declared Fly app secrets. File owners, permissions, ACLs, and extended
attributes are retained. Each machine is locked against concurrent Fly changes
while it is copied; a conflicting operation fails with a visible explanation.
App processes pause while their files are copied
and resume on success or failure. A watchdog resumes them after 15 minutes if an
export is interrupted. Generated kernel and Fly boot files are rebuilt on restore;
RAM and running processes are not saved.

The user connects a classic GitHub token with `write:packages`. FlyHub stores it
in an encrypted, HTTP-only session cookie. Snapshots are timestamped versions in
the user's **private** `ghcr.io/<user>/flyhub-saved-apps` package. The snapshot's
files and metadata are encrypted with AES-256-GCM before upload. These are
encrypted backup images: use FlyHub to restore them, rather than `docker run`.
Keep the dashboard's `KODY_MASTER_KEY` backed up; without it snapshots cannot be
decrypted. Other people cannot restore these snapshots just by pulling the image.

Restore creates a new app and runtime, rebuilds the images from the saved files,
creates and fills new volumes before startup, restores app credentials, and
generates a new outer FlyHub password. The app's existing internal login is kept.
Both passwords remain available from **Deployed apps → Show password**. The
original app and saved version remain available. On restore failure the worker
removes its incomplete apps; failed cleanup reports the exact app names.

The long-running operation runs in the existing Fly builder host. Its status and
failure phase are retained in Fly machine metadata and shown under Saved apps.
Restored machines have up to ten minutes to pull and boot their image. Progress
separates image upload, volume loading, and runtime/gateway startup. Startup
failures report the destination app, machine ID, observed state, and last start
HTTP status so the failure can be located without guessing.
Job credentials are removed from the worker after completion. If a worker is
killed, the next status read records the interruption, removes its credentials,
and attempts to remove any incomplete restored apps. Publish the
builder image after editing `packages/fly/builder/src/app-image-*.ts`, set
`FLY_HUB_BUILDER_IMAGE` on the dashboard, and redeploy the dashboard.

The initial implementation supports FlyHub apps with one runtime and one password
gateway. External databases and remote services are outside the machine backup.
Restore checks startup health and password protection; it does not promise that
an external provider will still accept a saved account or credential.
