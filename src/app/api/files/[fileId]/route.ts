import { fileRequest, fileUuid, requireSameOrigin, uploadContext, UploadError, uploadFailure } from '@/lib/upload-proxy';
export const runtime = 'nodejs';
type Context = { params: Promise<{fileId:string}> };
export async function GET(request: Request, route: Context) {
  try {
    const context=await uploadContext(); const ident=fileUuid.safeParse((await route.params).fileId);
    if (!ident.success) throw new UploadError(404,'File not found');
    const preview=new URL(request.url).searchParams.get('preview')==='true';
    const response=await fileRequest(context,`/${ident.data}${preview?'?preview=true':''}`);
    const mime=response.headers.get('content-type') || '';
    if (!['image/png','image/jpeg'].includes(mime)) throw new UploadError(409,'File requires review');
    const body=await response.arrayBuffer();
    if (body.byteLength>3145728) throw new UploadError(413,'Stored file exceeds the allowed size');
    // Never forward cookies, storage headers, signed redirects, or user-controlled content types.
    const sourceName=response.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9 ._-]{1,120})"/)?.[1];
    const name=sourceName || `file.${mime==='image/png'?'png':'jpg'}`;
    return new Response(body,{headers:{'Content-Type':mime,'Content-Disposition':`${preview?'inline':'attachment'}; filename="${name}"`,
      'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer','Vary':'Cookie'}});
  } catch(error) {return uploadFailure(error);}
}
export async function DELETE(request: Request, route: Context) {
  try {
    requireSameOrigin(request); const context=await uploadContext(); const ident=fileUuid.safeParse((await route.params).fileId);
    if (!ident.success) throw new UploadError(404,'File not found');
    const response=await fileRequest(context,`/${ident.data}`,{method:'DELETE'});
    return Response.json(await response.json(),{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return uploadFailure(error);}
}
