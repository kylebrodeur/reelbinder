"""Veo/Lyria adapters and bounded local media validation; no remote media downloads."""
import asyncio
import base64
import hashlib
from dataclasses import dataclass,field
import io
import json
import math
import os
import re
import shutil
import subprocess
import struct
import tempfile
import wave
import httpx
from google.genai import types
from .cloud_auth import cloud_client,require_token
from .limits import GENERATED_WAV_SECONDS, GENERATED_WAV_BYTES

@dataclass
class MediaBytes:
    data: bytes
    mime_type: str
    validation: dict = field(default_factory=dict)
@dataclass
class VideoBytes:
    data: bytes
    mime_type: str
    validation: dict = field(default_factory=dict)
@dataclass
class MediaBatch:
    items: list[MediaBytes | VideoBytes]
    model: str
    text: str = ''
    usage: dict = field(default_factory=dict)
def validate_media(data,mime,*,max_duration=None,max_bytes=100*1024*1024):
    if max_duration is None: max_duration=GENERATED_WAV_SECONDS if mime=='audio/wav' else 9
    if not isinstance(data,bytes) or not 0<len(data)<=max_bytes: raise ValueError('Invalid media size.')
    if mime=='audio/wav':
        with wave.open(io.BytesIO(data),'rb') as f:
            rate,channels,width,count=f.getframerate(),f.getnchannels(),f.getsampwidth(),f.getnframes()
            if rate!=48000 or channels not in (1,2) or width not in (2,3,4) or not 0<count/rate<=max_duration: raise ValueError('Invalid audio format/duration.')
            if len(f.readframes(count))!=count*channels*width: raise ValueError('Truncated audio.')
            return {'durationSec':count/rate,'sampleRate':rate,'channels':channels}
    if mime!='video/mp4' or len(data)<12 or data[4:8]!=b'ftyp': raise ValueError('Only MP4 video or PCM WAV audio supported.')
    probe=shutil.which('ffprobe')
    if not probe: raise ValueError('ffprobe required for video validation.')
    with tempfile.NamedTemporaryFile(suffix='.mp4') as f:
        f.write(data);f.flush()
        p=subprocess.run([probe,'-v','error','-protocol_whitelist','file','-f','mov','-enable_drefs','0','-i',f.name,'-show_streams','-show_format','-of','json'],capture_output=True,timeout=20)
        if p.returncode: raise ValueError('Invalid video.')
        parsed=json.loads(p.stdout)
    video=next((s for s in parsed.get('streams',[]) if s.get('codec_type')=='video'),None)
    if not video: raise ValueError('No video stream.')
    duration=float(parsed.get('format',{}).get('duration',0));width=video.get('width',0);height=video.get('height',0)
    if not math.isfinite(duration) or not 0<duration<=max_duration or not 0<width<=4096 or not 0<height<=4096: raise ValueError('Invalid video dimensions/duration.')
    return {'durationSec':duration,'width':width,'height':height,'codec':video.get('codec_name')}

def model_config(kind):
    model=os.environ.get('CINEMA_'+kind.upper()+'_MODEL')
    supported={'video':{'veo-3.1-fast-generate-001','veo-3.1-generate-001'},'music':{'lyria-002'}}
    return model if model in supported[kind] else None

def ensure_standard(request,credentials):
    from .app import Fault
    google=credentials['google']; require_token(google)
    if google['location']!='us-central1': raise Fault('LOCATION_UNAVAILABLE','Video/music currently require us-central1.',422)
    if callback:=request.get('_check_connection'): callback()
    return google

