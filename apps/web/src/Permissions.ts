import { Permission, type InstanceClient } from "@haunt/core";
export { Permission };
export function can(instance: InstanceClient, bits: number) {
  return (
    instance.account.login.user.is_owner ||
    !!(instance.snapshot.permissions & Permission.Administrator) ||
    (instance.snapshot.permissions & bits) === bits
  );
}
export function canInChannel(
  instance: InstanceClient,
  channel: string,
  bit: number,
) {
  const entry = instance.snapshot.channels.find((c) => c.id === channel);
  return (
    !!entry &&
    (can(instance, Permission.Administrator) ||
      ((entry.permissions ?? 0) & bit) === bit)
  );
}
export function canManageServer(instance: InstanceClient) {
  return (
    instance.account.login.user.is_owner ||
    !!(
      instance.snapshot.permissions &
      (Permission.ManageChannels |
        Permission.ManageServer |
        Permission.ManageRoles |
        Permission.KickMembers |
        Permission.BanMembers |
        Permission.DeleteMembers |
        Permission.ViewAuditLog |
        Permission.ViewMemberIPs |
        Permission.ResetPasswords |
        Permission.ManageConfiguration |
        Permission.Administrator)
    )
  );
}
export function canManageMembers(instance: InstanceClient) {
  return (
    instance.account.login.user.is_owner ||
    !!(
      instance.snapshot.permissions &
      (Permission.ManageRoles |
        Permission.KickMembers |
        Permission.BanMembers |
        Permission.DeleteMembers |
        Permission.ViewMemberIPs |
        Permission.ResetPasswords |
        Permission.Administrator)
    )
  );
}
