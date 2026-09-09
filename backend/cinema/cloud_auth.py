"""Explicit submitted credentials only. No ADC, refresh token, or environment fallback."""
import os
import re
import time
from google import genai
from google.genai import types
from google.oauth2.credentials import Credentials

def model_credential(credential, location_env):
    """Route a configured model without changing the submitted project or credential."""
    if credential['mode'] != 'standard':
        return credential
    location = os.environ.get(location_env, 'global').strip()
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,62}', location):
        from .app import Fault
        raise Fault('INVALID_MODEL_LOCATION', f'{location_env} must name a Google Cloud model location.', 503)
    return {**credential, 'location': location}

def cloud_client(credential,timeout=90000):
    options=types.HttpOptions(timeout=timeout,retry_options=types.HttpRetryOptions(attempts=1))
    if credential['mode']=='standard':
        require_token(credential)
        return genai.Client(enterprise=True,credentials=Credentials(token=credential['accessToken']),project=credential['projectId'],location=credential['location'],http_options=options)
    return genai.Client(enterprise=True,api_key=credential['apiKey'],http_options=options)

def require_token(credential):
    from .app import Fault
    if credential.get('mode')!='standard': raise Fault('STANDARD_CONNECTION_REQUIRED','This tool requires an explicit Cloud OAuth token, project, and location.',503)
    if credential.get('expiresAt',0)<=time.time(): raise Fault('TOKEN_EXPIRED','Cloud token expired. Reconnect; accepted operations are not resubmitted.',401)
