import json

import httpx
import pytest

from src import ilmu


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("ILMU_API_KEY", "k")
    monkeypatch.delenv("ILMU_ASR_PATH", raising=False)


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def chat(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def test_transcribe():
    def h(req):
        assert req.url.path == "/v1/audio/transcriptions"
        assert req.headers["authorization"] == "Bearer k"
        assert b"ilmu-asr-v4.2" in req.content
        return httpx.Response(200, json={"text": "tolong quote 50 bag simen"})

    assert ilmu.transcribe(b"x", "audio/ogg", client=client(h)) == "tolong quote 50 bag simen"


def test_asr_path_override(monkeypatch):
    monkeypatch.setenv("ILMU_ASR_PATH", "/asr")
    c = client(lambda r: httpx.Response(200, json={"text": r.url.path}))
    assert ilmu.transcribe(b"x", client=c) == "/v1/asr"


def test_extract_json_with_fewshot():
    def h(req):
        body = json.loads(req.content)
        assert body["model"] == "ilmu-mini-v3.3"
        assert len(body["messages"]) == 4  # system + 1 shot (2) + user
        return chat('```json\n{"qty": 50}\n```')

    out = ilmu.extract_json("50 bag", {"type": "object"}, [("10 bag", {"qty": 10})], client=client(h))
    assert out == {"qty": 50}


def test_extract_json_retry_then_ok():
    n = []

    def h(req):
        n.append(1)
        return chat("not json" if len(n) == 1 else '{"a": 1}')

    assert ilmu.extract_json("t", {}, client=client(h)) == {"a": 1}
    assert len(n) == 2


def test_extract_json_fails_twice():
    with pytest.raises(ilmu.IlmuError, match="invalid JSON"):
        ilmu.extract_json("t", {}, client=client(lambda r: chat("nope")))


def test_errors(monkeypatch):
    with pytest.raises(ilmu.IlmuError, match="401"):
        ilmu.transcribe(b"x", client=client(lambda r: httpx.Response(401, text="bad key")))
    monkeypatch.delenv("ILMU_API_KEY")
    with pytest.raises(ilmu.IlmuError, match="ILMU_API_KEY"):
        ilmu.transcribe(b"x")


def test_timeout_wrapped():
    def h(req):
        raise httpx.ReadTimeout("slow")

    with pytest.raises(ilmu.IlmuError, match="failed"):
        ilmu.transcribe(b"x", client=client(h))


def test_runpod(monkeypatch):
    with pytest.raises(ilmu.IlmuError):
        ilmu.transcribe_runpod(b"x")
    monkeypatch.setenv("RUNPOD_ENDPOINT_URL", "https://api.runpod.ai/v2/abc")
    monkeypatch.setenv("RUNPOD_API_KEY", "rk")

    def h(req):
        assert str(req.url) == "https://api.runpod.ai/v2/abc/runsync"
        assert req.headers["authorization"] == "Bearer rk"
        return httpx.Response(200, json={"status": "COMPLETED", "output": {"text": "hi"}})

    assert ilmu.transcribe_runpod(b"x", client=client(h))["output"]["text"] == "hi"
