"use client";
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBusiness } from '@/components/business-provider';
import { checkUploadHint, imageAccept, uploadHint, uploadPolicy, type UploadPurpose } from '@/lib/upload-policy';

type Attachment = { id:string; original_name:string; mime:string; size_bytes:number };
export function FileAttachments({ purpose, resourceId }: { purpose:UploadPurpose; resourceId:string }) {
  const {business,refresh}=useBusiness(); const inputId=useId();
  const [files,setFiles]=useState<Attachment[]>([]); const [file,setFile]=useState<File|null>(null);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [revision,setRevision]=useState(0);
  const [loadedScope,setLoadedScope]=useState(''); const scope=`${business?.id}/${resourceId}/${purpose}`;
  const canUpload=(uploadPolicy.purposes[purpose].roles as string[]).includes(business?.userRole || '');
  const canDelete=['owner','admin'].includes(business?.userRole || '');
  const query=new URLSearchParams({purpose,resource_id:resourceId}).toString();
  useEffect(() => {
    const controller=new AbortController(); setError(''); setFile(null);
    void fetch(`/api/files?${query}`,{cache:'no-store',signal:controller.signal}).then(async response => {
      const data=await response.json(); if (!response.ok) throw new Error(data.error || 'Attachments unavailable');
      if (!controller.signal.aborted) { setFiles(data); setLoadedScope(scope); }
    }).catch(failure => { if (!controller.signal.aborted) { setFiles([]); setLoadedScope(scope); setError(failure instanceof Error ? failure.message : 'Attachments unavailable'); } });
    return () => controller.abort();
  },[query,scope,revision]);
  async function submit(event:React.FormEvent) {
    event.preventDefault(); if (!file) return; setBusy(true); setError('');
    try {
      checkUploadHint(file,purpose);
      const response=await fetch(`/api/files?${query}`,{method:'POST',body:file,headers:{'Content-Type':file.type,'X-Upload-Filename':encodeURIComponent(file.name)}});
      const result=await response.json(); if (!response.ok) throw new Error(result.error || 'Upload failed');
      setFile(null); setRevision(value=>value+1); if (purpose==='logo') await refresh();
    } catch(failure) { setError(failure instanceof Error ? failure.message : 'Upload failed'); }
    finally { setBusy(false); }
  }
  async function remove(id:string) {
    setBusy(true); setError('');
    try { const response=await fetch(`/api/files/${id}`,{method:'DELETE'}); const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Deletion failed'); setRevision(value=>value+1); if(purpose==='logo') await refresh(); }
    catch(failure) {setError(failure instanceof Error ? failure.message : 'Deletion failed');}
    finally {setBusy(false);}
  }
  return <div className="space-y-4">
    {canUpload && <form onSubmit={event=>void submit(event)} className="space-y-3"><label htmlFor={inputId} className="text-sm font-medium">{purpose==='logo'?'Business logo':'Add attachment'}</label><Input id={inputId} type="file" accept={imageAccept} disabled={busy} onChange={event=>{
      const selected=event.target.files?.[0]; setFile(null); if(!selected) return;
      try {checkUploadHint(selected,purpose);setFile(selected);setError('');} catch(failure) {event.target.value='';setError(failure instanceof Error ? failure.message : 'Invalid file');}
    }} /><p className="text-sm text-muted-foreground">{uploadHint(purpose)}</p><Button type="submit" disabled={!file||busy}>{busy?'Processing…':'Upload'}</Button></form>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loadedScope!==scope && <p role="status">Loading attachments…</p>}
    {loadedScope===scope && !error && files.length===0 && <p className="text-sm text-muted-foreground">No approved attachments yet.</p>}
    {loadedScope===scope && <ul className="space-y-2">{files.map(item=><li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><span className="min-w-0 flex-1 break-words text-sm">{item.original_name}</span><a href={`/api/files/${item.id}`} className="text-sm text-primary underline">Download</a><a href={`/api/files/${item.id}?preview=true`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Preview</a>{canDelete&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void remove(item.id)}>Delete</Button>}</li>)}</ul>}
  </div>;
}