async def generate_video(request,credentials):
    from .app import Fault
    google=ensure_standard(request,credentials)
    model=model_config('video')
    if not model: raise Fault('MODEL_NOT_CONFIGURED','Configure a supported CINEMA_VIDEO_MODEL.',503)
    client=cloud_client(google,120000)
    prefix=f"projects/{google['projectId']}/locations/{google['location']}/publishers/google/models/{model}/operations/"
    def validate_operation(name):
        if not isinstance(name,str) or not name.startswith(prefix) or not re.fullmatch(r'[A-Za-z0-9_-]+',name[len(prefix):]): raise Fault('INVALID_OPERATION','Provider returned an unexpected operation reference.',502)
    try:
        if name:=request.get('_operation_id'):
            validate_operation(name)
            operation=types.GenerateVideosOperation(name=name,done=False)
        else:
            inp=request['input']
            start_img = request.get('_start_image')
            end_img = request.get('_end_image')
            refs = request.get('_reference_images', [])
            src_video = request.get('_source_video')

            image = types.Image(image_bytes=start_img.data, mime_type=start_img.mime_type) if start_img else None
            last_frame = types.Image(image_bytes=end_img.data, mime_type=end_img.mime_type) if end_img else None
            reference_images = [types.Image(image_bytes=r.data, mime_type=r.mime_type) for r in refs] if refs else None
            video_input = types.Video(video_bytes=src_video.data, mime_type=src_video.mime_type) if src_video else None

            config = types.GenerateVideosConfig(
                number_of_videos=1,
                duration_seconds=inp.get('durationSeconds', 4),
                aspect_ratio=inp.get('aspectRatio', '16:9'),
                resolution=inp.get('resolution', '720p'),
                generate_audio=inp.get('generateAudio', True),
                seed=inp.get('seed'),
                negative_prompt=inp.get('negativePrompt') or None,
                person_generation=inp.get('personGeneration') or None,
                last_frame=last_frame,
                reference_images=reference_images,
            )
            
            operation = await client.aio.models.generate_videos(
                model=model,
                prompt=inp['prompt'],
                image=image,
                video=video_input,
                config=config
            )
            validate_operation(operation.name)
            request['_record_operation'](operation.name)
        for _ in range(120):
            if operation.done: break
            ensure_standard(request,credentials)
            operation=await client.aio.operations.get(operation)
            validate_operation(operation.name)
            if not operation.done: await asyncio.sleep(5)
        if not operation.done: raise Fault('PROVIDER_PENDING','Video is still pending; its operation reference is preserved. Do not resubmit.',504)
        if operation.error: raise Fault('VIDEO_GENERATION_FAILED','Google reported a video generation failure. Review provider usage before retrying.',502)
        videos=operation.response.generated_videos if operation.response else None
        if not videos or len(videos)!=1: raise Fault('NO_VIDEO_OUTPUT','No single video was returned.',502)
        video=videos[0].video
        if not video or not video.video_bytes: raise Fault('INLINE_VIDEO_REQUIRED','Provider returned no inline video bytes; URL/GCS fetching is disabled. Operation is preserved.',502)
        return MediaBatch(items=[MediaBytes(video.video_bytes,video.mime_type or 'video/mp4')],model=model)
    finally:
        await client.aio.aclose();client.close()

def normalize_lyria_wav(data):
    """Repair only the observed Lyria 2 double-length, canonical PCM header."""
    evidence={'providerBytesSha256':hashlib.sha256(data).hexdigest(),'normalization':'none'}
    # A complete JSON/base64 response observed on 2026-09-07 contained a 32.768s
    # stereo payload, with both RIFF sizes doubled. Preserve every PCM byte and
    # the original header so the provider bytes remain exactly reconstructable.
    if len(data)>=44 and data[:4]==b'RIFF' and data[8:16]==b'WAVEfmt ' and data[36:40]==b'data':
        fmt=struct.unpack_from('<IHHIIHH',data,16)
        payload=len(data)-44
        if (fmt==(16,1,2,48000,192000,4,16) and payload%4==0
                and 32<=payload/192000<=33
                and struct.unpack_from('<I',data,40)[0]==2*payload
                and struct.unpack_from('<I',data,4)[0]==36+2*payload):
            evidence.update(normalization='lyria2-double-length-header',originalHeaderHex=data[:44].hex(),
                            providerBytes=len(data),pcmSha256=hashlib.sha256(data[44:]).hexdigest())
            repaired=bytearray(data)
            struct.pack_into('<I',repaired,4,len(data)-8)
            struct.pack_into('<I',repaired,40,payload)
            data=bytes(repaired)
    evidence['assetBytesSha256']=hashlib.sha256(data).hexdigest()
    return data,evidence


