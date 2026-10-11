import policy from '../../backend/cacu/uploads/policy.json';
export type UploadPurpose = keyof typeof policy.purposes;
export const uploadPolicy = policy;
export const imageAccept = '.png,.jpg,.jpeg,image/png,image/jpeg';
export function uploadHint(purpose: UploadPurpose) { return `PNG or JPG, up to ${policy.purposes[purpose].max_bytes / 1048576} MB.`; }
export function checkUploadHint(file: File, purpose: UploadPurpose) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const match = Object.values(policy.formats).find(rule => (rule.extensions as string[]).includes(extension || ''));
  if (!match || match.mime !== file.type) throw new Error('Choose a PNG or JPG image.');
  if (!file.size || file.size > policy.purposes[purpose].max_bytes) throw new Error(uploadHint(purpose));
}
export function isApprovedPreview(path: unknown): path is string {
  return typeof path === 'string' && /^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\?preview=true$/.test(path);
}
