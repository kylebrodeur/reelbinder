"""Raster validation and Google image generation; no URL downloads."""
from dataclasses import dataclass, field
import io
import os
import warnings
from PIL import Image
from google import genai
from google.genai import types

DEFAULT_STORYBOARD_IMAGE_MODEL = 'gemini-3.1-flash-lite-image'
STORYBOARD_IMAGE_MODELS = frozenset({DEFAULT_STORYBOARD_IMAGE_MODEL})

@dataclass
class ImageBytes:
    data: bytes
    mime_type: str

@dataclass
class ImageBatch:
    images: list[ImageBytes]
    model: str
    text: str = ''
    usage: dict = field(default_factory=dict)
    location: str | None = None
    generation_config: dict = field(default_factory=dict)
    model_version: str | None = None
    finish_reasons: list[str] = field(default_factory=list)


def validate_image(data, mime_type, *, limit=8*1024*1024):
    if not isinstance(data,bytes) or not 0<len(data)<=limit:
        raise ValueError('Image bytes exceed the allowed size.')
    formats={'image/png':'PNG','image/jpeg':'JPEG','image/webp':'WEBP'}
    if mime_type not in formats: raise ValueError('Only PNG, JPEG, and WebP images are supported.')
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format!=formats[mime_type]: raise ValueError('Image type does not match its bytes.')
                width,height=image.size
                if width*height>16_777_216 or width<1 or height<1: raise ValueError('Image dimensions exceed the allowed size.')
                if getattr(image,'n_frames',1)!=1: raise ValueError('Animated images are not supported.')
                image.verify()
            with Image.open(io.BytesIO(data)) as image: image.load()
        except Exception as exc: raise ValueError('Invalid or unsupported raster image.') from exc
    return width,height


def validate_image_reference_size(model, byte_size):
    # The 3.1 model's inline limit is 7 MB per image. Keep archive/import
    # capacity and other models unchanged; use decimal MB conservatively.
    if model == 'gemini-3.1-flash-image' and byte_size > 7_000_000:
        from .app import Fault
        raise Fault('REFERENCE_TOO_LARGE','This image model accepts reference images up to 7 MB each. Resize the reference before generating.',422)


def image_model(request, *, required=True):
    from .app import Fault
    purpose=request.get('input',{}).get('purpose','photoreal')
    if purpose == 'storyboard':
        model=os.environ.get('CINEMA_STORYBOARD_IMAGE_MODEL',DEFAULT_STORYBOARD_IMAGE_MODEL)
        if model not in STORYBOARD_IMAGE_MODELS:
            raise Fault('MODEL_NOT_CONFIGURED','CINEMA_STORYBOARD_IMAGE_MODEL must name an approved storyboard image model.',503)
        return model
    if purpose != 'photoreal':
        raise Fault('INVALID_INPUT','Image purpose is invalid.',422)
    model=os.environ.get('CINEMA_IMAGE_MODEL')
    if not model and required: raise Fault('MODEL_NOT_CONFIGURED','Set CINEMA_IMAGE_MODEL to an approved Cloud image model.',503)
    return model


async def generate_image(request,credentials):
    from .app import Fault
    model=image_model(request)
    for reference in request.get('_reference_images',[]):
        validate_image_reference_size(model,len(reference.data))
    config=types.GenerateContentConfig(response_modalities=['TEXT','IMAGE'],candidate_count=1,image_config=types.ImageConfig(aspect_ratio=request['input'].get('aspectRatio','16:9')))
    if model in {'gemini-3.1-flash-image',DEFAULT_STORYBOARD_IMAGE_MODEL}:
        config.image_config.image_size='1K'
        config.max_output_tokens=4096 if model == DEFAULT_STORYBOARD_IMAGE_MODEL else 8192
        config.thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL,include_thoughts=False)
        # One candidate can contain multiple images. These request settings
        # bound output tokens, not total cost; inputs and thinking also count.
    generation_config=config.model_dump(mode='json',by_alias=True,exclude_none=True)
    from .cloud_auth import cloud_client, model_credential
    google=model_credential(credentials['google'],'CINEMA_IMAGE_LOCATION')
    client=cloud_client(google,120000)
    parts=[types.Part(text=request['input']['prompt'])]
    for reference in request.get('_reference_images',[]):
        parts.append(types.Part.from_bytes(data=reference.data,mime_type=reference.mime_type))
    try:
        response=await client.aio.models.generate_content(model=model,contents=[types.Content(role='user',parts=parts)],config=config)
        images=[]; captions=[]
        for candidate in response.candidates or []:
            for part in (candidate.content.parts or []) if candidate.content else []:
                if part.thought: continue
                if part.inline_data and part.inline_data.data:
                    images.append(ImageBytes(data=part.inline_data.data,mime_type=part.inline_data.mime_type))
                elif part.text: captions.append(part.text)
        if not images: raise Fault('NO_IMAGE_OUTPUT','The model returned no image. Review its safety or capability response before retrying.',502)
        if len(images)!=1: raise Fault('INVALID_IMAGE_OUTPUT','Provider must return exactly one image.',502)
        return ImageBatch(images=images,model=model,text='\n'.join(captions)[:20000],usage=response.usage_metadata.model_dump(exclude_none=True) if response.usage_metadata else {},location=google.get('location') if google['mode']=='standard' else None,generation_config=generation_config,model_version=response.model_version,finish_reasons=[candidate.finish_reason.value for candidate in response.candidates or [] if candidate.finish_reason])
    finally:
        await client.aio.aclose()
        client.close()
