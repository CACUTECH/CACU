import hashlib
import logging
import json
import os
from uuid import UUID
from fastapi import HTTPException
import httpx
from .validation import POLICY, file_info, validate_file

log = logging.getLogger('cacu.uploads')

class UploadGateway:
    """User JWT for authorization RPCs; isolated server key for private object operations."""
    def __init__(self, token: str):
        self.url = os.environ.get('SUPABASE_URL', '').rstrip('/')
        self.public_key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
        self.secret = os.environ.get('CACU_STORAGE_SERVICE_ROLE_KEY', '')
        self.token = token
        if not self.url.startswith('https://') or not self.public_key or not self.secret:
            raise HTTPException(503, 'Secure uploads are not configured')
        self.client = httpx.Client(timeout=20, follow_redirects=False)

    def close(self): self.client.close()

    def request(self, method, path, *, privileged=False, **kwargs):
        key = self.secret if privileged else self.public_key
        headers = {'apikey':key, 'Authorization':'Bearer '+(self.secret if privileged else self.token)}
        headers.update(kwargs.pop('headers', {}))
        try:
            response = self.client.request(method, self.url+path, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(503, 'File storage unavailable') from exc
        if not response.is_success:
            code = ''
            try: code = response.json().get('code', '')
            except ValueError: pass
            if response.status_code in (401,403) or code == '42501':
                raise HTTPException(403, 'File permission denied')
            if path.endswith('/reserve_upload') and code == 'P0001':
                raise HTTPException(429, 'Business upload quota or rate limit exceeded')
            raise HTTPException(503, 'File storage unavailable')
        return response

    def rpc(self, name, data=None, privileged=False):
        response = self.request('POST','/rest/v1/rpc/'+name,privileged=privileged,json=data or {})
        return response.json() if response.content else None

    def authorize_upload(self, business, actor, purpose):
        if purpose not in POLICY['purposes']: raise HTTPException(422,'Unknown upload purpose')
        response = self.request('GET','/rest/v1/memberships',params={'select':'role','business_id':'eq.'+str(business),'user_id':'eq.'+str(actor)})
        rows = response.json()
        if len(rows)!=1 or rows[0]['role'] not in POLICY['purposes'][purpose]['roles']:
            raise HTTPException(403,'Upload permission required')

    def put(self, bucket, path, data, mime):
        self.request('POST',f'/storage/v1/object/{bucket}/{path}',privileged=True,content=data,
                     headers={'Content-Type':mime,'x-upsert':'false','cache-control':'no-store'})

    def remove(self, bucket, path):
        self.request('DELETE',f'/storage/v1/object/{bucket}',privileged=True,json={'prefixes':[path]})

    def record(self, business, ident):
        rows = self.request('GET','/rest/v1/upload_records',params={'select':'*','business_id':'eq.'+str(business),'id':'eq.'+str(ident),'state':'eq.approved'}).json()
        if len(rows)!=1: raise HTTPException(404,'File not found')
        row=rows[0]
        expected=f"{UUID(row['business_id'])}/{row['purpose']}/{UUID(row['resource_id'])}/{UUID(row['id'])}.{row['extension']}"
        if row['object_path']!=expected or row['mime'] not in {'image/png','image/jpeg'} or row['extension'] not in {'png','jpg'}:
            raise HTTPException(409,'File metadata requires review')
        return row

    def read(self, row):
        key=self.secret
        try:
            with self.client.stream('GET',self.url+'/storage/v1/object/authenticated/cacu-approved/'+row['object_path'],headers={'apikey':key,'Authorization':'Bearer '+key}) as response:
                if not response.is_success: raise HTTPException(503,'File unavailable')
                content=bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content)>row['size_bytes'] or len(content)>3145728: raise HTTPException(409,'Stored file requires review')
            data=bytes(content)
            if len(data)!=row['size_bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:
                raise HTTPException(409,'Stored file requires review')
            return data
        except httpx.HTTPError as exc: raise HTTPException(503,'File storage unavailable') from exc


def cleanup(gateway, row, state):
    failed=False
    for bucket,path in [('cacu-quarantine',row['quarantine_path']),('cacu-approved',row.get('object_path'))]:
        if not path: continue
        try: gateway.remove(bucket,path)
        except Exception: failed=True
    try:
        gateway.rpc('finish_upload_cleanup',{'p_id':row['id'],'p_state':'cleanup_required' if failed else state},privileged=True)
    except Exception: failed=True
    log.info('upload_cleanup',extra={'upload_id':row['id'],'business_id':row['business_id'],'cleanup_complete':not failed})
    return not failed


def upload(gateway, business, actor, purpose, resource, filename, mime, data):
    row=None
    try:
        gateway.authorize_upload(business,actor,purpose)
        _,_,safe=file_info(purpose,filename,mime,len(data))
        row=gateway.rpc('reserve_upload',{'p_business_id':str(business),'p_purpose':purpose,'p_resource_id':str(resource),'p_name':safe,'p_size':len(data)})
        gateway.put('cacu-quarantine',row['quarantine_path'],data,'application/octet-stream')
        approved=validate_file(purpose,filename,mime,data)
        # Paths are always generated from authenticated resource IDs and server UUIDs.
        prepared={'p_id':row['id'],'p_extension':approved.extension,'p_mime':approved.mime,
                  'p_size':len(approved.data),'p_sha256':hashlib.sha256(approved.data).hexdigest()}
        row=gateway.rpc('prepare_upload',prepared,privileged=True)
        gateway.put('cacu-approved',row['object_path'],approved.data,approved.mime)
        gateway.remove('cacu-quarantine',row['quarantine_path'])
        result=gateway.rpc('approve_upload',prepared,privileged=True)
        log.info(json.dumps({'event':'upload_approved','upload_id':row['id'],'business_id':str(business),'actor_id':str(actor)}))
        return {'id':result['id'],'original_name':result['original_name'],'mime':result['mime'],'size_bytes':result['size_bytes']}
    except Exception:
        if row: cleanup(gateway,row,'rejected')
        log.warning(json.dumps({'event':'upload_rejected','business_id':str(business),'actor_id':str(actor),'upload_id':row['id'] if row else None}))
        raise
