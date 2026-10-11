import 'server-only';
import { fileRequest, fileUuid, uploadContext } from '@/lib/upload-proxy';
import { checkUploadHint, type UploadPurpose } from '@/lib/upload-policy';

/** Server uploads use the same authoritative Python validator as the browser proxy. */
export class StorageService {
  async uploadFile(resource: { purpose: UploadPurpose; resourceId: string }, file: File) {
    checkUploadHint(file,resource.purpose);
    const context=await uploadContext();
    const resourceId=fileUuid.parse(resource.resourceId);
    const response=await fileRequest(context,`?${new URLSearchParams({purpose:resource.purpose,resource_id:resourceId})}`,{
      method:'POST',body:file,headers:{'Content-Type':file.type,'X-Upload-Filename':encodeURIComponent(file.name)},
    });
    return response.json() as Promise<{id:string;original_name:string;mime:string;size_bytes:number}>;
  }
  async deleteFile(id: string) {
    await fileRequest(await uploadContext(),`/${fileUuid.parse(id)}`,{method:'DELETE'}); return true;
  }
}
