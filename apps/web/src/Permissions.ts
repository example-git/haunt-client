import type { InstanceClient } from "@haunt/core";

export const Permission = {
  ManageServer: 32,
  ManageRoles: 64,
  KickMembers: 128,
  BanMembers: 256,
  DeleteMembers: 512,
  ViewAuditLog: 1024,
  ViewMemberIPs: 2048,
  ManageMessages: 4096,
  ResetPasswords: 8192,
  ManageConfiguration: 16384,
  Administrator: 32768,
} as const;
export function can(instance: InstanceClient, bits: number) {
  return (
    instance.account.login.user.is_owner ||
    !!(instance.snapshot.permissions & Permission.Administrator) ||
    (instance.snapshot.permissions & bits) === bits
  );
}
export function canManageServer(instance: InstanceClient) {
  return (
    instance.account.login.user.is_owner ||
    !!(
      instance.snapshot.permissions &
      (4080 | 8192 | 16384 | Permission.Administrator)
    )
  );
}
export function canManageMembers(instance: InstanceClient) {
  return (
    instance.account.login.user.is_owner ||
    !!(
      instance.snapshot.permissions &
      (64 | 128 | 256 | 512 | 2048 | 8192 | Permission.Administrator)
    )
  );
}
