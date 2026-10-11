import { boundedBody, fileRequest, fileUuid, requireSameOrigin, uploadContext, UploadError, uploadFailure } from '@/lib/upload-proxy';
import { uploadPolicy, type UploadPurpose } from '@/lib/upload-policy';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const context = await uploadContext();
    const query = new URL(request.url).searchParams;
    const purpose = query.get('purpose') as UploadPurpose;
    if (!Object.hasOwn(uploadPolicy.purposes,purpose)) throw new UploadError(422,'Unknown upload purpose');
    const parsed = fileUuid.safeParse(query.get('resource_id'));
    if (!parsed.success) throw new UploadError(422,'Invalid attachment resource');
    const body = await boundedBody(request,uploadPolicy.purposes[purpose].max_bytes);
    const response = await fileRequest(context,`?${new URLSearchParams({purpose,resource_id:parsed.data})}`,{
      method:'POST',body:body as BodyInit,headers:{'Content-Type':request.headers.get('content-type') || '', 'X-Upload-Filename':request.headers.get('x-upload-filename') || ''},
    });
    const result = await response.json();
    const ident = fileUuid.safeParse(result.id);
    if (!ident.success) throw new UploadError(503,'Invalid file service response');
    if (purpose==='logo') {
      const { error } = await context.supabase.from('businesses').update({logo_url:`/api/files/${ident.data}?preview=true`}).eq('id',context.businessId);
      if (error) {
        await fileRequest(context,`/${ident.data}`,{method:'DELETE'}).catch(() => undefined);
        throw new UploadError(503,'Logo could not be saved. Please retry.');
      }
    }
    return Response.json({...result,download_url:`/api/files/${ident.data}`,preview_url:`/api/files/${ident.data}?preview=true`},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch (error) { return uploadFailure(error); }
}
export async function GET(request: Request) {
  try {
    const context=await uploadContext(); const query=new URL(request.url).searchParams;
    const purpose=query.get('purpose') as UploadPurpose; const resource=fileUuid.safeParse(query.get('resource_id'));
    if (!Object.hasOwn(uploadPolicy.purposes,purpose) || !resource.success) throw new UploadError(422,'Invalid attachment resource');
    const {data,error}=await context.supabase.from('upload_records').select('id,original_name,mime,size_bytes').eq('business_id',context.businessId).eq('purpose',purpose).eq('resource_id',resource.data).eq('state','approved').order('created_at',{ascending:false});
    if (error) throw new UploadError(503,'Attachments unavailable');
    return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return uploadFailure(error);}
}
