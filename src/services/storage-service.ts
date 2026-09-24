
import { BaseService } from './base-service';

/**
 * @fileOverview StorageService handles secure file uploads to Supabase buckets.
 * Enforces business-level isolation, path sanitization, and file validation.
 */
export class StorageService extends BaseService {
  private bucket = 'business-assets';

  /**
   * Sanitizes path to prevent directory traversal attacks (SEC-03 Fix)
   */
  private sanitizePath(path: string): string {
    // Remove any relative path segments like ../ or ./
    // and keep only alphanumeric, hyphens, and slashes
    return path.replace(/\.\.+\//g, '').replace(/[^a-zA-Z0-9\/\-_]/g, '-');
  }

  async uploadFile(path: string, file: File | Blob) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context required for storage');

    // Validation
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) throw new Error('File exceeds 5MB limit');

    // Secure Path: {businessId}/{sanitized_path}
    const sanitizedPath = this.sanitizePath(path);
    const fullPath = `${businessId}/${sanitizedPath}`;

    const { data, error } = await supabase.storage
      .from(this.bucket)
      .upload(fullPath, file, {
        upsert: true,
        contentType: file.type
      });

    if (error) {
      console.error('Storage Upload Error:', error);
      throw new Error('Failed to upload asset to secure storage.');
    }
    
    // Return the signed URL for the newly uploaded asset
    return this.getSignedUrl(fullPath);
  }

  async getSignedUrl(path: string, expiresIn = 3600) {
    const { supabase } = await this.getContext();
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error('Signed URL Error:', error);
      throw new Error('Unauthorized asset access.');
    }
    return data.signedUrl;
  }

  async deleteFile(path: string) {
    const { supabase, businessId } = await this.getContext();
    
    // Strict isolation: User can only delete if path starts with their businessId
    if (!path.startsWith(businessId!)) {
      throw new Error('Unauthorized: Storage isolation violation.');
    }

    const { error } = await supabase.storage
      .from(this.bucket)
      .remove([path]);

    if (error) throw error;
    return true;
  }
}
