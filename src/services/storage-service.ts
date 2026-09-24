
import { BaseService } from './base-service';

/**
 * @fileOverview StorageService handles secure file uploads to Supabase buckets.
 * Enforces business-level isolation and file validation.
 */
export class StorageService extends BaseService {
  private bucket = 'business-assets';

  async uploadFile(path: string, file: File | Blob) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context required for storage');

    // Validation
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) throw new Error('File exceeds 5MB limit');

    // Secure Path: {businessId}/{path}
    const fullPath = `${businessId}/${path}`;

    const { data, error } = await supabase.storage
      .from(this.bucket)
      .upload(fullPath, file, {
        upsert: true,
        contentType: file.type
      });

    if (error) throw error;
    
    // Return the signed URL or public URL depending on asset type
    return this.getSignedUrl(fullPath);
  }

  async getSignedUrl(path: string, expiresIn = 3600) {
    const { supabase } = await this.getContext();
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  }

  async deleteFile(path: string) {
    const { supabase, businessId } = await this.getContext();
    if (!path.startsWith(businessId!)) throw new Error('Unauthorized deletion');

    const { error } = await supabase.storage
      .from(this.bucket)
      .remove([path]);

    if (error) throw error;
    return true;
  }
}
