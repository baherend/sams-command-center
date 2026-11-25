"""Download the embedding model (multilingual-e5-small, quantized ONNX) from Hugging Face.
    python scripts/download_model.py
"""
import shutil
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rag import config  # noqa: E402

REPO = "Xenova/multilingual-e5-small"   # ONNX export of intfloat/multilingual-e5-small (MIT)
FILES = {"onnx/model_quantized.onnx": "model_quantized.onnx", "tokenizer.json": "tokenizer.json"}

if __name__ == "__main__":
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for remote, local in FILES.items():
        path = hf_hub_download(REPO, remote)
        shutil.copy(path, config.MODEL_DIR / local)
        print("saved", config.MODEL_DIR / local)
