from urllib.parse import unquote
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from .service import UploadGateway, cleanup, upload


def upload_router(current_user, bearer):
    router=APIRouter(prefix='/api/v1/businesses/{business_id}/files',tags=['files'])
    def gateway(credentials=Depends(bearer)):
        if credentials is None: raise HTTPException(401,'Authentication required')
        instance=UploadGateway(credentials.credentials)
        try: yield instance
        finally: instance.close()

    @router.post('')
    async def create(business_id:UUID,request:Request,purpose:str,resource_id:UUID,
                     filename:str=Header(alias='X-Upload-Filename'),user_id:UUID=Depends(current_user),storage=Depends(gateway)):
        if len(filename)>600: raise HTTPException(422,'Invalid filename')
        try: decoded=unquote(filename,errors='strict')
        except UnicodeError as exc: raise HTTPException(422,'Invalid filename') from exc
        data=await request.body()
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(upload,storage,business_id,user_id,purpose,resource_id,decoded,request.headers.get('content-type',''),data)

    @router.get('/{file_id}')
    def download(business_id:UUID,file_id:UUID,preview:bool=False,user_id:UUID=Depends(current_user),storage=Depends(gateway)):
        row=storage.record(business_id,file_id)
        data=storage.read(row)
        storage.record(business_id,file_id) # Authorization is checked again after the storage request.
        # Only regenerated PNG/JPEG may preview. Never send a signed URL or storage response headers.
        disposition='inline' if preview else 'attachment'
        return Response(data,media_type=row['mime'],headers={
            'Content-Disposition':f"{disposition}; filename=\"{row['original_name']}\"",
            'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store',
            'Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin',
            'Referrer-Policy':'no-referrer','Vary':'Authorization',
        })

    @router.delete('/{file_id}')
    def delete(business_id:UUID,file_id:UUID,user_id:UUID=Depends(current_user),storage=Depends(gateway)):
        row=storage.rpc('request_upload_delete',{'p_business_id':str(business_id),'p_id':str(file_id)})
        if not cleanup(storage,row,'deleted'): raise HTTPException(503,'Deletion pending cleanup; file is no longer accessible')
        return {'deleted':True}
    return router
