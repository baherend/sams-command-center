"""Journal routing: guide a researcher to the right journal by asking for the research specialization.

Deterministic, like the fee calculator: no model decides the journal. The specialization → journal map
lives in knowledge/journals.json. While routing_status is "proposed", every answer says so.

Flow:
  "انشر فين؟"            -> chooser: question + one button per specialization
  button "تخصصي: X"       -> the journal(s) for X, with link, scope and frequency
  "انشر فين بحث محاسبة؟" -> specialization found in the question -> answer directly
"""
import json
import re
from pathlib import Path

from .text import normalize, tokenize

_INTENT = re.compile(
    r"انشر فين|انشر في انهي|انشر بحثي فين|انهي مجله|اي مجله|مجله مناسبه|انسب مجله|اختار مجله|المجله المناسبه|"
    r"which journal|where (should|can|do) i publish|where to publish|choose a journal|right journal|suitable journal"
)
_PICK_AR, _PICK_EN = "تخصصي:", "My field:"
_OTHER_AR, _OTHER_EN = "غير ذلك / مش متأكد", "Other / not sure"


def load_journals(knowledge_dir: Path) -> dict:
    return json.loads((knowledge_dir / "journals.json").read_text(encoding="utf-8"))


def _contains(question_tokens: list[str], phrase: str) -> bool:
    p = tokenize(phrase)
    n = len(p)
    return n > 0 and any(question_tokens[i:i + n] == p for i in range(len(question_tokens) - n + 1))


class JournalRouter:
    def __init__(self, data: dict):
        self.data = data
        self.journals = data["journals"]
        self.specs = data["specializations"]
        self.proposed = data.get("routing_status") != "approved"

    # ---- detection --------------------------------------------------------
    def is_pick(self, question: str) -> bool:
        q = question.strip()
        return q.startswith(_PICK_AR) or q.lower().startswith(_PICK_EN.lower())

    def wants_routing(self, question: str) -> bool:
        return bool(_INTENT.search(normalize(question))) or self.is_pick(question)

    def match(self, question: str):
        """Return the specialization dict, 'other', or None."""
        q = question.strip()
        if self.is_pick(q):
            picked = normalize(q.split(":", 1)[1])
            if picked in (normalize(_OTHER_AR), normalize(_OTHER_EN)):
                return "other"
            for s in self.specs:
                if picked in (normalize(s["label_ar"]), normalize(s["label_en"])):
                    return s
        toks = tokenize(q)
        hits = [s for s in self.specs
                if any(_contains(toks, k) for k in [s["label_ar"], s["label_en"], *s["kw"]])]
        return hits[0] if len(hits) == 1 else None   # 0 or 2+ matches -> ask instead of guessing

    # ---- answers ----------------------------------------------------------
    def chooser(self, lang: str) -> tuple[str, list[dict]]:
        ar = lang == "ar"
        text = ("المركز بينشر في مجلتين معتمدتين بتقييم 7/7. علشان أقترح عليك الأنسب، اختار تخصص بحثك:"
                if ar else "The center publishes in two journals rated 7/7. To suggest the right one, choose your research field:")
        opts = [{"label": s["label_ar"] if ar else s["label_en"],
                 "value": f"{_PICK_AR} {s['label_ar']}" if ar else f"{_PICK_EN} {s['label_en']}"} for s in self.specs]
        opts.append({"label": _OTHER_AR if ar else _OTHER_EN,
                     "value": f"{_PICK_AR} {_OTHER_AR}" if ar else f"{_PICK_EN} {_OTHER_EN}"})
        return text, opts

    def _journal_block(self, key: str, lang: str) -> str:
        j = self.journals[key]
        if lang == "ar":
            return f"• {j['name_ar']}\n  {j['url']}\n  مجالاتها: {j['scope_ar']}\n  تصدر: {j['frequency_ar']}"
        return f"• {j['name_en']}\n  {j['url']}\n  Fields: {j['scope_en']}\n  Published: {j['frequency_en']}"

    def result(self, spec, lang: str, email: str) -> str:
        ar = lang == "ar"
        if spec == "other":
            keys = list(self.journals)
            head = ("مفيش تخصص محدد، فدي المجلتين علشان تقارن بينهم:" if ar
                    else "No specific field, so here are both journals to compare:")
        else:
            keys = spec["journals"]
            label = spec["label_ar"] if ar else spec["label_en"]
            if len(keys) == 1:
                head = f"لتخصص «{label}»، المجلة المقترحة:" if ar else f"For «{label}», the suggested journal is:"
            else:
                head = (f"تخصص «{label}» يناسب المجلتين، فاختار حسب موضوع بحثك:" if ar
                        else f"«{label}» fits both journals; choose by your paper's topic:")
        lines = [head, "", *[self._journal_block(k, lang) for k in keys], ""]
        if self.proposed:
            lines.append("ملحوظة: ده توجيه مبدئي مقترح، والقرار النهائي لهيئة تحرير المجلة." if ar
                         else "Note: this is a proposed guide; the journal's editorial board makes the final decision.")
        else:
            lines.append("القرار النهائي لهيئة تحرير المجلة." if ar
                         else "The journal's editorial board makes the final decision.")
        lines.append(f"للاستفسار: {email}" if ar else f"Questions: {email}")
        return "\n".join(lines)
