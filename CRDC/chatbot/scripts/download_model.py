"""Download the embedding model (multilingual-e5-small, quantized ONNX) from Hugging Face.
    python scripts/download_model.py
"""
import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rag import config  # noqa: E402

REPO = "Xenova/multilingual-e5-small"   # ONNX export of intfloat/multilingual-e5-small (MIT)
FILES = {"onnx/model_quantized.onnx": "model_quantized.onnx", "tokenizer.json": "tokenizer.json"}

# Set MURSHID_MODEL_REVISION to a commit hash to pin the download. The printed snapshot folder name
# is the commit actually downloaded. Either way, scripts/export_web.py --check verifies the files'
# SHA-256 against the values the portal ships with, so a changed upload is caught in CI.
REVISION = os.environ.get("MURSHID_MODEL_REVISION", "761b726dd34fb83930e26aab4e9ac3899aa1fa78")  # confirmed by CI on 2026-11-25

if __name__ == "__main__":
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for remote, local in FILES.items():
        path = hf_hub_download(REPO, remote, revision=REVISION)
        shutil.copy(path, config.MODEL_DIR / local)
        print("saved", config.MODEL_DIR / local, "from snapshot", Path(path).parent.name if "/" not in remote else Path(path).parents[1].name)
