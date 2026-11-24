"""Chunk the knowledge base, embed every chunk, and save the FAISS index.
Run this every time you edit knowledge/*.md or knowledge/fees.json:
    python scripts/build_index.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag import config  # noqa: E402
from rag.embedder import Embedder  # noqa: E402
from rag.index import build_index  # noqa: E402

if __name__ == "__main__":
    n = build_index(config.KNOWLEDGE_DIR, config.INDEX_DIR, Embedder(config.MODEL_DIR))
    print(f"Indexed {n} chunks into {config.INDEX_DIR}")
