"""Connection-scoped local service. Provider calls happen only through queued jobs."""
import asyncio
import base64
import contextlib
import hashlib
import json
import math
import os
import re
import shutil
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from cryptography.fernet import Fernet
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from .admission import Admission, AdmissionError, METADATA_ALLOWANCE, OUTPUT_LIMITS
from .worker_lock import acquire_worker_lock
from .limits import (MAX_SCENE_SECONDS, MAX_PICTURE_CLIPS, MAX_SCENE_AUDIO_CUES,
                     MAX_IMPORTED_WAV_BYTES, MAX_IMPORTED_WAV_SECONDS, MAX_VIDEO_BYTES,
                     MAX_RENDER_INPUT_BYTES, GENERATED_WAV_BYTES, GENERATED_WAV_SECONDS,
                     RENDER_DEADLINE_SECONDS)

BASE = '/api/cinema'
SESSION_CREATE_PATHS = frozenset({
    BASE + '/assets', BASE + '/assets/import', BASE + '/connections',
    BASE + '/projects', BASE + '/jobs',
})
IMPORT_ASSET_LIMITS = {'image/png':8*1024*1024,'image/jpeg':8*1024*1024,'image/webp':8*1024*1024,'audio/wav':MAX_IMPORTED_WAV_BYTES,'video/mp4':MAX_VIDEO_BYTES}
IMPORT_BASE64_LIMIT = 4*((128*1024*1024+2)//3)
IMPORT_PROVENANCE_LIMIT = 128*1024
IMPORT_REQUEST_LIMIT = IMPORT_BASE64_LIMIT + IMPORT_PROVENANCE_LIMIT + 4096
class Fault(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status

class Body(BaseModel):
    model_config = ConfigDict(extra='forbid',allow_inf_nan=False)
class Connection(Body):
    provider: Literal['google-cloud','parallel']
    apiKey: SecretStr | None = Field(default=None,min_length=1,max_length=4096)
    accessToken: SecretStr | None = Field(default=None,min_length=1,max_length=8192)
    expiresAt: float | None = None
    mode: Literal['express','standard'] = 'express'
    projectId: str | None = Field(default=None,max_length=256)
    location: str | None = Field(default=None,max_length=100)
class ProjectBody(Body):
    project: dict
class UpdateProject(ProjectBody):
    expectedRevision: int = Field(ge=1)
class JobBody(Body):
    kind: Literal['script','preflight','image','video','music','render']
    connectionId: str | None = None
    parallelConnectionId: str | None = None
    projectId: str | None = None
    expectedRevision: int | None = Field(default=None,ge=1)
    idempotencyKey: str = Field(min_length=1,max_length=128)
    input: dict
class RenderAudioInput(Body):
    assetId: str = Field(min_length=1,max_length=128)
    start: float = Field(ge=0,le=MAX_SCENE_SECONDS,strict=True)
    duration: float = Field(gt=0,le=MAX_SCENE_SECONDS,strict=True)
    sourceInSec: float = Field(default=0,ge=0,strict=True)
    gain: float = Field(default=1,ge=0,le=4,strict=True)
class RenderInput(Body):
    pictureAssets: dict[str,str] = Field(min_length=1,max_length=MAX_PICTURE_CLIPS)
    audioCues: list[RenderAudioInput] = Field(default_factory=list,max_length=MAX_SCENE_AUDIO_CUES)
class ScriptInput(Body):
    idea: str = Field(min_length=1,max_length=20000)
    direction: str = Field(default='',max_length=5000)
class AssetUpload(Body):
    mimeType: Literal['image/png','image/jpeg','image/webp']
    dataBase64: str = Field(min_length=1,max_length=1_400_000)
    label: str = Field(default='Reference image',max_length=200)
class ImportedProvenance(Body):
    sourceAssetId: str = Field(min_length=1,max_length=128)
    sourceCreatedAt: float | None = Field(default=None,ge=0)
    sourceProvenance: dict
class AssetImport(Body):
    mimeType: Literal['image/png','image/jpeg','image/webp','audio/wav','video/mp4']
    dataBase64: str = Field(min_length=1,max_length=IMPORT_BASE64_LIMIT)
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    provenance: ImportedProvenance | None = None
class ImageInput(Body):
    prompt: str = Field(min_length=1,max_length=20000)
    purpose: Literal['storyboard','photoreal'] = 'photoreal'
    aspectRatio: Literal['16:9','9:16','1:1','4:3','3:4'] = '16:9'
    referenceAssetIds: list[str] = Field(default_factory=list,max_length=4)
    shotId: str | None = Field(default=None,max_length=128)
class VideoInput(Body):
    mode: Literal['prompt','start-frame','first-last','asset-references','extend'] | None = None
    prompt: str = Field(min_length=1,max_length=10000)
    durationSeconds: Literal[4,6,8] = 4
    aspectRatio: Literal['16:9','9:16'] = '16:9'
    resolution: Literal['720p','1080p'] = '720p'
    generateAudio: bool = True
    startAssetId: str | None = Field(default=None,max_length=128)
    endAssetId: str | None = Field(default=None,max_length=128)
    referenceAssetIds: list[str] = Field(default_factory=list,max_length=3)
    sourceVideoAssetId: str | None = Field(default=None,max_length=128)
    seed: int | None = Field(default=None,ge=0,le=4294967295)
    negativePrompt: str = Field(default='',max_length=5000)
    personGeneration: Literal['dont_allow','allow_adult','allow_all'] | None = None
    cameraControl: dict | None = None
    shotId: str | None = Field(default=None,max_length=128)

    @model_validator(mode='after')
    def validate_video_mode(self):
        has_start = bool(self.startAssetId)
        has_end = bool(self.endAssetId)
        has_refs = bool(self.referenceAssetIds)
        has_source = bool(self.sourceVideoAssetId)

        m = self.mode or (
            'first-last' if has_start and has_end else
            'start-frame' if has_start else
            'extend' if has_source else
            'asset-references' if has_refs else
            'prompt'
        )

        if m == 'prompt':
            if has_start or has_end or has_refs or has_source:
                raise ValueError('Prompt mode cannot take asset inputs.')
        elif m == 'start-frame':
            if not has_start or has_end or has_refs or has_source:
                raise ValueError('Start-frame mode requires startAssetId and no other asset inputs.')
        elif m == 'first-last':
            if not has_start or not has_end or has_refs or has_source:
                raise ValueError('First-last mode requires startAssetId and endAssetId.')
        elif m == 'asset-references':
            if not has_refs or not (1 <= len(self.referenceAssetIds) <= 3) or has_start or has_end or has_source:
                raise ValueError('Asset-references mode requires 1 to 3 referenceAssetIds and no other asset inputs.')
        elif m == 'extend':
            if not has_source or has_start or has_end or has_refs:
                raise ValueError('Extend mode requires sourceVideoAssetId and no other asset inputs.')
        return self
class MusicInput(Body):
    prompt: str = Field(min_length=1,max_length=10000)
    negativePrompt: str = Field(default='',max_length=5000)
    seed: int | None = Field(default=None,ge=0,le=4294967295)
    shotId: str | None = Field(default=None,max_length=128)
class ConversationTurn(Body):
    role: Literal['user','assistant']
    text: str = Field(min_length=1,max_length=4000)
class PreflightInput(Body):
    focus: str = Field(default='Continuity, coverage, props, and production readiness',max_length=5000)
    research: bool = False
    officialDocs: bool = False
    question: str | None = Field(default=None,min_length=1,max_length=4000)
    conversation: list[ConversationTurn] = Field(default_factory=list,max_length=8)


def packed(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'))
def safe_document(value):
    if len(packed(value).encode()) > 1_500_000:
        raise Fault('DOCUMENT_TOO_LARGE','Project exceeds 1.5 MB.',413)
    def walk(v):
        if isinstance(v,dict):
            for k,item in v.items():
                if k.lower().replace('_','').replace('-','') in {'apikey','accesstoken','refreshtoken','credentials','secretkey'}:
                    raise Fault('SECRET_IN_DOCUMENT','Credentials cannot be stored in a project or job.')
                walk(item)
        elif isinstance(v,list):
            for item in v: walk(item)
    walk(value)

def imported_provenance(source):
    """Retain archive claims as untrusted source evidence, never generated identity."""
    values=source.model_dump(exclude_none=True) if source else {}
    pending=[(values,0)]
    while pending:
        value,depth=pending.pop()
        if depth>32 or isinstance(value,float) and not math.isfinite(value):
            raise Fault('INVALID_PROVENANCE','Archive provenance is too deeply nested or invalid.',422)
        if isinstance(value,dict):
            for key,item in value.items():
                if key.lower().replace('_','').replace('-','') in {'apikey','accesstoken','refreshtoken','credentials','secretkey','authorization'}:
                    raise Fault('INVALID_PROVENANCE','Archive provenance cannot contain credentials.',422)
                pending.append((item,depth+1))
        elif isinstance(value,list):
            pending.extend((item,depth+1) for item in value)
    if len(packed(values).encode())>IMPORT_PROVENANCE_LIMIT:
        raise Fault('PROVENANCE_TOO_LARGE','Archive provenance exceeds 128 KiB.',413)
    return {'origin':'imported',**values}

def create_app(data_dir=None, *, executor=None, connection_ttl=3600):
    # Visitor access has a fixed lifetime; it never lengthens provider credentials.
    try:
        session_ttl=int(os.environ.get('CINEMA_SESSION_TTL_SECONDS','86400'))
    except (TypeError,ValueError):
        raise ValueError('CINEMA_SESSION_TTL_SECONDS must be an integer from 1 to 2592000.') from None
    if not 1<=session_ttl<=30*86400:
        raise ValueError('CINEMA_SESSION_TTL_SECONDS must be an integer from 1 to 2592000.')
    if not isinstance(connection_ttl,(int,float)) or not math.isfinite(connection_ttl) or connection_ttl<=0:
        raise ValueError('connection_ttl must be finite and positive.')
    connection_ttl=min(connection_ttl,3600)
    try:
        google_express_ttl=int(os.environ.get('CINEMA_GOOGLE_EXPRESS_TTL_SECONDS','86400'))
    except (TypeError,ValueError):
        raise ValueError('CINEMA_GOOGLE_EXPRESS_TTL_SECONDS must be an integer from 1 to 604800.') from None
    if not 1<=google_express_ttl<=7*86400:
        raise ValueError('CINEMA_GOOGLE_EXPRESS_TTL_SECONDS must be an integer from 1 to 604800.')
    directory=Path(data_dir or os.environ.get('CINEMA_DATA_DIR',Path(__file__).resolve().parents[1]/'.runtime'))
    admission=Admission.from_env(directory)
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    keypath=directory/'encryption.key'
    supplied=os.environ.get('CINEMA_ENCRYPTION_KEY')
    if not supplied and not keypath.exists():
        try:
            fd=os.open(keypath,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as f: f.write(Fernet.generate_key())
        except FileExistsError: pass
    cipher=Fernet(supplied.encode() if supplied else keypath.read_bytes())
    database=directory/'cinema.sqlite3'
    def db():
        c=sqlite3.connect(database,timeout=10)
        c.row_factory=sqlite3.Row
        return c
    with db() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, expires REAL);
        CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, session TEXT, provider TEXT, secret BLOB, expires REAL);
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, session TEXT, revision INTEGER, document TEXT);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, session TEXT, metadata TEXT, content BLOB);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, session TEXT, idem TEXT, fingerprint TEXT, request TEXT, status TEXT, result TEXT, error TEXT, UNIQUE(session,idem));
        CREATE INDEX IF NOT EXISTS projects_session ON projects(session);
        CREATE INDEX IF NOT EXISTS assets_session ON assets(session);
        CREATE INDEX IF NOT EXISTS connections_session ON connections(session);
        ''')
    with db() as c:
        columns={r['name'] for r in c.execute('PRAGMA table_info(jobs)')}
        for name,definition in [('operation','TEXT'),('reserved_bytes','INTEGER NOT NULL DEFAULT 0'),('reserved_assets','INTEGER NOT NULL DEFAULT 0'),('admission_version','INTEGER NOT NULL DEFAULT 0')]:
            if name not in columns: c.execute(f'ALTER TABLE jobs ADD COLUMN {name} {definition}')
    os.chmod(database,0o600)
    origins=os.environ.get('CINEMA_ORIGINS','http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173').split(',')
    secure=os.environ.get('CINEMA_SECURE_COOKIE','false').lower()=='true'
    def prepare_connection(body,session_expires):
        now=time.time()
        ttl=google_express_ttl if body.provider=='google-cloud' and body.mode=='express' else connection_ttl
        expires=min(now+ttl,session_expires)
        values=body.model_dump(exclude={'apiKey','accessToken'},exclude_none=True)
        if body.provider=='google-cloud' and body.mode=='standard':
            if body.apiKey or not body.accessToken or not body.expiresAt or body.expiresAt<=now+30:
                raise Fault('INVALID_INPUT','Supply only an OAuth access token with a future expiry.',422)
            if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]',body.projectId or '') or not re.fullmatch(r'(global|[a-z]+-[a-z]+[0-9])',body.location or ''):
                raise Fault('INVALID_INPUT','An explicit valid Cloud project ID and location are required.',422)
            values['accessToken']=body.accessToken.get_secret_value().strip()
            if not values['accessToken']: raise Fault('INVALID_INPUT','Token must not be blank.',422)
            expires=min(expires,body.expiresAt,now+3600);values['expiresAt']=expires
        else:
            if body.mode!='express' or body.accessToken or not body.apiKey: raise Fault('INVALID_INPUT','This connection requires an API key.',422)
            values['apiKey']=body.apiKey.get_secret_value().strip()
            if not values['apiKey']: raise Fault('INVALID_INPUT','API key must not be blank.',422)
        return values,cipher.encrypt(packed(values).encode()),expires
    def connection_response(cid,body,expires):
        return {'connectionId':cid,'provider':body.provider,'status':'configured','expiresAt':expires,'mode':body.mode,'projectId':body.projectId,'location':body.location}
    def credential(c,sid,cid,provider,expected_fingerprint=None):
        row=c.execute('SELECT * FROM connections WHERE id=? AND session=? AND expires>?',(cid,sid,time.time())).fetchone()
        fingerprint=hashlib.sha256(row['secret']).hexdigest() if row else None
        if expected_fingerprint is not None and (not row or row['provider']!=provider or not secrets.compare_digest(fingerprint,expected_fingerprint)):
            raise Fault('CONNECTION_CHANGED','Connection credentials changed or expired after this job was submitted. Submit a new job.',409)
        if not row or row['provider']!=provider: raise Fault('CONNECTION_UNAVAILABLE','Connection is missing, expired, or disconnected.',404)
        return json.loads(cipher.decrypt(row['secret'])),fingerprint
    def project(c,sid,pid):
        row=c.execute('SELECT * FROM projects WHERE id=? AND session=?',(pid,sid)).fetchone()
        if not row: raise Fault('NOT_FOUND','Project not found.',404)
        return {'projectId':row['id'],'revision':row['revision'],'project':json.loads(row['document'])}
    def asset(c,sid,aid):
        row=c.execute('SELECT * FROM assets WHERE id=? AND session=?',(aid,sid)).fetchone()
        if not row: raise Fault('NOT_FOUND','Asset not found.',404)
        return row
    def validate_asset(data,mime,*,render_output=False,imported=False):
        from .media import validate_image
        try:
            if mime.startswith('image/'):
                width,height=validate_image(data,mime);dimensions={'width':width,'height':height}
            else:
                from .av_media import validate_media
                if mime=='audio/wav':
                    dimensions=validate_media(data,mime,max_duration=MAX_IMPORTED_WAV_SECONDS if imported else GENERATED_WAV_SECONDS,
                                              max_bytes=MAX_IMPORTED_WAV_BYTES if imported else GENERATED_WAV_BYTES)
                else:
                    dimensions=validate_media(data,mime,max_duration=MAX_SCENE_SECONDS if render_output or imported else 9,
                                              max_bytes=MAX_VIDEO_BYTES if render_output or imported else 100*1024*1024)
        except Exception: raise Fault('INVALID_MEDIA','Invalid or unsupported media bytes.',422)
        return dimensions
    def store_asset(c,sid,data,mime,provenance,*,dimensions,credit_job=None):
        aid=secrets.token_urlsafe(18)
        metadata={'assetId':aid,'url':BASE+'/assets/'+aid+'/content','mimeType':mime,**dimensions,'byteSize':len(data),'sha256':hashlib.sha256(data).hexdigest(),'createdAt':time.time(),'provenance':provenance}
        encoded=packed(metadata)
        if len(encoded.encode())>METADATA_ALLOWANCE:
            raise Fault('INVALID_MEDIA','Media metadata exceeds the storage allowance.',422)
        admission.check_storage(c,sid,len(data)+len(encoded.encode()),1,credit_job=credit_job,disk=credit_job is None)
        c.execute('INSERT INTO assets VALUES(?,?,?,?)',(aid,sid,encoded,data))
        return metadata
    def resolve_render(c,sid,snapshot,inp):
        from .render import RenderAsset,AudioCue,plan_render
        total=0
        resolved={}
        def resolve(aid):
            nonlocal total
            if aid in resolved: return resolved[aid]
            row=c.execute('SELECT metadata FROM assets WHERE id=? AND session=?',(aid,sid)).fetchone()
            if not row: raise Fault('NOT_FOUND','Render asset not found.',404)
            metadata=json.loads(row['metadata']);total+=metadata['byteSize']
            if total>MAX_RENDER_INPUT_BYTES: raise Fault('RENDER_LIMIT','Referenced media exceeds 256 MiB.',422)
            data=c.execute('SELECT content FROM assets WHERE id=? AND session=?',(aid,sid)).fetchone()['content']
            resolved[aid]=RenderAsset(data,metadata['mimeType'],aid)
            return resolved[aid]
        pictures={clip:resolve(aid) for clip,aid in inp['pictureAssets'].items()}
        cues=[AudioCue(resolve(cue['assetId']),cue['start'],cue['duration'],cue.get('sourceInSec',0),cue.get('gain',1)) for cue in inp['audioCues']]
        plan=plan_render(snapshot,pictures,audio_cues=cues)
        expected={segment.clip_id for segment in plan.segments if segment.asset}
        if set(pictures)!=expected: raise Fault('INVALID_RENDER_INPUT','Map exactly the picture clip IDs in the saved timeline.',422)
        return pictures,cues
    async def worker():
        while True:
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                row=c.execute("SELECT * FROM jobs WHERE status='queued' LIMIT 1").fetchone()
                if row:
                    try:
                        # Jobs saved by older builds must reserve before dispatch too.
                        if not row['admission_version']:
                            size,count=admission.reserve(c,row['session'],json.loads(row['request'])['kind'])
                            c.execute('UPDATE jobs SET reserved_bytes=?,reserved_assets=?,admission_version=1 WHERE id=?',(size,count,row['id']))
                        admission.check_storage(c,row['session'],0,0)
                        c.execute("UPDATE jobs SET status='running',error=NULL WHERE id=?",(row['id'],))
                    except AdmissionError as exc:
                        c.execute("UPDATE jobs SET status='failed',reserved_bytes=0,reserved_assets=0,error=? WHERE id=?",(packed({'code':exc.code,'message':exc.message}),row['id']))
                        row=None
            if not row:
                await asyncio.sleep(.05)
                continue
            try:
                request=json.loads(row['request'])
                credentials={}
                if request['kind']!='render':
                    fingerprints=request.get('_credentialFingerprints',{})
                    if not isinstance(fingerprints,dict) or 'google' not in fingerprints:
                        raise Fault('CONNECTION_CHANGED','Connection credentials changed or expired after this job was submitted. Submit a new job.',409)
                    with db() as c:
                        credentials={'google':credential(c,row['session'],request['connectionId'],'google-cloud',fingerprints['google'])[0]}
                        if request.get('parallelConnectionId'):
                            if 'parallel' not in fingerprints:
                                raise Fault('CONNECTION_CHANGED','Connection credentials changed or expired after this job was submitted. Submit a new job.',409)
                            credentials['parallel']=credential(c,row['session'],request['parallelConnectionId'],'parallel',fingerprints['parallel'])[0]
                request['_operation_id']=row['operation']
                def record_operation(name):
                    with db() as c: c.execute('UPDATE jobs SET operation=? WHERE id=? AND session=?',(name,row['id'],row['session']))
                def check_connection():
                    with db() as c: credential(c,row['session'],request['connectionId'],'google-cloud',request['_credentialFingerprints']['google'])
                request['_record_operation']=record_operation
                request['_check_connection']=check_connection
                if request['kind']=='image':
                    from .media import ImageBytes
                    with db() as c:
                        refs=[asset(c,row['session'],aid) for aid in request['input']['referenceAssetIds']]
                    request['_reference_images']=[ImageBytes(data=r['content'],mime_type=json.loads(r['metadata'])['mimeType']) for r in refs]
                elif request['kind']=='video':
                    from .media import ImageBytes
                    from .av_media import VideoBytes
                    inp = request['input']
                    with db() as c:
                        if inp.get('startAssetId'):
                            r = asset(c, row['session'], inp['startAssetId'])
                            request['_start_image'] = ImageBytes(data=r['content'], mime_type=json.loads(r['metadata'])['mimeType'])
                        if inp.get('endAssetId'):
                            r = asset(c, row['session'], inp['endAssetId'])
                            request['_end_image'] = ImageBytes(data=r['content'], mime_type=json.loads(r['metadata'])['mimeType'])
                        if inp.get('referenceAssetIds'):
                            refs = [asset(c, row['session'], aid) for aid in inp['referenceAssetIds']]
                            request['_reference_images'] = [ImageBytes(data=r['content'], mime_type=json.loads(r['metadata'])['mimeType']) for r in refs]
                        if inp.get('sourceVideoAssetId'):
                            r = asset(c, row['session'], inp['sourceVideoAssetId'])
                            request['_source_video'] = VideoBytes(data=r['content'], mime_type=json.loads(r['metadata'])['mimeType'])
                if request['kind']=='render':
                    from .render import render_project
                    with db() as c: pictures,cues=resolve_render(c,row['session'],request['snapshot'],request['input'])
                    result=await asyncio.to_thread(render_project,request['snapshot'],pictures,audio_cues=cues,timeout_sec=RENDER_DEADLINE_SECONDS)
                elif executor is None:
                    from .providers import execute
                    result=await asyncio.wait_for(execute(request,credentials),timeout=900 if request['kind']=='video' else 180)
                else: result=await executor(request,credentials)
                # Probe/decode outside the SQLite writer lock. A slow import or
                # output validator must not block another reserved job's commit.
                output_dimensions=[]
                if request['kind']=='render':
                    if len(result.data)>OUTPUT_LIMITS['render'][0]: raise Fault('INVALID_MEDIA','Render output exceeds its reserved capacity.',502)
                    output_dimensions=[validate_asset(result.data,result.mime_type,render_output=True)]
                elif request['kind'] in ('image','video','music'):
                    from .media import ImageBatch
                    from .av_media import MediaBatch
                    outputs=result.images if isinstance(result,ImageBatch) else result.items if isinstance(result,MediaBatch) else []
                    if len(outputs)!=1:
                        raise Fault('INVALID_IMAGE_OUTPUT','Provider did not return valid image output.',502)
                    if sum(len(im.data) for im in outputs)>OUTPUT_LIMITS[request['kind']][0]:
                        raise Fault('INVALID_MEDIA','Provider output exceeds its reserved capacity.',502)
                    allowed={'image':{'image/png','image/jpeg','image/webp'},'video':{'video/mp4'},'music':{'audio/wav'}}[request['kind']]
                    if any(im.mime_type not in allowed for im in outputs): raise Fault('INVALID_MEDIA','Provider media does not match the requested tool.',502)
                    output_dimensions=[validate_asset(im.data,im.mime_type) for im in outputs]
                with db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    if request['kind']=='render':
                        provenance={**result.provenance,'projectId':request['projectId'],'sourceRevision':request['expectedRevision'],'jobId':row['id']}
                        record=store_asset(c,row['session'],result.data,result.mime_type,provenance,dimensions={**output_dimensions[0],'fps':result.fps},credit_job=row['id'])
                        result={'assets':[record],'warnings':list(result.warnings)}
                    elif request['kind'] in ('image','video','music'):
                        provenance={'provider':'google-cloud','model':result.model,'jobId':row['id'],'projectId':request.get('projectId'),'sourceRevision':request.get('expectedRevision'),'shotId':request['input'].get('shotId'),'referenceAssetIds':request['input'].get('referenceAssetIds',[]),'origin':'generated','usage':result.usage,'cloudProjectId':credentials['google'].get('projectId'),'location':getattr(result,'location',None) or credentials['google'].get('location')}
                        if request['kind']=='image': provenance['purpose']=request['input']['purpose']
                        if isinstance(result,ImageBatch):
                            # Express keys do not use submitted project/location
                            # fields. Keep those claims separate from routing.
                            google=credentials['google']
                            provenance['submittedConnection']={key:google[key] for key in ('mode','projectId','location') if key in google}
                            provenance['cloudProjectId']=google.get('projectId') if google['mode']=='standard' else None
                            provenance['location']=result.location
                            if result.generation_config: provenance['generationConfig']=result.generation_config
                            if result.model_version: provenance['modelVersion']=result.model_version
                            if result.finish_reasons: provenance['finishReasons']=result.finish_reasons
                        records=[store_asset(c,row['session'],im.data,im.mime_type,provenance,dimensions=dimensions,credit_job=row['id']) for im,dimensions in zip(outputs,output_dimensions)]
                        result={'assets':records,'text':result.text}
                    # Assets and success commit in one transaction; failed validation rolls both back.
                    rendered=packed(result)
                    if any(v.get(k) and v[k] in rendered for v in credentials.values() for k in ['apiKey','accessToken']):
                        raise Fault('UNSAFE_PROVIDER_OUTPUT','Provider returned sensitive content.',502)
                    c.execute("UPDATE jobs SET status='succeeded',result=?,error=NULL,reserved_bytes=0,reserved_assets=0 WHERE id=?",(rendered,row['id']))
            except asyncio.CancelledError:
                with db() as c: c.execute("UPDATE jobs SET status=CASE WHEN operation IS NOT NULL THEN 'queued' ELSE 'failed' END,reserved_bytes=CASE WHEN operation IS NOT NULL THEN reserved_bytes ELSE 0 END,reserved_assets=CASE WHEN operation IS NOT NULL THEN reserved_assets ELSE 0 END,error=? WHERE id=?",(packed({'code':'INTERRUPTED_UNCERTAIN','message':'Execution interrupted; provider billing may have occurred. No automatic retry.'}),row['id']))
                raise
            except Exception as exc:
                from .render import RenderError
                error={'code':exc.code,'message':exc.message} if isinstance(exc,(Fault,RenderError,AdmissionError)) else {'code':'PROVIDER_FAILED','message':'Provider execution failed. Check connection access and model configuration; no automatic retry.'}
                with db() as c: c.execute("UPDATE jobs SET status='failed',error=?,reserved_bytes=0,reserved_assets=0 WHERE id=?",(packed(error),row['id']))
    @asynccontextmanager
    async def lifespan(app):
        # Lock before recovery: a second worker cannot reset an active execution.
        with acquire_worker_lock(directory):
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                c.execute("UPDATE jobs SET status='queued' WHERE status='running' AND operation IS NOT NULL")
                c.execute("UPDATE jobs SET status='failed',reserved_bytes=0,reserved_assets=0,error=? WHERE status='running'",(packed({'code':'INTERRUPTED_UNCERTAIN','message':'Previous execution interrupted; check provider usage before resubmitting.'}),))
                c.execute("UPDATE jobs SET reserved_bytes=0,reserved_assets=0 WHERE status NOT IN ('queued','running')")
            task=asyncio.create_task(worker())
            try:
                yield
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError): await task
    from .render import RenderError
    app=FastAPI(lifespan=lifespan)
    @app.exception_handler(RenderError)
    async def render_error(request,exc): return JSONResponse({'error':{'code':exc.code,'message':exc.message}},status_code=422)
    app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Content-Type','Range'],expose_headers=['Content-Range','Accept-Ranges'])
    @app.exception_handler(Fault)
    @app.exception_handler(AdmissionError)
    async def fault_handler(request,exc): return JSONResponse({'error':{'code':exc.code,'message':exc.message}},status_code=exc.status)
    @app.exception_handler(Exception)
    async def unexpected(request,exc): return JSONResponse({'error':{'code':'INTERNAL_ERROR','message':'The service could not complete this request.'}},status_code=500)
    @app.exception_handler(RequestValidationError)
    async def invalid(request,exc): return JSONResponse({'error':{'code':'INVALID_INPUT','message':'Request fields are missing or invalid.'}},status_code=422)
    @app.middleware('http')
    async def session(request,call_next):
        origin=request.headers.get('origin')
        same=str(request.base_url).rstrip('/')
        if request.method not in ('GET','HEAD','OPTIONS') and origin and origin not in origins and origin!=same:
            return JSONResponse({'error':{'code':'ORIGIN_DENIED','message':'Origin is not allowed.'}},status_code=403)
        limit=IMPORT_REQUEST_LIMIT if request.method=='POST' and request.url.path==BASE+'/assets/import' else 2_000_000
        def oversized():
            return JSONResponse({'error':{'code':'REQUEST_TOO_LARGE','message':'Request exceeds the allowed body size.'}},status_code=413)
        if declared:=request.headers.get('content-length'):
            try: length=int(declared)
            except ValueError: return JSONResponse({'error':{'code':'INVALID_INPUT','message':'Invalid Content-Length.'}},status_code=400)
            if length<0: return JSONResponse({'error':{'code':'INVALID_INPUT','message':'Invalid Content-Length.'}},status_code=400)
            if length>limit: return oversized()
        chunks=[];size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>limit: return oversized()
            chunks.append(chunk)
        # Starlette's cached Request replays this bounded body to downstream parsing.
        request._body=b''.join(chunks)
        token=request.cookies.get('cinema_session','')
        sid=hashlib.sha256(token.encode()).hexdigest()
        created=False
        try:
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                now=time.time()
                found=c.execute('SELECT id FROM sessions WHERE id=? AND expires>?',(sid,now)).fetchone()
                c.execute('DELETE FROM connections WHERE expires<=?',(now,))
                if not found and request.method=='POST' and request.url.path in SESSION_CREATE_PATHS:
                    admission.check_session(c,now)
                    token=secrets.token_urlsafe(32); sid=hashlib.sha256(token.encode()).hexdigest()
                    c.execute('INSERT INTO sessions VALUES(?,?)',(sid,now+session_ttl))
                    created=True
                elif not found:
                    token=''; sid=''
        except AdmissionError as exc:
            return JSONResponse({'error':{'code':exc.code,'message':exc.message}},status_code=exc.status,headers={'Cache-Control':'no-store'})
        request.state.sid=sid
        try:
            response=await call_next(request)
        except BaseException:
            if created:
                with db() as c:
                    c.execute('''DELETE FROM sessions WHERE id=?
                        AND NOT EXISTS(SELECT 1 FROM projects WHERE session=sessions.id)
                        AND NOT EXISTS(SELECT 1 FROM jobs WHERE session=sessions.id)
                        AND NOT EXISTS(SELECT 1 FROM assets WHERE session=sessions.id)
                        AND NOT EXISTS(SELECT 1 FROM connections WHERE session=sessions.id)''',(sid,))
            raise
        if created and response.status_code >= 400:
            with db() as c:
                c.execute('''DELETE FROM sessions WHERE id=?
                    AND NOT EXISTS(SELECT 1 FROM projects WHERE session=sessions.id)
                    AND NOT EXISTS(SELECT 1 FROM jobs WHERE session=sessions.id)
                    AND NOT EXISTS(SELECT 1 FROM assets WHERE session=sessions.id)
                    AND NOT EXISTS(SELECT 1 FROM connections WHERE session=sessions.id)''',(sid,))
            token=''
        if created and token:
            response.set_cookie('cinema_session',token,httponly=True,secure=secure,samesite='lax',max_age=session_ttl,path=BASE)
        response.headers['Cache-Control']='no-store'
        return response
    @app.get(BASE+'/health')
    async def health():
        from .av_media import model_config
        capabilities={}
        for kind,setting in [('script','REASONING'),('preflight','REASONING'),('image','IMAGE')]:
            model=os.environ.get('CINEMA_'+setting+'_MODEL')
            capabilities[kind]={'status':'configured' if model else 'unavailable','model':model,'reason':'Express key or explicit Cloud token required; model access unverified'}
        for kind in ['video','music']:
            model=model_config(kind);ready=bool(model) and (kind!='video' or bool(shutil.which('ffprobe')))
            capabilities[kind]={'status':'configured' if ready else 'unavailable','model':model,'reason':'Explicit Cloud token in us-central1 required; model access unverified'+('; ffprobe required' if kind=='video' else '')}
        capabilities['render']={'status':'configured' if shutil.which('ffmpeg') and shutil.which('ffprobe') else 'unavailable','model':None,'reason':f'FFmpeg render; up to {MAX_SCENE_SECONDS}s of picture and sound; no AI connection required',
                                'limits':{'durationSeconds':MAX_SCENE_SECONDS,'pictureClips':MAX_PICTURE_CLIPS,'audioCues':MAX_SCENE_AUDIO_CUES,'executionTimeoutSeconds':RENDER_DEADLINE_SECONDS}}
        return {'status':'ready','storage':'local-sqlite','liveVerified':False,'capabilities':capabilities}
    @app.post(BASE+'/assets')
    async def upload_image(body:AssetUpload,request:Request):
        from .media import validate_image
        try:
            data=base64.b64decode(body.dataBase64,validate=True)
            width,height=validate_image(data,body.mimeType,limit=1024*1024)
        except ValueError: raise Fault('INVALID_IMAGE','Upload a valid PNG, JPEG, or WebP up to 1 MB.',422)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            return store_asset(c,request.state.sid,data,body.mimeType,{'origin':'upload','label':body.label},dimensions={'width':width,'height':height})
    @app.post(BASE+'/assets/import')
    def import_asset(body:AssetImport,request:Request):
        provenance=imported_provenance(body.provenance)
        limit=IMPORT_ASSET_LIMITS[body.mimeType]
        if len(body.dataBase64)>4*((limit+2)//3):
            raise Fault('ASSET_TOO_LARGE','Archive asset exceeds its media size limit.',413)
        try: data=base64.b64decode(body.dataBase64,validate=True)
        except ValueError: raise Fault('INVALID_MEDIA','Archive asset must contain valid base64 media bytes.',422)
        if len(data)>limit: raise Fault('ASSET_TOO_LARGE','Archive asset exceeds its media size limit.',413)
        if not secrets.compare_digest(hashlib.sha256(data).hexdigest(),body.sha256):
            raise Fault('HASH_MISMATCH','Archive asset bytes do not match their SHA-256.',422)
        dimensions=validate_asset(data,body.mimeType,imported=True)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            return store_asset(c,request.state.sid,data,body.mimeType,provenance,dimensions=dimensions)
    @app.get(BASE+'/assets/{aid}')
    async def get_asset(aid:str,request:Request):
        with db() as c: return json.loads(asset(c,request.state.sid,aid)['metadata'])
    @app.get(BASE+'/assets/{aid}/content')
    async def asset_content(aid:str,request:Request):
        with db() as c: row=asset(c,request.state.sid,aid)
        data=row['content'];headers={'X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Accept-Ranges':'bytes'}
        status=200
        if requested:=request.headers.get('range'):
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',requested) if len(requested)<100 else None
            if not match or not any(match.groups()): return Response(status_code=416,headers={'Content-Range':f'bytes */{len(data)}'})
            first,last=match.groups()
            if first: start=int(first);end=min(int(last),len(data)-1) if last else len(data)-1
            else: start=max(0,len(data)-int(last));end=len(data)-1
            if start>end or start>=len(data): return Response(status_code=416,headers={'Content-Range':f'bytes */{len(data)}'})
            headers['Content-Range']=f'bytes {start}-{end}/{len(data)}';data=data[start:end+1];status=206
        return Response(data,status_code=status,media_type=json.loads(row['metadata'])['mimeType'],headers=headers)
    @app.post(BASE+'/connections')
    async def connect(body:Connection,request:Request):
        cid=secrets.token_urlsafe(18)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            session_row=c.execute('SELECT expires FROM sessions WHERE id=? AND expires>?',(request.state.sid,time.time())).fetchone()
            if not session_row: raise Fault('NOT_FOUND','Cinema session not found.',404)
            values,secret,expires=prepare_connection(body,session_row['expires'])
            admission.check_connection(c,request.state.sid,body.provider,len(secret))
            c.execute('INSERT INTO connections VALUES(?,?,?,?,?)',(cid,request.state.sid,body.provider,secret,expires))
        return connection_response(cid,body,expires)
    @app.get(BASE+'/connections')
    async def connections(request:Request):
        with db() as c: rows=c.execute('SELECT * FROM connections WHERE session=? AND expires>?',(request.state.sid,time.time())).fetchall()
        metadata=[]
        for row in rows:
            value=json.loads(cipher.decrypt(row['secret']))
            metadata.append({'connectionId':row['id'],'provider':row['provider'],'status':'configured','expiresAt':row['expires'],'mode':value['mode'],'projectId':value.get('projectId'),'location':value.get('location')})
        return {'connections':metadata}
    @app.put(BASE+'/connections/{cid}')
    async def renew_connection(cid:str,body:Connection,request:Request):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            now=time.time()
            row=c.execute('SELECT * FROM connections WHERE id=? AND session=? AND expires>?',(cid,request.state.sid,now)).fetchone()
            if not row: raise Fault('NOT_FOUND','Connection not found. Reconnect it instead.',404)
            current=json.loads(cipher.decrypt(row['secret']))
            old_scope=(row['provider'],current.get('mode'),current.get('projectId'),current.get('location'))
            new_scope=(body.provider,body.mode,body.projectId,body.location)
            if old_scope!=new_scope:
                raise Fault('CONNECTION_SCOPE_MISMATCH','Renewal cannot change the provider, mode, project, or location. Add another connection instead.',409)
            session_row=c.execute('SELECT expires FROM sessions WHERE id=? AND expires>?',(request.state.sid,now)).fetchone()
            if not session_row: raise Fault('NOT_FOUND','Cinema session not found.',404)
            values,secret,expires=prepare_connection(body,session_row['expires'])
            c.execute('DELETE FROM connections WHERE id=? AND session=?',(cid,request.state.sid))
            admission.check_connection(c,request.state.sid,body.provider,len(secret))
            c.execute('INSERT INTO connections VALUES(?,?,?,?,?)',(cid,request.state.sid,body.provider,secret,expires))
        return connection_response(cid,body,expires)
    @app.delete(BASE+'/connections/{cid}')
    async def disconnect(cid:str,request:Request):
        with db() as c:
            if not c.execute('DELETE FROM connections WHERE id=? AND session=?',(cid,request.state.sid)).rowcount: raise Fault('NOT_FOUND','Connection not found.',404)
        return {'disconnected':True}
    def validate_project(p):
        safe_document(p)
        if not isinstance(p.get('id'),str) or not p['id'] or not isinstance(p.get('name'),str): raise Fault('INVALID_PROJECT','Project requires id and name.',422)
    @app.post(BASE+'/projects')
    async def create(body:ProjectBody,request:Request):
        validate_project(body.project); pid=secrets.token_urlsafe(18)
        document=packed(body.project)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            admission.check_project(c,request.state.sid,len(document.encode()))
            c.execute('INSERT INTO projects VALUES(?,?,?,?)',(pid,request.state.sid,1,document))
        return {'projectId':pid,'revision':1,'project':body.project}
    @app.get(BASE+'/projects/{pid}')
    async def read(pid:str,request:Request):
        with db() as c: return project(c,request.state.sid,pid)
    @app.put(BASE+'/projects/{pid}')
    async def update(pid:str,body:UpdateProject,request:Request):
        validate_project(body.project)
        document=packed(body.project)
        with db() as c:
            c.execute('BEGIN IMMEDIATE'); old=project(c,request.state.sid,pid)
            if old['revision']!=body.expectedRevision: raise Fault('REVISION_CONFLICT','Project changed; reload before applying.',409)
            admission.check_project(c,request.state.sid,len(document.encode()),replacing=pid)
            c.execute('UPDATE projects SET revision=revision+1,document=? WHERE id=?',(document,pid))
        return {'projectId':pid,'revision':body.expectedRevision+1,'project':body.project}
    @app.post(BASE+'/jobs')
    async def submit(body:JobBody,request:Request):
        values=body.model_dump(); fingerprint=hashlib.sha256(packed(values).encode()).hexdigest()
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            old=c.execute('SELECT * FROM jobs WHERE session=? AND idem=?',(request.state.sid,body.idempotencyKey)).fetchone()
            if old:
                if old['fingerprint']!=fingerprint: raise Fault('IDEMPOTENCY_CONFLICT','Key already used for a different request.',409)
                return {'jobId':old['id'],'status':old['status']}
            if body.kind!='render' and not body.connectionId: raise Fault('CONNECTION_REQUIRED','Connect a provider before generating.',422)
            google,google_fingerprint=credential(c,request.state.sid,body.connectionId,'google-cloud') if body.kind!='render' else (None,None)
            credential_fingerprints={'google':google_fingerprint} if google_fingerprint is not None else {}
            if body.kind in ('video','music'):
                from .av_media import model_config
                from .cloud_auth import require_token
                require_token(google)
                if google['location']!='us-central1': raise Fault('LOCATION_UNAVAILABLE','Video/music currently require us-central1.',422)
                if not model_config(body.kind): raise Fault('CAPABILITY_UNAVAILABLE','Configure a supported model for this tool.',503)
                if body.kind=='video' and not shutil.which('ffprobe'): raise Fault('CAPABILITY_UNAVAILABLE','ffprobe is required for video validation.',503)
            try: inp={'script':ScriptInput,'preflight':PreflightInput,'image':ImageInput,'video':VideoInput,'music':MusicInput,'render':RenderInput}[body.kind].model_validate(body.input)
            except ValueError: raise Fault('INVALID_INPUT','Job input fields are invalid.',422)
            values['input']=inp.model_dump()
            if body.kind=='render':
                if not shutil.which('ffmpeg') or not shutil.which('ffprobe'): raise Fault('RENDER_UNAVAILABLE','FFmpeg and ffprobe are required.',503)
                if not body.projectId or not body.expectedRevision: raise Fault('PROJECT_REQUIRED','Render requires saved project and revision.',422)
                snapshot=project(c,request.state.sid,body.projectId)
                if snapshot['revision']!=body.expectedRevision: raise Fault('REVISION_CONFLICT','Project changed; save before rendering.',409)
                values['snapshot']=snapshot['project']
                resolve_render(c,request.state.sid,values['snapshot'],values['input'])
                pending=c.execute("SELECT session,request FROM jobs WHERE status IN ('queued','running')").fetchall()
                renders=[r for r in pending if json.loads(r['request'])['kind']=='render']
                if len(renders)>=4 or sum(r['session']==request.state.sid for r in renders)>=2: raise Fault('RENDER_BUSY','Render queue is full; wait for an existing render.',429)
            if body.kind in ('image','video','music'):
                selected_image_model=None
                if body.kind=='image':
                    from .media import image_model, validate_image_reference_size
                    selected_image_model=image_model({'input':values['input']},required=False)
                if body.kind == 'image':
                    for aid in getattr(inp, 'referenceAssetIds', []):
                        reference = asset(c, request.state.sid, aid)
                        if not json.loads(reference['metadata'])['mimeType'].startswith('image/'): raise Fault('INVALID_REFERENCE', 'Reference must be an image.', 422)
                        validate_image_reference_size(selected_image_model, len(reference['content']))
                elif body.kind == 'video':
                    for aid in ([inp.startAssetId] if inp.startAssetId else []) + ([inp.endAssetId] if inp.endAssetId else []) + getattr(inp, 'referenceAssetIds', []):
                        reference = asset(c, request.state.sid, aid)
                        if not json.loads(reference['metadata'])['mimeType'].startswith('image/'): raise Fault('INVALID_REFERENCE', 'Video reference/start/end must be an image.', 422)
                    if inp.sourceVideoAssetId:
                        reference = asset(c, request.state.sid, inp.sourceVideoAssetId)
                        if not json.loads(reference['metadata'])['mimeType'].startswith('video/'): raise Fault('INVALID_REFERENCE', 'Video extension source must be a video asset.', 422)
                if body.projectId or body.expectedRevision or inp.shotId:
                    if not body.projectId or not body.expectedRevision: raise Fault('PROJECT_REQUIRED','Image shot context requires project and revision.',422)
                    snapshot=project(c,request.state.sid,body.projectId)
                    if snapshot['revision']!=body.expectedRevision: raise Fault('REVISION_CONFLICT','Project changed; save and rerun.',409)
                    values['snapshot']=snapshot['project']
                    if inp.shotId and not any(s.get('id')==inp.shotId for s in snapshot['project'].get('shots',[]) if isinstance(s,dict)):
                        raise Fault('SHOT_NOT_FOUND','Shot is not in the project snapshot.',422)
            if body.kind=='preflight':
                if not body.projectId or not body.expectedRevision: raise Fault('PROJECT_REQUIRED','Preflight requires a saved project and revision.',422)
                snapshot=project(c,request.state.sid,body.projectId)
                if snapshot['revision']!=body.expectedRevision: raise Fault('REVISION_CONFLICT','Project changed; save and rerun.',409)
                values['snapshot']=snapshot['project']
                if inp.research:
                    if not body.parallelConnectionId: raise Fault('RESEARCH_UNAVAILABLE','Connect Parallel to request research.',422)
                    _,credential_fingerprints['parallel']=credential(c,request.state.sid,body.parallelConnectionId,'parallel')
            safe_document(values['input'])
            if credential_fingerprints: values['_credentialFingerprints']=credential_fingerprints
            admission.check_jobs(c,request.state.sid)
            reserved_bytes,reserved_assets=admission.reserve(c,request.state.sid,body.kind)
            jid=secrets.token_urlsafe(18)
            c.execute('INSERT INTO jobs(id,session,idem,fingerprint,request,status,result,error,reserved_bytes,reserved_assets,admission_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(jid,request.state.sid,body.idempotencyKey,fingerprint,packed(values),'queued',None,None,reserved_bytes,reserved_assets,1))
        return {'jobId':jid,'status':'queued'}
    @app.get(BASE+'/jobs/{jid}')
    async def get_job(jid:str,request:Request):
        with db() as c: row=c.execute('SELECT * FROM jobs WHERE id=? AND session=?',(jid,request.state.sid)).fetchone()
        if not row: raise Fault('NOT_FOUND','Job not found.',404)
        out={'jobId':jid,'kind':json.loads(row['request'])['kind'],'status':row['status']}
        if row['operation']: out['providerOperationId']=row['operation']
        for field in ['result','error']:
            if row[field]: out[field]=json.loads(row[field])
        return out
    return app
