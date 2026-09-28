# Fly Hub dashboard UX review

## User goal

Create a machine, get its SSH configuration, see live machines, and review recent activity. These four jobs drive two navigation pages: **Machines** and **History**.

## Findings in the copied Kody dashboard

| Job | Problem in the copied pages | Fly Hub decision |
| --- | --- | --- |
| Connect Fly | Google/GitHub sign-in, repository selection, and a secret in the repo vault stood between the user and Fly machines. | Ask for a Fly API token once. Verify it with Fly, then remember it in an encrypted, HttpOnly cookie for 30 days. |
| Create | The Machines page had no create action; another Kody workflow provisioned machines. | Put **Create machine** on the Machines page. Ask for name, size, region, and idle sleep; prepare SSH during creation. |
| Download SSH | It was only available for machines provisioned with SSH support. | Show a primary download action when ready and an explanation when unavailable. |
| Manage live machines | The page repeated details in many cards and exposed Kody subsystem language. | Use a searchable machine list and one detail panel with status, region, size, SSH, and lifecycle controls. |
| Review history | The copied page showed sampled uptime and estimated cost, which looked more exact than the data supported. | Show recent machine events reported by Fly, with clear timestamps and status. |

`MasterDetailShell` remains the machine page structure. `PageShell` provides the History page.

## Current flow

1. Enter a Fly token. The connected organization appears in the header.
2. Open **Machines** to create, inspect, refresh, suspend, resume, download SSH settings, or destroy a machine.
3. Open **History** to see recent Fly events for machines that still exist.
4. Use the header theme selector for System, Light, or Dark, and the Disconnect icon to remove the remembered session.

## Limits

- The inventory currently lists the Kody-managed Fly app names inherited from the extracted runtime, including Fly Hub machines. It does not list every arbitrary app in the Fly account.
- The login currently selects the first organization returned by Fly for a token. A token scoped to a single organization gives a predictable result.
- Fly's machine event response contains a short recent event list for current machines. The dashboard does not keep events after a machine is deleted.
- SSH download is available only when the machine was created with SSH support.
