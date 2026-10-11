import hashlib
import io
import struct
import subprocess
import zlib
from uuid import uuid4
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from cacu.uploads.validation import validate_file, file_info
from cacu.uploads.service import upload, cleanup


def image(kind='PNG', size=(16,16), metadata=False):
    stream=io.BytesIO(); options={}
    if metadata:
        info=PngImagePlugin.PngInfo();info.add_text('description','Business logo metadata');options['pnginfo']=info
    Image.new('RGB',size,'blue').save(stream,format=kind,**options)
    return stream.getvalue()

@pytest.mark.parametrize('kind,extension,mime',[('PNG','png','image/png'),('JPEG','jpg','image/jpeg'),('JPEG','jpeg','image/jpeg')])
def test_valid_images_are_reencoded(kind,extension,mime):
    result=validate_file('logo','brand.'+extension,mime,image(kind))
    assert result.mime==mime and result.extension in {'png','jpg'}
    with Image.open(io.BytesIO(result.data)) as parsed: parsed.load();assert parsed.size==(16,16)

def test_image_metadata_removed():
    result=validate_file('logo','logo.png','image/png',image(metadata=True))
    assert b'<script>' not in result.data
    assert Image.open(io.BytesIO(result.data)).info=={}

@pytest.mark.parametrize('name,mime,data',[
 ('a.png','image/jpeg',b'MZ executable'),('a.png','image/png',b'MZ executable'),
 ('a.png','image/png',b'\x89PNG\r\n\x1a\nmalformed'),('a.png','image/png',image('JPEG')),
 ('a.jpg','image/jpeg',image('PNG')),('a.svg','image/svg+xml',b'<svg/>'),
 ('a.html','text/html',b'<script>'),('a.exe','image/png',image()),('a.zip','application/zip',b'PK'),
 ('../a.png','image/png',image()),('x\\a.png','image/png',image()),('x\r\na.png','image/png',image()),
 ('a.png','image/png',image()+b'<script>'),('a.jpg','image/jpeg',image('JPEG')[:-2]),
])
def test_unsafe_uploads_rejected(name,mime,data):
    with pytest.raises(HTTPException) as failure: validate_file('logo',name,mime,data)
    assert failure.value.status_code==422

def test_size_and_empty_rejected():
    for data in [b'',b'x'*(2097152+1)]:
        with pytest.raises(HTTPException) as failure:validate_file('logo','a.png','image/png',data)
        assert failure.value.status_code==413

def test_decompression_dimension_bomb_rejected():
    data=bytearray(image());data[16:24]=struct.pack('>II',20000,20000)
    data[29:33]=struct.pack('>I',zlib.crc32(data[12:29]) & 0xffffffff)
    with pytest.raises(HTTPException):validate_file('logo','a.png','image/png',bytes(data))

def test_bad_crc_and_animation_rejected():
    bad=bytearray(image());bad[-1]^=1
    with pytest.raises(HTTPException):validate_file('logo','a.png','image/png',bytes(bad))
    stream=io.BytesIO();Image.new('RGB',(10,10),'red').save(stream,format='PNG',save_all=True,append_images=[Image.new('RGB',(10,10),'blue')])
    with pytest.raises(HTTPException):validate_file('logo','a.png','image/png',stream.getvalue())

def test_parser_timeout_is_clear_error(monkeypatch):
    def timeout(*args,**kw):raise subprocess.TimeoutExpired('worker',10)
    monkeypatch.setattr('cacu.uploads.validation.subprocess.run',timeout)
    with pytest.raises(HTTPException) as failure:validate_file('logo','a.png','image/png',image())
    assert failure.value.detail=='Image processing limit exceeded'

class MemoryGateway:
    def __init__(self):self.objects={};self.rows={};self.role='owner';self.fail_promotion=False;self.fail_remove=False
    def close(self):pass
    def authorize_upload(self,b,a,p):
        if self.role not in {'owner','admin'}:raise HTTPException(403,'Upload permission required')
    def rpc(self,name,data=None,privileged=False):
        if name=='reserve_upload':
            ident=str(uuid4());r={'id':ident,'business_id':data['p_business_id'],'purpose':data['p_purpose'],'resource_id':data['p_resource_id'],'original_name':data['p_name'],'quarantine_path':data['p_business_id']+'/'+ident,'object_path':None,'state':'pending'};self.rows[ident]=r;return r
        if name=='prepare_upload':
            r=self.rows[data['p_id']];r['object_path']=f"{r['business_id']}/{r['purpose']}/{r['resource_id']}/{r['id']}.{data['p_extension']}";return r
        if name=='approve_upload':
            if self.fail_promotion:raise HTTPException(403,'Upload permission denied')
            r=self.rows[data['p_id']];r.update(state='approved',mime=data['p_mime'],size_bytes=data['p_size'],sha256=data['p_sha256']);return r
        if name=='finish_upload_cleanup':self.rows[data['p_id']]['state']=data['p_state'];return None
        if name=='request_upload_delete':
            r=self.record(data['p_business_id'],data['p_id'])
            if self.role!='owner':raise HTTPException(403,'Delete permission required')
            r['state']='deleting';return r
        raise AssertionError(name)
    def put(self,bucket,path,data,mime):
        assert (bucket,path) not in self.objects
        self.objects[bucket,path]=data
    def remove(self,bucket,path):
        if self.fail_remove:raise HTTPException(503,'Storage unavailable')
        self.objects.pop((bucket,path),None)
    def record(self,business,ident):
        r=self.rows.get(str(ident))
        if not r or r['business_id']!=str(business) or r['state']!='approved':raise HTTPException(404,'File not found')
        return r
    def read(self,row):return self.objects['cacu-approved',row['object_path']]

