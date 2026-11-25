"""HTTP API + chat widget.

    uvicorn app.main:app --host 0.0.0.0 --port 8000

Endpoints
  POST /api/chat     {"question": "..."}  -> answer JSON (see rag/engine.py Answer.to_dict)
  GET  /api/health   liveness check for the hosting platform
  GET  /             the chat widget (embed it in the Academy site with an <iframe>)
"""
import json
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rag import config
from rag.engine import Engine
from rag.text import mask_personal_data

app = FastAPI(title="CRDC Assistant", version="1.0", docs_url="/api/docs")
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])

engine = Engine()          # loads the model + index once, at startup
_hits: dict[str, deque] = defaultdict(deque)
STATIC = config.ROOT / "app" / "static"


class ChatIn(BaseModel):
    question: str = Field(..., max_length=2000)


def _rate_limited(ip: str) -> bool:
    now, q = time.time(), _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= config.RATE_LIMIT_PER_MIN:
        return True
    q.append(now)
    return False


def _log(question: str, a: dict) -> None:
    """One line per question -> logs/questions.jsonl. Feeds the dashboard team
    (most asked topics, refused questions = gaps in the guide). Personal numbers are masked."""
    try:
        config.LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "question": mask_personal_data(question),
               "lang": a["lang"], "route": a["route"], "answered": a["answered"], "top_id": a["top_id"], "score": a["score"]}
        with config.LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        pass   # logging must never break answering


@app.post("/api/chat")
def chat(body: ChatIn, request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    if _rate_limited(ip):
        raise HTTPException(429, "Too many questions, please wait a minute.")
    result = engine.ask(body.question).to_dict()
    _log(body.question, result)
    return result


@app.get("/api/health")
def health():
    return {"status": "ok", "chunks": len(engine.chunks)}


@app.get("/")
def widget():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
