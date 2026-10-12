/** @jest-environment node */
import { GET } from '@/app/auth/callback/route';
import { createClient } from '@/lib/supabase/server';
const origin='https://cacu.test';
const next='/join?invitation=11111111-1111-4111-8111-111111111111';
const exchange=jest.fn();
beforeEach(async()=>{jest.clearAllMocks();const client=await(createClient as jest.Mock)();client.auth.exchangeCodeForSession=exchange;exchange.mockResolvedValue({error:null});});
function callback(code:string|null,destination:string){const url=new URL('/auth/callback',origin);if(code)url.searchParams.set('code',code);url.searchParams.set('next',destination);return GET(new Request(url));}
test('exchanges the code and returns to the invitation without caching',async()=>{const response=await callback('fixture-code',next);expect(exchange).toHaveBeenCalledWith('fixture-code');expect(response.headers.get('location')).toBe(origin+next);expect(response.headers.get('cache-control')).toBe('private, no-store');});
test.each(['https://evil.test','//evil.test','/\\evil.test','/a/..//evil.test'])('callback refuses external destination %s',async(path)=>{const response=await callback('fixture-code',path);expect(response.headers.get('location')).toBe(origin+'/');});
test.each(['provider-error','network-error','missing-code'])('keeps safe return destination on %s without forwarding tokens',async(mode)=>{if(mode==='provider-error')exchange.mockResolvedValue({error:{message:'private provider detail'}});if(mode==='network-error')exchange.mockRejectedValue(new Error('private provider detail'));const response=await callback(mode==='missing-code'?null:'fixture-code',next);const location=new URL(response.headers.get('location')!);expect(location.pathname).toBe('/login');expect(location.searchParams.get('next')).toBe(next);expect(location.searchParams.has('code')).toBe(false);expect(location.toString()).not.toContain('private');if(mode==='missing-code')expect(exchange).not.toHaveBeenCalled();});