def parse_music_response(result):
    """Accept the two Google-documented inline fields without weakening media checks."""
    from .app import Fault
    predictions=result.get('predictions') if isinstance(result,dict) else None
    if not isinstance(predictions,list) or len(predictions)!=1:
        raise Fault('NO_MUSIC_OUTPUT','Expected exactly one music prediction.',502)
    prediction=predictions[0]
    if not isinstance(prediction,dict):
        raise Fault('INVALID_MUSIC_RESPONSE','Music prediction was not an object.',502)
    # The REST reference uses audioContent; Google's linked Lyria 2 notebook
    # uses bytesBase64Encoded. Neither field authorizes URL fetching.
    fields=[key for key in ('audioContent','bytesBase64Encoded') if key in prediction]
    if not fields:
        raise Fault('MISSING_MUSIC_AUDIO','Music prediction contained no supported inline audio field.',502)
    if any(not isinstance(prediction[key],str) for key in fields):
        raise Fault('INVALID_MUSIC_ENCODING','Inline music must be a base64 string.',502)
    encoded=prediction[fields[0]]
    if len(fields)==2 and encoded!=prediction[fields[1]]:
        raise Fault('AMBIGUOUS_MUSIC_AUDIO','Music prediction contained conflicting inline audio fields.',502)
    if 'mimeType' in prediction and prediction['mimeType']!='audio/wav':
        raise Fault('INVALID_MUSIC_MIME','Explicit music MIME must identify audio/wav.',502)
    max_bytes=GENERATED_WAV_BYTES
    if len(encoded)>4*((max_bytes+2)//3):
        raise Fault('MUSIC_OUTPUT_TOO_LARGE','Inline music exceeds the 8 MiB asset limit.',502)
    try: data=base64.b64decode(encoded,validate=True)
    except ValueError:
        raise Fault('INVALID_MUSIC_ENCODING','Inline music could not be decoded as strict base64.',502) from None
    if not data:
        raise Fault('EMPTY_MUSIC_AUDIO','Inline music contained no audio bytes.',502)
    if len(data)>max_bytes:
        raise Fault('MUSIC_OUTPUT_TOO_LARGE','Decoded music exceeds the 8 MiB asset limit.',502)
    data,evidence=normalize_lyria_wav(data)
    try:
        if len(data)<12 or data[:4]!=b'RIFF' or struct.unpack_from('<I',data,4)[0]!=len(data)-8:
            raise ValueError('Incomplete WAV container.')
        validate_media(data,'audio/wav',max_bytes=max_bytes)
    except (ValueError,wave.Error,EOFError):
        raise Fault('INVALID_MUSIC_WAV','Music is not complete 48 kHz mono/stereo integer PCM WAV within 40 seconds.',502) from None
    return MediaBytes(data,'audio/wav',validation=evidence)


async def generate_music(request,credentials):
    from .app import Fault
    google=ensure_standard(request,credentials)
    model=model_config('music')
    if not model: raise Fault('MODEL_NOT_CONFIGURED','Configure CINEMA_MUSIC_MODEL=lyria-002.',503)
    inp=request['input'];instance={'prompt':inp['prompt']}
    if inp.get('negativePrompt'): instance['negative_prompt']=inp['negativePrompt']
    params={'sample_count':1}
    if inp.get('seed') is not None: instance['seed']=inp['seed'];params={}
    url=f"https://us-central1-aiplatform.googleapis.com/v1/projects/{google['projectId']}/locations/us-central1/publishers/google/models/{model}:predict"
    async with httpx.AsyncClient(timeout=120,follow_redirects=False) as client:
        try:
            response=await client.post(url,headers={'Authorization':'Bearer '+google['accessToken']},json={'instances':[instance],'parameters':params})
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            # Only the numeric status selects a controlled diagnostic. Never echo
            # provider bodies, request URLs, headers or exception text; never retry.
            status=error.response.status_code
            failures={
                400:('MUSIC_REQUEST_REJECTED','Google rejected the music request (HTTP 400). Review the generation settings.',502),
                401:('MUSIC_AUTHENTICATION_FAILED','Google rejected music authentication (HTTP 401). Reconnect Google Cloud.',502),
                403:('MUSIC_ACCESS_DENIED','Google denied music access (HTTP 403). Check project permissions and model access.',502),
                404:('MUSIC_MODEL_UNAVAILABLE','Google could not find the configured music endpoint (HTTP 404). Check model and project availability.',502),
                429:('MUSIC_RATE_LIMITED','Google limited music capacity or quota (HTTP 429). Check usage before another generation.',429),
            }
            if 500<=status<=599:
                failure=('MUSIC_PROVIDER_UNAVAILABLE',f'Google music service failed (HTTP {status}). Check provider status and usage before another generation.',503)
            else:
                failure=failures.get(status,('MUSIC_HTTP_FAILED','Google returned an unexpected HTTP status for music generation. Review the job before another generation.',502))
            raise Fault(*failure) from None
        except httpx.TimeoutException:
            raise Fault('MUSIC_TIMEOUT','The music request timed out. Provider completion is unknown; check usage before another generation.',504) from None
        except httpx.RequestError:
            raise Fault('MUSIC_NETWORK_ERROR','The music request encountered a network error. Provider completion is unknown; check usage before another generation.',502) from None
        if len(response.content)>25*1024*1024: raise Fault('OUTPUT_TOO_LARGE','Music response exceeds allowed size.',502)
        try: result=response.json()
        except ValueError:
            raise Fault('INVALID_MUSIC_RESPONSE','Music response was not valid JSON.',502) from None
    media=parse_music_response(result)
    return MediaBatch(items=[media],model=model,usage={'mediaValidation':media.validation})
