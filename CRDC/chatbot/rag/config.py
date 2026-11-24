"""Central settings. Everything can be overridden with environment variables."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

KNOWLEDGE_DIR = Path(os.getenv("KNOWLEDGE_DIR", ROOT / "knowledge"))
MODEL_DIR = Path(os.getenv("MODEL_DIR", ROOT / "models" / "multilingual-e5-small"))
INDEX_DIR = Path(os.getenv("INDEX_DIR", ROOT / "index"))
LOG_FILE = Path(os.getenv("LOG_FILE", ROOT / "logs" / "questions.jsonl"))

# --- Answerability gate (the anti-hallucination switch) -----------------------
# margin = cosine(best chunk) - median cosine(all chunks).
# An off-topic question scores about the same against every chunk (small margin);
# a real question makes one chunk stand out (large margin). This separated our
# eval data much better than the raw cosine, whose values for relevant and
# irrelevant questions overlap (0.80-0.86 for both).
#   margin >= STRONG_MARGIN                       -> answer
#   margin >= MIN_MARGIN and keyword score >= MIN_BM25 -> answer
#   keyword score >= STRONG_BM25 (very specific word match) -> answer
#   otherwise                                      -> refuse
# On top of this, a question whose best match is an out-of-scope guard chunk is always refused.
# Tuned with:  python scripts/evaluate.py --tune   (tuning set only, never the hold-out set)
MIN_DENSE = float(os.getenv("MIN_DENSE", "0.78"))          # absolute floor
MIN_MARGIN = float(os.getenv("MIN_MARGIN", "0.05"))
STRONG_MARGIN = float(os.getenv("STRONG_MARGIN", "0.07"))
MIN_BM25 = float(os.getenv("MIN_BM25", "6.0"))
STRONG_BM25 = float(os.getenv("STRONG_BM25", "8.0"))

MULTI_VECTOR = os.getenv("MULTI_VECTOR", "0") == "1"   # tested: no gain on hold-out, so off
TOP_K = int(os.getenv("TOP_K", "5"))
MAX_QUESTION_CHARS = int(os.getenv("MAX_QUESTION_CHARS", "500"))
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))

CENTER_EMAIL = "crdc-2@sadatacademy.edu.eg"
