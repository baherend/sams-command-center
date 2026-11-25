"""The answer engine.

Pipeline for every question:
  1. guard      – empty / too long
  2. small talk – greetings and thanks (fixed replies)
  3. calculator – page-based fee questions are computed from fees.json, never retrieved or generated
  4. retrieval  – hybrid search: embeddings (FAISS) + keywords (BM25), fused with Reciprocal Rank Fusion
  5. gate       – if the best match is not close enough, REFUSE (this is what stops hallucination)
  6. answer     – return the matched chunk text word for word (extractive), with its source

There is no text generation step, so the bot cannot invent anything: every sentence
it shows exists in the knowledge base, and every number comes from fees.json.
"""
import re
from dataclasses import dataclass, field

import numpy as np

from . import config
from .bm25 import BM25
from .embedder import Embedder
from .fees import calculate, load_fees, parse_calc_request
from .index import load_index
from .journals import JournalRouter, load_journals
from .text import is_arabic, linkify, normalize

REFUSAL_AR = ("عذرًا، لا أستطيع الإجابة عن هذا السؤال لأن إجابته غير موجودة في الدليل الإجرائي للمركز، "
              "وأنا أجيب من الدليل فقط.\n"
              "يمكنك أن تسألني عن: الخدمات الخمس، الرسوم، الإجراءات، شروط النشر، مواصفات التنسيق، أو متطلبات الدرجة العلمية.\n"
              f"ولأي استفسار آخر تواصل مع المركز على {config.CENTER_EMAIL}")
REFUSAL_EN = ("Sorry, I can't answer this question because the answer is not in the center's procedural guide, "
              "and I only answer from the guide.\n"
              "You can ask me about: the five services, fees, procedures, publishing requirements, formatting, or degree requirements.\n"
              f"For anything else, contact the center at {config.CENTER_EMAIL}")
GREETING_AR = ("أهلًا بك! أنا مُرشِد، مساعد الباحث في مركز الاستشارات والبحوث والتطوير بأكاديمية السادات. "
               "أجيب من الدليل الإجرائي للمركز فقط. اسألني عن الخدمات، الرسوم، الإجراءات، شروط النشر، التنسيق، أو متطلبات درجتك العلمية.")
GREETING_EN = ("Hello! I'm Murshid, the researcher's assistant at the Consulting, Research and Development Center, Sadat Academy. "
               "I answer only from the center's procedural guide. Ask me about services, fees, procedures, publishing, formatting, or degree requirements.")
THANKS_AR, THANKS_EN = "العفو! يسعدني الإجابة عن أي سؤال آخر عن خدمات المركز.", "You're welcome! Ask me anything else about the center's services."

_GREET = re.compile(r"^(اهلا|مرحبا|السلام عليكم|سلام|هاي|هلو|صباح الخير|مساء الخير|hi|hello|hey|good (morning|evening))\b")
_THANKS = re.compile(r"(شكرا|متشكر|تسلم|ميرسي|thanks|thank you)")
# Explicit money words only. "كام" alone is NOT here: "النسبة كام؟" or "كام يوم؟" are not fee questions.
_WHY = re.compile(r"ليه|لماذا|لم |علشان ايه|why")
_FEE_Q = re.compile(r"رسوم|بكام|سعر|تكلف|فلوس|مصاريف|ادفع كام|fee|cost|price|how much")
# A fee answer is only given when the question names something the center offers. Without it,
# "رسوم الجيم كام؟" (gym fees) matched the publishing fee table on the word "رسوم" alone.
_SERVICE = re.compile(r"نشر|تحكيم|بحث|ورقه|مقال|تدقيق|لغوي|مراجعه|احصا|تحليل|اقتباس|استلال|تحول|رقمي|دوره|امتحان|اختبار|شهاده|افاده|رساله|صفح|خدم|"
                      r"publish|refere|paper|article|proofread|language|statist|analys|similar|plagiar|digital|course|exam|certificate|thesis|page|service")
