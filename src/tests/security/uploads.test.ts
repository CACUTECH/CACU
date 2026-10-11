/** @jest-environment node */
import { boundedBody, requireSameOrigin, uploadContext } from '@/lib/upload-proxy';
import { POST } from '@/app/api/files/route';
import { GET, DELETE } from '@/app/api/files/[fileId]/route';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { isApprovedPreview } from '@/lib/upload-policy';

jest.mock('server-only',()=>({}),{virtual:true});
jest.mock('@/lib/supabase/server',()=>({createClient:jest.fn()}));
jest.mock('@/app/business-actions',()=>({getActiveBusinessIdAction:jest.fn()}));
const business='11111111-1111-4111-8111-111111111111';
const ident='22222222-2222-4222-8222-222222222222';
const context={params:Promise.resolve({fileId:ident})};
const fetchMock=jest.fn();
beforeEach(()=>{
  jest.clearAllMocks();process.env.CACU_UPLOAD_API_URL='https://file-api.example';
  (createClient as jest.Mock).mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:ident}}}),getSession:jest.fn().mockResolvedValue({data:{session:{access_token:'test-only'}}})}});
  (getActiveBusinessIdAction as jest.Mock).mockResolvedValue(business);
  global.fetch=fetchMock;
});

test('unauthenticated contexts and cross-origin mutations fail closed',async()=>{
  (createClient as jest.Mock).mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:null}})}});
  await expect(uploadContext()).rejects.toMatchObject({status:401});
  const response=await POST(new Request('https://cacu.example/api/files',{method:'POST',headers:{origin:'https://attacker.example'},body:'x'}));
  expect(response.status).toBe(403);expect(fetchMock).not.toHaveBeenCalled();
  expect(()=>requireSameOrigin(new Request('https://cacu.example/api/files'))).toThrow('Same-origin');
});

test('bounded body rejects oversized chunked requests and invalid content lengths',async()=>{
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10));controller.enqueue(new Uint8Array(10));controller.close();}});
  const request=new Request('https://cacu.example/api/files',{method:'POST',body:stream,duplex:'half'} as RequestInit);
  await expect(boundedBody(request,15)).rejects.toMatchObject({status:413});
  await expect(boundedBody(new Request('https://cacu.example',{method:'POST',body:'a',headers:{'content-length':'999'}}),10)).rejects.toMatchObject({status:413});
});

test('invalid resource paths cannot be forwarded to the backend',async()=>{
  const response=await POST(new Request('https://cacu.example/api/files?purpose=receipt&resource_id=..%2Fforeign',{method:'POST',headers:{origin:'https://cacu.example'},body:'x'}));
  expect(response.status).toBe(422);expect(fetchMock).not.toHaveBeenCalled();
});

test('downloads reconstruct attachment headers without trusting upstream headers',async()=>{
  fetchMock.mockResolvedValue(new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'image/png','Content-Disposition':'inline; filename="receipt.png"','Set-Cookie':'credential=secret','Location':'https://signed.example'}}));
  const response=await GET(new Request(`https://cacu.example/api/files/${ident}`),context);
  expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toBe('attachment; filename="receipt.png"');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('location')).toBe(false);
  expect(fetchMock.mock.calls[0][0]).toBe(`https://file-api.example/api/v1/businesses/${business}/files/${ident}`);
});

test('active content never previews and approved images preview with sandbox headers',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('<script>bad</script>',{headers:{'Content-Type':'text/html'}}));
  expect((await GET(new Request(`https://cacu.example/api/files/${ident}?preview=true`),context)).status).toBe(409);
  fetchMock.mockResolvedValueOnce(new Response('png',{headers:{'Content-Type':'image/png'}}));
  const response=await GET(new Request(`https://cacu.example/api/files/${ident}?preview=true`),context);
  expect(response.headers.get('content-disposition')).toMatch(/^inline;/);expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(isApprovedPreview(`https://signed.example/${ident}`)).toBe(false);
  expect(isApprovedPreview(`/api/files/${ident}?preview=true`)).toBe(true);
});

test('delete propagates role denial and requires same-origin authorization',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({detail:'Delete permission required'}),{status:403,headers:{'Content-Type':'application/json'}}));
  const response=await DELETE(new Request(`https://cacu.example/api/files/${ident}`,{method:'DELETE',headers:{origin:'https://cacu.example'}}),context);
  expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'Delete permission required'});
});
