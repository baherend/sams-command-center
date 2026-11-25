"""Structure-aware chunking.

The guide is already organized by topic, so instead of cutting it every N tokens
(which would split a fee table or a list of steps in half), each "## [id] Title"
section becomes exactly one chunk. One chunk = one complete, self-contained answer.
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

_HEADER = re.compile(r"^##\s*\[([a-z0-9_]+)\]\s*(.+?)\s*$", re.M)
_META = re.compile(r"<!--\s*(.*?)\s*-->", re.S)


@dataclass
class Chunk:
    id: str
    lang: str            # "ar" | "en"
    title: str
    text: str            # shown to the user word for word
    service: str = "general"
    source: str = ""
    keywords: list[str] = field(default_factory=list)  # used for retrieval only, never shown

    def index_text(self) -> str:
        """What we embed / BM25-index: title + keywords + body."""
        return f"{self.title}\n{' '.join(self.keywords)}\n{self.text}"


def parse_markdown(path: Path, lang: str) -> list[Chunk]:
    raw = path.read_text(encoding="utf-8")
    heads = list(_HEADER.finditer(raw))
    chunks = []
    for i, h in enumerate(heads):
        body = raw[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(raw)]
        meta = {}
        m = _META.search(body)
        if m:
            for part in m.group(1).split("|"):
                if ":" in part:
                    k, v = part.split(":", 1)
                    meta[k.strip()] = v.strip()
            body = body[:m.start()] + body[m.end():]
        chunks.append(Chunk(
            id=h.group(1), lang=lang, title=h.group(2), text=body.strip(),
            service=meta.get("service", "general"), source=meta.get("source", ""),
            keywords=[k.strip() for k in meta.get("kw", "").split(",") if k.strip()],
        ))
    return chunks


def load_guide_chunks(knowledge_dir: Path) -> list[Chunk]:
    ar = parse_markdown(knowledge_dir / "guide_ar.md", "ar")
    en = parse_markdown(knowledge_dir / "guide_en.md", "en")
    ar_ids, en_ids = {c.id for c in ar}, {c.id for c in en}
    if ar_ids != en_ids:
        raise ValueError(f"guide_ar.md and guide_en.md must have the same chunk ids. "
                         f"Only in AR: {ar_ids - en_ids}  Only in EN: {en_ids - ar_ids}")
    if len(ar_ids) != len(ar):
        raise ValueError("Duplicate chunk id in guide_ar.md")
    return ar + en + load_guard_chunks(knowledge_dir)


def load_guard_chunks(knowledge_dir: Path) -> list[Chunk]:
    """Out-of-scope guard chunks (ids start with 'oos_'): indexed, never shown. Registered for both languages."""
    path = knowledge_dir / "out_of_scope.md"
    if not path.exists():
        return []
    guards = parse_markdown(path, "ar")
    for g in guards:
        if not g.id.startswith("oos_"):
            raise ValueError(f"Guard chunk id must start with 'oos_': {g.id}")
    return guards + [Chunk(g.id, "en", g.title, g.text, g.service, g.source, g.keywords) for g in guards]
