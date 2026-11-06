// Doc 08: a member without the permission an action needs is refused with PERMISSION_DENIED <module.action>; every
// service shows the same plain sentence for it.
export const PERMISSION_MESSAGE = 'You do not have permission to do this in this business. Ask the business owner.';

export function isPermissionRefusal(error: { message?: string | null } | null | undefined) {
  return Boolean(error?.message?.startsWith('PERMISSION_DENIED'));
}
