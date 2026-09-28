/**
 * Tool names whose implementations belong to the Dashboard host.
 *
 * The chat package may mention these names in its default capability, but it
 * must never implement them with package-local persistence or test fixtures.
 * A host registers the tools it can serve through the server tool registry.
 */
export const DASHBOARD_HOST_TOOL_NAMES = [
  "list_macros",
  "read_macro",
  "rename_macro",
  "delete_macro",
  "list_notification_rules",
  "create_notification_rule",
  "delete_notification_rule",
  "read_operators",
  "set_operators",
  "export_company",
  "import_company",
  "list_inbox",
  "list_reports",
  "read_report",
  "publish_report",
  "remote_implementation",
  "remote_read",
  "remote_write",
  "remote_ls",
] as const;

export type DashboardHostToolName = (typeof DASHBOARD_HOST_TOOL_NAMES)[number];
