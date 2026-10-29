import base64
import json
import os

import httpx

from .parse_util import Mask

BASE_URL = "https://api.ilmu.ai/v1"
ASR_PATH = "/audio/transcriptions"  # unverified; override with ILMU_ASR_PATH
ASR_MODEL = "ilmu-asr-v4.2"
LLM_MODEL = "ilmu-mini-v3.3"


class IlmuError(RuntimeError):
    pass


def _client(client):
    return client or httpx.Client(timeout=httpx.Timeout(60, connect=10))


def _key():
    k = os.environ.get("ILMU_API_KEY")
    if not k:
        raise IlmuError("ILMU_API_KEY is not set")
    return k


def _base():
    return os.environ.get("ILMU_BASE_URL", BASE_URL).rstrip("/")


def _post(client, url, **kw):
    try:
        r = _client(client).post(url, headers={"Authorization": f"Bearer {_key()}"}, **kw)
    except httpx.HTTPError as e:
        raise IlmuError(f"ILMU request failed: {e!r}") from e
    if r.status_code >= 400:
        raise IlmuError(f"ILMU {r.status_code} at {url}: {r.text[:300]}")
    return r.json()


def transcribe(audio_bytes: bytes, mime: str = "audio/ogg", *, client=None, language: str | None = None) -> str:
    ext = {"mpeg": "mp3", "x-m4a": "m4a", "x-wav": "wav", "wave": "wav", "opus": "ogg"}.get(e := mime.split("/")[-1].split(";")[0].strip(), e) or "ogg"  # ILMU reads the format from the file name
    client = client or httpx.Client(timeout=httpx.Timeout(180, connect=10))  # ILMU: a transcript can take up to 120 s
    data = {"model": os.environ.get("ILMU_ASR_MODEL") or ASR_MODEL, **({"language": language} if language else {})}
    j = _post(
        client, _base() + os.environ.get("ILMU_ASR_PATH", ASR_PATH),
        data=data, files={"file": (f"audio.{ext}", audio_bytes, mime)},
    )
    return j["text"]


def extract_json(text: str, json_schema: dict, few_shot=(), *, client=None, names=()) -> dict:
    """Chat completion asking for JSON matching schema; one retry on invalid JSON."""
    msgs = [{
        "role": "system",
        "content": "Extract data from the user's text. Reply with ONLY a JSON object "
                   "matching this JSON schema:\n" + json.dumps(json_schema),
    }]
    for u, a in few_shot:
        msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": json.dumps(a)}]
    mask = Mask(names)  # every model call is masked here, so no caller can forget; the reply is unmasked before it is returned
    msgs.append({"role": "user", "content": mask(text)})
    err = None
    for _ in range(2):
        j = _post(client, _base() + "/chat/completions", json={
            "model": os.environ.get("ILMU_MODEL") or LLM_MODEL, "messages": msgs, "temperature": 0,
            "response_format": {"type": "json_object"},
        })
        content = ""
        try:
            content = j["choices"][0]["message"]["content"].strip()
            if content.startswith("```"):
                content = content.strip("`").removeprefix("json").strip()
            out = json.loads(content)
            if isinstance(out, dict):
                return mask.unmask(out)
            err = "not a JSON object"
        except (KeyError, IndexError, ValueError) as e:
            err = repr(e)
        msgs += [
            {"role": "assistant", "content": content},
            {"role": "user", "content": "Invalid JSON. Reply with ONLY the JSON object."},
        ]
    raise IlmuError(f"ILMU returned invalid JSON twice: {err}")


def transcribe_runpod(audio_bytes: bytes, mime: str = "audio/ogg", *, client=None) -> dict:
    """RunPod runsync fallback. Input shape depends on the deployed worker (unverified)."""
    url, key = os.environ.get("RUNPOD_ENDPOINT_URL"), os.environ.get("RUNPOD_API_KEY")
    if not url or not key:
        raise IlmuError("RUNPOD_ENDPOINT_URL / RUNPOD_API_KEY not set")
    url = url.rstrip("/")
    if not url.endswith("/runsync"):
        url += "/runsync"
    try:
        r = _client(client).post(
            url, headers={"Authorization": f"Bearer {key}"}, timeout=120,
            json={"input": {"audio_base64": base64.b64encode(audio_bytes).decode(), "mime": mime}},
        )
    except httpx.HTTPError as e:
        raise IlmuError(f"RunPod request failed: {e!r}") from e
    if r.status_code >= 400:
        raise IlmuError(f"RunPod {r.status_code}: {r.text[:300]}")
    return r.json()