def test_duplicate_names_get_distinct_uuid_paths():
    g=MemoryGateway();b,a=uuid4(),uuid4()
    one=upload(g,b,a,'logo',b,'brand.png','image/png',image());two=upload(g,b,a,'logo',b,'brand.png','image/png',image())
    assert one['id']!=two['id'];assert len(g.objects)==2
    assert all(bucket=='cacu-approved' and 'brand' not in path for bucket,path in g.objects)
    assert all(r['state']=='approved' for r in g.rows.values())

@pytest.mark.parametrize('fail_promotion',[False,True])
def test_rejection_cleans_quarantine_and_trusted_objects(fail_promotion):
    g=MemoryGateway();g.fail_promotion=fail_promotion;b=uuid4()
    with pytest.raises(HTTPException):upload(g,b,uuid4(),'logo',b,'bad.png','image/png',image() if fail_promotion else b'MZ executable')
    assert not g.objects;assert next(iter(g.rows.values()))['state']=='rejected'

def test_cleanup_failure_is_retained_for_retry():
    g=MemoryGateway();g.fail_remove=True;b=uuid4()
    with pytest.raises(HTTPException):upload(g,b,uuid4(),'logo',b,'bad.png','image/png',b'MZ executable')
    r=next(iter(g.rows.values()));assert r['state']=='cleanup_required'
    g.fail_remove=False;assert cleanup(g,r,'rejected');assert not g.objects

def test_http_auth_cross_tenant_headers_and_deletion(monkeypatch):
    import app as module
    from cacu.uploads import routes
    g=MemoryGateway();b=uuid4();actor=uuid4()
    monkeypatch.setattr(routes,'UploadGateway',lambda token:g)
    client=TestClient(module.app)
    assert client.post(f'/api/v1/businesses/{b}/files?purpose=logo&resource_id={b}',content=image(),headers={'content-type':'image/png','x-upload-filename':'logo.png'}).status_code==401
    module.app.dependency_overrides[module.current_user]=lambda:actor
    try:
        auth={'Authorization':'Bearer test-only','content-type':'image/png','x-upload-filename':'logo.png'}
        response=client.post(f'/api/v1/businesses/{b}/files?purpose=logo&resource_id={b}',content=image(),headers=auth)
        assert response.status_code==200;ident=response.json()['id']
        route=f'/api/v1/businesses/{b}/files/{ident}'
        response=client.get(route,headers=auth)
        assert response.status_code==200 and response.headers['content-type']=='image/png'
        assert response.headers['content-disposition'].startswith('attachment;')
        assert response.headers['x-content-type-options']=='nosniff' and response.headers['cache-control']=='private, no-store'
        preview=client.get(route+'?preview=true',headers=auth)
        assert preview.headers['content-disposition'].startswith('inline;') and "sandbox" in preview.headers['content-security-policy']
        assert client.get(f'/api/v1/businesses/{uuid4()}/files/{ident}',headers=auth).status_code==404
        g.role='viewer';assert client.delete(route,headers=auth).status_code==403
        g.role='owner';assert client.delete(route,headers=auth).status_code==200
        assert client.get(route,headers=auth).status_code==404;assert not g.objects
        assert client.post(f'/api/v1/businesses/{b}/files?purpose=logo&resource_id={b}',content=b'x'*3145729,headers=auth).status_code==413
    finally:module.app.dependency_overrides.clear()


def test_compressed_png_metadata_bomb_rejected():
    stream=io.BytesIO();meta=PngImagePlugin.PngInfo();meta.add_text('payload','A'*2097152,zip=True)
    Image.new('RGB',(16,16),'red').save(stream,format='PNG',pnginfo=meta)
    assert len(stream.getvalue())<10000
    with pytest.raises(HTTPException):validate_file('logo','bomb.png','image/png',stream.getvalue())


def test_storage_transport_no_overwrites_and_integrity_checks(monkeypatch):
    import httpx
    from cacu.uploads.service import UploadGateway
    monkeypatch.setenv('SUPABASE_URL','https://storage.example')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','test-public')
    monkeypatch.setenv('CACU_STORAGE_SERVICE_ROLE_KEY','test-server-only')
    seen=[]
    def respond(request):
        seen.append(request)
        if request.method=='POST':return httpx.Response(200,json={})
        return httpx.Response(200,content=b'tampered')
    gateway=UploadGateway('user-test-token');gateway.client.close();gateway.client=httpx.Client(transport=httpx.MockTransport(respond))
    try:
        gateway.put('cacu-approved','server/uuid.png',b'validated','image/png')
        assert seen[0].headers['x-upsert']=='false'
        assert seen[0].headers['Authorization']=='Bearer test-server-only'
        with pytest.raises(HTTPException) as failure:gateway.read({'object_path':'server/uuid.png','size_bytes':8,'sha256':'0'*64})
        assert failure.value.status_code==409
    finally:gateway.close()


def test_recognizable_active_metadata_payload_rejected():
    stream=io.BytesIO();meta=PngImagePlugin.PngInfo();meta.add_text('payload','<script>alert(1)</script>')
    Image.new('RGB',(16,16),'red').save(stream,format='PNG',pnginfo=meta)
    with pytest.raises(HTTPException):validate_file('logo','active.png','image/png',stream.getvalue())
