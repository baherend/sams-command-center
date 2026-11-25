"""Local embedding model: multilingual-e5-small (quantized ONNX), no API, no GPU.

Why this model:
- multilingual: Arabic, Egyptian colloquial and English questions land in the same vector space
- small (~118 MB quantized), runs on a cheap CPU server
- e5 expects prefixes: "query: " for questions and "passage: " for documents
"""
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


class Embedder:
    def __init__(self, model_dir: Path, max_len: int = 512):
        model_path = model_dir / "model_quantized.onnx"
        if not model_path.exists():
            model_path = model_dir / "model.onnx"
        if not model_path.exists():
            raise FileNotFoundError(f"No ONNX model in {model_dir}. Run: python scripts/download_model.py")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.session = ort.InferenceSession(str(model_path), opts, providers=["CPUExecutionProvider"])
        self.input_names = {i.name for i in self.session.get_inputs()}
        self.tok = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tok.enable_truncation(max_length=max_len)
        self.tok.enable_padding(pad_id=self.tok.token_to_id("<pad>") or 1, pad_token="<pad>")

    def _encode(self, texts: list[str]) -> np.ndarray:
        enc = self.tok.encode_batch(texts)
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.input_names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        hidden = self.session.run(None, feeds)[0]                      # (batch, seq, 384)
        m = mask[..., None].astype(np.float32)
        vec = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)      # mean pooling over real tokens
        return (vec / np.linalg.norm(vec, axis=1, keepdims=True)).astype(np.float32)  # L2 -> dot product = cosine

    def embed_passages(self, texts: list[str], batch: int = 16) -> np.ndarray:
        return np.vstack([self._encode([f"passage: {t}" for t in texts[i:i + batch]]) for i in range(0, len(texts), batch)])

    def embed_query(self, text: str) -> np.ndarray:
        return self._encode([f"query: {text}"])[0]
