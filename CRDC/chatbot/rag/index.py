"""Vector store: build once (offline), load at server start.

Stored in INDEX_DIR:
  vectors.faiss  – FAISS inner-product index of all chunk embeddings
  chunks.json    – chunk text + metadata, same order as the vectors
"""
import json
from dataclasses import asdict
from pathlib import Path

import faiss
import numpy as np

from . import config
from .chunker import Chunk, load_guide_chunks
from .embedder import Embedder
from .fees import build_fee_chunks, load_fees


def collect_chunks(knowledge_dir: Path) -> list[Chunk]:
    return load_guide_chunks(knowledge_dir) + build_fee_chunks(load_fees(knowledge_dir))


def build_index(knowledge_dir: Path, index_dir: Path, embedder: Embedder) -> int:
    """Index every chunk as one passage vector. Optional multi-vector mode (MULTI_VECTOR=1) adds,
    for every chunk,
       1 vector per question-like keyword phrase (2+ words), embedded as a query.
    It was evaluated and did NOT improve the hold-out results, so it is off by default.
    A user question is then compared with question-like text too, not only with a long passage
    (question-to-question similarity is sharper). owners[i] = index of the chunk that vector i belongs to."""
    chunks = collect_chunks(knowledge_dir)
    passage_vecs = embedder.embed_passages([c.index_text() for c in chunks])
    phrases, owners = [], list(range(len(chunks)))
    for ci, c in enumerate(chunks if config.MULTI_VECTOR else []):
        for kw in c.keywords:
            if len(kw.split()) >= 2:
                phrases.append(kw)
                owners.append(ci)
    phrase_vecs = np.vstack([embedder.embed_query(p) for p in phrases]) if phrases else np.zeros((0, passage_vecs.shape[1]), np.float32)
    vecs = np.vstack([passage_vecs, phrase_vecs]).astype(np.float32)
    index = faiss.IndexFlatIP(vecs.shape[1])   # exact search; at this size approximate search is pointless
    index.add(vecs)
    index_dir.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(index_dir / "vectors.faiss"))
    (index_dir / "chunks.json").write_text(json.dumps([asdict(c) for c in chunks], ensure_ascii=False, indent=1), encoding="utf-8")
    (index_dir / "owners.json").write_text(json.dumps(owners), encoding="utf-8")
    return len(chunks)


def load_index(index_dir: Path) -> tuple[faiss.Index, list[Chunk], list[int]]:
    index = faiss.read_index(str(index_dir / "vectors.faiss"))
    chunks = [Chunk(**d) for d in json.loads((index_dir / "chunks.json").read_text(encoding="utf-8"))]
    owners = json.loads((index_dir / "owners.json").read_text(encoding="utf-8"))
    if index.ntotal != len(owners):
        raise RuntimeError("Index files are out of sync. Rebuild with scripts/build_index.py")
    return index, chunks, owners
