import { checkUploadHint } from '@/lib/upload-policy';
test('upload hints reject MIME/extension spoofing and oversized logos',()=>{
  expect(()=>checkUploadHint(new File(['MZ'],'executable.exe',{type:'image/png'}),'logo')).toThrow();
  expect(()=>checkUploadHint(new File(['png'],'logo.png',{type:'text/html'}),'logo')).toThrow();
  expect(()=>checkUploadHint(new File([new Uint8Array(2097153)],'logo.png',{type:'image/png'}),'logo')).toThrow();
});
