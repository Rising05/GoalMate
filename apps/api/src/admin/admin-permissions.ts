export type AdminRole = "OPERATOR" | "SYSTEM_ADMIN" | "SUPER_ADMIN";

export type AdminPermission =
  | "VIEW_USER_SUMMARY"
  | "VIEW_GOAL_STATUS"
  | "ADJUST_MEMBERSHIP"
  | "VIEW_NOTIFICATION_LOGS"
  | "RETRY_NOTIFICATION"
  | "VIEW_AI_JOBS"
  | "RETRY_AI_JOBS"
  | "MANAGE_SYSTEM_CONFIG"
  | "VIEW_SYSTEM_METRICS"
  | "VIEW_RAW_USER_CONTENT"
  | "REFUND_PAYMENT"
  | "MANAGE_ADMINS";

export const ADMIN_ROLES = new Set<AdminRole>([
  "OPERATOR",
  "SYSTEM_ADMIN",
  "SUPER_ADMIN"
]);

const rolePermissions: Record<AdminRole, AdminPermission[]> = {
  OPERATOR: [
    "VIEW_USER_SUMMARY",
    "VIEW_GOAL_STATUS",
    "ADJUST_MEMBERSHIP",
    "VIEW_NOTIFICATION_LOGS",
    "RETRY_NOTIFICATION",
    "VIEW_AI_JOBS"
  ],
  SYSTEM_ADMIN: [
    "VIEW_USER_SUMMARY",
    "VIEW_GOAL_STATUS",
    "ADJUST_MEMBERSHIP",
    "VIEW_NOTIFICATION_LOGS",
    "RETRY_NOTIFICATION",
    "VIEW_AI_JOBS",
    "RETRY_AI_JOBS",
    "MANAGE_SYSTEM_CONFIG",
    "VIEW_SYSTEM_METRICS"
  ],
  SUPER_ADMIN: [
    "VIEW_USER_SUMMARY",
    "VIEW_GOAL_STATUS",
    "ADJUST_MEMBERSHIP",
    "VIEW_NOTIFICATION_LOGS",
    "RETRY_NOTIFICATION",
    "VIEW_AI_JOBS",
    "RETRY_AI_JOBS",
    "MANAGE_SYSTEM_CONFIG",
    "VIEW_SYSTEM_METRICS",
    "VIEW_RAW_USER_CONTENT",
    "REFUND_PAYMENT",
    "MANAGE_ADMINS"
  ]
};

export function getAdminPermissions(role: string | null | undefined) {
  if (!role || !ADMIN_ROLES.has(role as AdminRole)) {
    return [];
  }

  return rolePermissions[role as AdminRole];
}

export function hasAdminPermission(
  role: string | null | undefined,
  permission: AdminPermission
) {
  return getAdminPermissions(role).includes(permission);
}