_WHICH_FEE_AR = ["رسوم التحكيم والنشر", "رسوم التدقيق اللغوي", "رسوم التحليل الإحصائي", "رسوم قياس نسبة الاقتباس", "رسوم شهادة التحول الرقمي"]
_WHICH_FEE_EN = ["Refereeing and publishing fees", "Proofreading fees", "Statistical analysis fees", "Similarity check fees",
                 "Digital transformation certificate fees"]


@dataclass
class Answer:
    answer: str
    route: str                       # greeting | calculator | retrieval | refusal | invalid
    answered: bool
    lang: str
    sources: list = field(default_factory=list)
    suggestions: list = field(default_factory=list)
    options: list = field(default_factory=list)      # clickable choices: [{"label", "value"}]; the widget sends "value" back
    score: float | None = None
    top_id: str | None = None

    @property
    def answer_html(self) -> str:
        return linkify(self.answer)

    def to_dict(self) -> dict:
        return {"answer": self.answer, "answer_html": self.answer_html, "route": self.route, "answered": self.answered,
                "lang": self.lang, "sources": self.sources, "suggestions": self.suggestions, "options": self.options,
                "score": None if self.score is None else round(self.score, 4), "top_id": self.top_id}


class Engine:
    def __init__(self, embedder: Embedder | None = None):
        self.embedder = embedder or Embedder(config.MODEL_DIR)
        self.index, self.chunks, self.owners = load_index(config.INDEX_DIR)
        self.bm25 = BM25([c.index_text() for c in self.chunks])
        self.fees = load_fees(config.KNOWLEDGE_DIR)
        self.router = JournalRouter(load_journals(config.KNOWLEDGE_DIR))
        self.ids = sorted({c.id for c in self.chunks})
        self.by_key = {(c.id, c.lang): c for c in self.chunks}

    # ---- retrieval --------------------------------------------------------
    def retrieve(self, question: str):
        """Return ranked [(chunk_id, rrf, dense, bm25)] – one entry per chunk id (AR and EN versions merged)."""
        qv = self.embedder.embed_query(question)
        dense_all, idx = self.index.search(qv[None, :], self.index.ntotal)
        dense = {}
        for s, i in zip(dense_all[0], idx[0]):
            cid = self.chunks[self.owners[i]].id
            dense[cid] = max(dense.get(cid, -1.0), float(s))
        bm = {}
        for c, s in zip(self.chunks, self.bm25.scores(question)):
            bm[c.id] = max(bm.get(c.id, 0.0), s)
        # Reciprocal Rank Fusion: combine two rankings without having to calibrate their scores.
        d_rank = {cid: r for r, cid in enumerate(sorted(dense, key=dense.get, reverse=True))}
        b_rank = {cid: r for r, cid in enumerate(sorted(bm, key=bm.get, reverse=True))}
        rrf = {cid: 1 / (60 + d_rank[cid]) + (1 / (60 + b_rank[cid]) if bm[cid] > 0 else 0) for cid in self.ids}
        ranked = sorted(self.ids, key=lambda c: (rrf[c], dense[c]), reverse=True)
        self._median = float(np.median(list(dense.values())))   # baseline for the margin gate
        return [(cid, rrf[cid], dense[cid], bm[cid]) for cid in ranked]

    def passes_gate(self, dense: float, bm25: float) -> bool:
        margin = dense - self._median
        if dense < config.MIN_DENSE:
            return False
        if margin >= config.STRONG_MARGIN or bm25 >= config.STRONG_BM25:
            return True
        return margin >= config.MIN_MARGIN and bm25 >= config.MIN_BM25

    # ---- main entry -------------------------------------------------------
    def ask(self, question: str) -> Answer:
        q = (question or "").strip()
        lang = "ar" if is_arabic(q) else "en"
        if not q or len(q) > config.MAX_QUESTION_CHARS:
            msg = ("من فضلك اكتب سؤالًا قصيرًا (أقل من 500 حرف)." if lang == "ar"
                   else "Please write a shorter question (under 500 characters).")
            return Answer(msg, "invalid", False, lang)

        n = normalize(q)
        if len(n.split()) <= 4 and _GREET.search(n):
            return Answer(GREETING_AR if lang == "ar" else GREETING_EN, "greeting", True, lang)
        if len(n.split()) <= 5 and _THANKS.search(n):
            return Answer(THANKS_AR if lang == "ar" else THANKS_EN, "greeting", True, lang)

        # Journal routing: deterministic, from journals.json (see rag/journals.py).
        if self.router.wants_routing(q):
            spec = self.router.match(q)
            src_ar = "مجلات المركز – توجيه " + ("مقترح في انتظار اعتماد هيئة التحرير" if self.router.proposed else "معتمد")
            src_en = "Center journals – " + ("proposed routing, pending editorial approval" if self.router.proposed else "approved routing")
            sources = [{"id": "journals", "title": src_ar if lang == "ar" else src_en, "source": src_ar if lang == "ar" else src_en}]
            if spec:
                return Answer(self.router.result(spec, lang, config.CENTER_EMAIL), "journal", True, lang,
                              sources=sources, top_id="journal_router")
            text, options = self.router.chooser(lang)
            return Answer(text, "journal", True, lang, options=options, top_id="journal_router")

        calc = parse_calc_request(q)
        if calc:
            text = calculate(self.fees, *calc, out_lang=lang)
            src = "الدليل الإجرائي – جدول الرسوم (حساب آلي من fees.json)" if lang == "ar" else "Procedural guide – Fee table (computed from fees.json)"
            return Answer(text, "calculator", True, lang, sources=[{"id": "fees", "title": src, "source": src}])

        ranked = self.retrieve(q)
        top = ranked[0]
        # Fee question: if a fee chunk is among the top 3 and passes the gate, prefer it over a "steps" chunk.
        # (Never applied when the best match is an out-of-scope guard: the guard always wins.)
        if _FEE_Q.search(n) and not _WHY.search(n) and not top[0].startswith("oos_"):
            for cand in ranked[:3]:
                if cand[0].startswith("fees_") and self.passes_gate(cand[2], cand[3]):
                    top = cand
                    break

        cid, _, dense, bm = top
        # Refuse if (a) the best match is a known out-of-scope topic, (b) an out-of-scope guard in the
        # top 3 has STRONGER keyword evidence than the chosen answer, or (c) no chunk is close enough.
        guard_wins = any(g.startswith("oos_") and gb > bm for g, _, _, gb in ranked[:3])
        if cid.startswith("oos_") or guard_wins or not self.passes_gate(dense, bm):
            return Answer(REFUSAL_AR if lang == "ar" else REFUSAL_EN, "refusal", False, lang, score=dense, top_id=cid)

        if cid.startswith("fees_") and not _SERVICE.search(n):
            opts = _WHICH_FEE_AR if lang == "ar" else _WHICH_FEE_EN
            return Answer("رسوم أي خدمة من خدمات المركز تقصد؟" if lang == "ar" else "Fees for which of the center's services?",
                          "refusal", False, lang, options=[{"label": o, "value": o} for o in opts], score=dense, top_id="fees_which_service")

        chunk = self.by_key[(cid, lang)]
        prefix = "المصدر" if lang == "ar" else "Source"
        suggestions = [self.by_key[(c, lang)].title for c, _, d, b in ranked[1:4]
                       if c != cid and not c.startswith("oos_") and self.passes_gate(d, b)][:2]
        return Answer(chunk.text, "retrieval", True, lang,
                      sources=[{"id": cid, "title": chunk.title, "source": f"{prefix}: {chunk.source}"}],
                      suggestions=suggestions, score=dense, top_id=cid)
