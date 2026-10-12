import { safeAuthReturn, invitationLoginPath } from '@/lib/auth-return';
const id='11111111-1111-4111-8111-111111111111';
test.each(['/','/join?invitation='+id,'/reports?period=2026-10','/inventory#items'])('accepts local destination %s',path=>{expect(safeAuthReturn(path)).toBe(path);});
test.each([null,undefined,123,'https://evil.example','//evil.example','/\\evil.example','/foo\\bar','javascript:alert(1)',' /join','/join\n','/%252fevil.example','/%255cevil.example','/%25250devil','/%2fevil.example','/%5cevil.example','/%0devil','/a/..//evil.example','/a/../..//evil.example','/'+ 'x'.repeat(2048)])('rejects unsafe destination %s',path=>{expect(safeAuthReturn(path)).toBe('/');});
test('canonicalizes ordinary local dot segments without creating a protocol-relative path',()=>{expect(safeAuthReturn('/settings/../inventory')).toBe('/inventory');});
test('creates a validated invitation return link',()=>{const login=new URL(invitationLoginPath(id),'https://cacu.test');expect(login.pathname).toBe('/login');expect(login.searchParams.get('next')).toBe('/join?invitation='+id);expect(invitationLoginPath(null)).toBe('/login');expect(invitationLoginPath('bad&next=//evil')).toBe('/login');});
