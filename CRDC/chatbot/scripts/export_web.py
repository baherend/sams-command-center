"""Export Murshid for the researcher portal (runs in the browser, no server).

    python scripts/export_web.py           # write the file
    python scripts/export_web.py --check   # CI: fail if the committed file is out of date with knowledge/

Writes CRDC/researcher-portal/public/murshid/index.json with:
  - every chunk (guide AR/EN, out-of-scope guards, fee chunks) exactly as the Python engine indexes them
  - one passage embedding per chunk (float32, base64), made with the same quantized e5 model
    the browser downloads, so browser query vectors and these passage vectors match
  - journals.json and the gate thresholds from rag/config.py

Fees: the browser shows fee numbers from the database table crdc.fee_schedule, not from this file.
To keep the two from drifting apart, this script refuses to export when knowledge/fees.json and the
fee rows in supabase/migrations/*_crdc_reference_data.sql disagree.
"""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
sys.path.insert(0, str(ROOT))

from rag import config  # noqa: E402
from rag.embedder import Embedder  # noqa: E402
from rag.fees import load_fees  # noqa: E402
from rag.index import collect_chunks  # noqa: E402

OUT = REPO / "CRDC" / "researcher-portal" / "public" / "murshid" / "index.json"

# fee_schedule option_code -> (fees.json key for base_fee, fees.json key for extra_page_fee, key for included_pages)
_MAP = {
    "PUB_ARBITRATION": ("refereeing", None, None),
    "PUB_PUBLISH": ("publishing", "paper_extra_page", "paper_pages"),
    "LANG_AR": ("proof_ar_base", "proof_ar_extra", "thesis_pages"),
    "LANG_EN": ("proof_en_base", "proof_en_extra", "thesis_pages"),
    "STAT_REVIEW": ("stat_review", None, None),
    "STAT_ANALYSIS": ("stat_analysis", None, None),
    "DT_COURSE_EXAM": ("digital_course_exam", None, None),
    "DT_EXAM_ONLY": ("digital_exam_only", None, None),
    "DT_RETAKE": ("digital_redo", None, None),
    "PLAG": ("similarity", None, None),
}


def check_fees_match_database() -> None:
    files = sorted((REPO / "supabase" / "migrations").glob("*_crdc_reference_data.sql"))
    if not files:
        print("WARNING: reference-data migration not found; fee drift check skipped")
        return
    sql = files[0].read_text(encoding="utf-8")
    rows = re.findall(r"\('([A-Z_]+)'\s*,'(egyptian|foreign)','(EGP|USD)',(\d+),([\w:]+),([\w:]+),(\d+)", sql)
    fees = load_fees(ROOT / "knowledge")
    problems = []
    for code, app, _cur, base, inc, extra, cert in rows:
        f = fees["eg" if app == "egyptian" else "intl"]
        kb, ke, ki = _MAP[code]
        num = lambda s: None if s.startswith("null") else int(s)  # noqa: E731
        checks = [(kb, int(base)), (ke, num(extra)), (ki, num(inc))]
        if code == "PUB_PUBLISH":
            checks.append(("certificate", int(cert)))
        for key, db_value in checks:
            if key and f.get(key) != db_value:
                problems.append(f"{code}/{app}: fees.json {key}={f.get(key)} but database={db_value}")
    if len(rows) < 19:
        problems.append(f"expected 19 fee rows in {files[0].name}, parsed {len(rows)}")
    if problems:
        raise SystemExit("fees.json and crdc.fee_schedule disagree:\n  " + "\n  ".join(problems))
    print(f"fees.json matches {len(rows)} fee_schedule rows")


def model_files() -> dict:
    """SHA-256 and size of the model files the vectors were made with; the browser refuses any other file."""
    out = {}
    for key, name in (("model", "model_quantized.onnx"), ("tokenizer", "tokenizer.json")):
        data = (config.MODEL_DIR / name).read_bytes()
        out[key] = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
    return out


def check_up_to_date() -> None:
    """Compare everything except the vectors (float output can differ in the last bits across CPUs)."""
    committed = json.loads(OUT.read_text(encoding="utf-8"))
    chunks = collect_chunks(config.KNOWLEDGE_DIR)
    fresh = [{"id": c.id, "lang": c.lang, "title": c.title, "text": c.text, "service": c.service,
              "source": c.source, "keywords": c.keywords} for c in chunks]
    journals = json.loads((config.KNOWLEDGE_DIR / "journals.json").read_text(encoding="utf-8"))
    gate = {"min_dense": config.MIN_DENSE, "min_margin": config.MIN_MARGIN, "strong_margin": config.STRONG_MARGIN,
            "min_bm25": config.MIN_BM25, "strong_bm25": config.STRONG_BM25}
    stale = [name for name, a, b in [("chunks", fresh, committed["chunks"]), ("journals", journals, committed["journals"]),
                                     ("gate", gate, committed["gate"])] if a != b]
    files = model_files()
    pinned = committed["model"]
    for key in ("model", "tokenizer"):
        if files[key]["sha256"] != pinned.get(f"{key}_sha256"):
            raise SystemExit(f"The downloaded {key} file differs from the one Murshid was evaluated with "
                             f"(sha256 {files[key]['sha256']} != {pinned.get(f'{key}_sha256')}). "
                             "The Hub upload changed: re-run the evaluation, then scripts/export_web.py.")
    if stale:
        raise SystemExit(f"{OUT.relative_to(REPO)} is out of date ({', '.join(stale)}). Run: python scripts/export_web.py")
    print(f"{OUT.relative_to(REPO)} is up to date")


def main() -> None:
    check_fees_match_database()
    if "--check" in sys.argv:
        check_up_to_date()
        return
    chunks = collect_chunks(config.KNOWLEDGE_DIR)
    vecs = Embedder(config.MODEL_DIR).embed_passages([c.index_text() for c in chunks]).astype(np.float32)
    data = {
        "version": 1,
        "model": {"repo": "Xenova/multilingual-e5-small", "revision": "main", "file": "onnx/model_quantized.onnx",
                  "dim": int(vecs.shape[1]), **{f"{k}_{f}": v[f] for k, v in model_files().items() for f in ("sha256", "size")}},
        "gate": {"min_dense": config.MIN_DENSE, "min_margin": config.MIN_MARGIN, "strong_margin": config.STRONG_MARGIN,
                 "min_bm25": config.MIN_BM25, "strong_bm25": config.STRONG_BM25},
        "center_email": config.CENTER_EMAIL,
        "journals": json.loads((config.KNOWLEDGE_DIR / "journals.json").read_text(encoding="utf-8")),
        "chunks": [{"id": c.id, "lang": c.lang, "title": c.title, "text": c.text, "service": c.service,
                    "source": c.source, "keywords": c.keywords} for c in chunks],
        "vectors": base64.b64encode(vecs.tobytes()).decode("ascii"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(chunks)} chunks, {vecs.shape} vectors -> {OUT.relative_to(REPO)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
