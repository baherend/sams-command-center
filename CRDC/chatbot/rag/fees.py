"""Fees: one source of truth (knowledge/fees.json) for BOTH the fee chunks and the calculator.

Numbers are never typed into the guide text and never produced by a model.
They are read from fees.json and computed with plain arithmetic.
"""
import json
import re
from pathlib import Path

from .chunker import Chunk
from .text import normalize


def load_fees(knowledge_dir: Path) -> dict:
    data = json.loads((knowledge_dir / "fees.json").read_text(encoding="utf-8"))
    return {"eg": data["eg"], "intl": data["intl"]}


def _n(x: int) -> str:
    return f"{x:,}"


# ----------------------------------------------------------------------------
# 1) Fee chunks (generated text, indexed like any other chunk)
# ----------------------------------------------------------------------------
_FEE_KW_AR = "الرسوم, رسوم, بكام, كام, سعر, التكلفه, تكلفه, فلوس, مصاريف, ادفع كام, الاسعار"
_FEE_KW_EN = "fees, fee, cost, price, how much, pay, charges"


def _pub(f, lang):
    c = f["currency_ar"] if lang == "ar" else f["currency_en"]
    together = f["refereeing"] + f["publishing"] + f["certificate"]
    if lang == "ar":
        lines = [f"• رسوم التحكيم: {_n(f['refereeing'])} {c}"]
        lines.append(f"• رسوم النشر للبحث حتى {f['paper_pages']} صفحة: {_n(f['publishing'])} {c}"
                     + ("" if f["certificate"] else " (شاملة الإفادة)"))
        lines.append(f"• كل صفحة زيادة عن {f['paper_pages']} صفحة: {_n(f['paper_extra_page'])} {c}")
        if f["certificate"]:
            lines.append(f"• رسوم الإفادة: {_n(f['certificate'])} {c}")
        lines.append(f"• الإجمالي للتحكيم والنشر معًا لبحث حتى {f['paper_pages']} صفحة: {_n(together)} {c}")
    else:
        lines = [f"• Refereeing fee: {c} {_n(f['refereeing'])}"]
        lines.append(f"• Publishing fee for a paper up to {f['paper_pages']} pages: {c} {_n(f['publishing'])}"
                     + ("" if f["certificate"] else " (certificate included)"))
        lines.append(f"• Each page beyond {f['paper_pages']} pages: {c} {_n(f['paper_extra_page'])}")
        if f["certificate"]:
            lines.append(f"• Certificate fee: {c} {_n(f['certificate'])}")
        lines.append(f"• Total for refereeing and publishing together, paper up to {f['paper_pages']} pages: {c} {_n(together)}")
    return lines


def _ling(f, lang):
    c = f["currency_ar"] if lang == "ar" else f["currency_en"]
    p = f["thesis_pages"]
    inc_ar = "" if f["certificate"] else " (شاملة إدخال التعديلات والإفادة)"
    inc_en = "" if f["certificate"] else " (includes entering corrections and the certificate)"
    if lang == "ar":
        lines = [f"• التدقيق اللغوي باللغة العربية حتى {p} صفحة: {_n(f['proof_ar_base'])} {c}{inc_ar}، و{_n(f['proof_ar_extra'])} {c} لكل صفحة زيادة",
                 f"• التدقيق اللغوي باللغة الإنجليزية حتى {p} صفحة: {_n(f['proof_en_base'])} {c}{inc_ar}، و{_n(f['proof_en_extra'])} {c} لكل صفحة زيادة"]
        if f["certificate"]:
            lines.append(f"• رسوم الإفادة: {_n(f['certificate'])} {c}")
    else:
        lines = [f"• Arabic proofreading up to {p} pages: {c} {_n(f['proof_ar_base'])}{inc_en}, plus {c} {_n(f['proof_ar_extra'])} per extra page",
                 f"• English proofreading up to {p} pages: {c} {_n(f['proof_en_base'])}{inc_en}, plus {c} {_n(f['proof_en_extra'])} per extra page"]
        if f["certificate"]:
            lines.append(f"• Certificate fee: {c} {_n(f['certificate'])}")
    return lines


def _stat(f, lang):
    c = f["currency_ar"] if lang == "ar" else f["currency_en"]
    if lang == "ar":
        inc = "" if f["certificate"] else " (شاملة الإفادة)"
        lines = [f"• المراجعة الإحصائية عن كامل الرسالة: {_n(f['stat_review'])} {c}{inc}",
                 f"• التحليل الإحصائي عن كامل الرسالة: {_n(f['stat_analysis'])} {c}{inc}"]
        if f["certificate"]:
            lines.append(f"• رسوم الإفادة لكل خدمة: {_n(f['certificate'])} {c}")
    else:
        inc = "" if f["certificate"] else " (certificate included)"
        lines = [f"• Statistical review, whole thesis: {c} {_n(f['stat_review'])}{inc}",
                 f"• Statistical analysis, whole thesis: {c} {_n(f['stat_analysis'])}{inc}"]
        if f["certificate"]:
            lines.append(f"• Certificate fee for each service: {c} {_n(f['certificate'])}")
    return lines


def _dig(f, lang):
    c = f["currency_ar"] if lang == "ar" else f["currency_en"]
    if lang == "ar":
        lines = [f"• الدورة + الاختبارات: {_n(f['digital_course_exam'])} {c}",
                 f"• الاختبارات فقط: {_n(f['digital_exam_only'])} {c}"]
        if f.get("digital_redo"):
            lines.append(f"• إعادة الاختبار أو طلب شهادة أخرى أو تعديل بيانات الشهادة: {_n(f['digital_redo'])} {c}")
    else:
        lines = [f"• Course + exams: {c} {_n(f['digital_course_exam'])}",
                 f"• Exams only: {c} {_n(f['digital_exam_only'])}"]
        if f.get("digital_redo"):
            lines.append(f"• Exam retake, another certificate, or changing certificate data: {c} {_n(f['digital_redo'])}")
    return lines


def _cit(f, lang):
    c = f["currency_ar"] if lang == "ar" else f["currency_en"]
    return [f"• قياس نسبة الاقتباس عن كامل الرسالة: {_n(f['similarity'])} {c}" if lang == "ar"
            else f"• Similarity measurement, whole thesis: {c} {_n(f['similarity'])}"]


_FEE_SECTIONS = {
    # id: (service, ar title, en title, ar kw, en kw, builder)
    "fees_pub": ("publication", "رسوم تحكيم ونشر الأبحاث", "Refereeing and publishing fees",
                 "رسوم النشر, رسوم التحكيم, سعر النشر, نشر بحث بكام, الصفحه الزياده", "publishing fee, refereeing fee, extra page", _pub),
    "fees_ling": ("proofreading", "رسوم التدقيق اللغوي", "Language proofreading fees",
                  "رسوم التدقيق, سعر التدقيق اللغوي, المراجعه اللغويه بكام", "proofreading fee, language review cost", _ling),
    "fees_stat": ("statistics", "رسوم التحليل الإحصائي والمراجعة الإحصائية", "Statistical analysis and review fees",
                  "رسوم التحليل الاحصائي, سعر المراجعه الاحصائيه, الاحصاء بكام", "statistical analysis fee, statistical review cost", _stat),
    "fees_dig": ("digital", "رسوم شهادة أساسيات التحول الرقمي", "Digital Transformation certificate fees",
                 "رسوم التحول الرقمي, سعر الدوره, سعر الاختبار, اعاده الاختبار", "digital transformation fee, course price, exam fee, retake", _dig),
    "fees_cit": ("similarity", "رسوم قياس نسبة الاقتباس", "Similarity measurement fees",
                 "رسوم الاقتباس, سعر قياس الاقتباس, الاقتباس بكام", "similarity fee, plagiarism check cost", _cit),
}


def build_fee_chunks(fees: dict) -> list[Chunk]:
    chunks = []
    for cid, (service, t_ar, t_en, kw_ar, kw_en, fn) in _FEE_SECTIONS.items():
        ar = [f"{t_ar}:", "", "للباحث المصري (تُسدَّد في خزينة الأكاديمية بالجنيه المصري):", *fn(fees["eg"], "ar"),
              "", "للباحث الوافد (تُسدَّد في البنك المعتمد بالدولار الأمريكي):", *fn(fees["intl"], "ar")]
        en = [f"{t_en}:", "", "Egyptian researchers (paid at the Academy treasury in EGP):", *fn(fees["eg"], "en"),
              "", "International researchers (paid at the approved bank in USD):", *fn(fees["intl"], "en")]
        if cid == "fees_pub":
            ar += ["", "رسوم التحكيم والنشر تُدفع معًا مرة واحدة تسهيلًا على الباحثين. وأي فروق في عدد الصفحات تُسدَّد قبل استلام الإفادات النهائية."]
            en += ["", "Refereeing and publishing fees are paid together at once as a facilitation for researchers. Any page difference is paid before receiving the final certificates."]
        if cid == "fees_ling":
            ar += ["", "أي فروق في عدد الصفحات تُسدَّد قبل استلام الإفادات النهائية."]
            en += ["", "Any page difference is paid before receiving the final certificates."]
        src_ar = "الدليل الإجرائي – جدول الرسوم (مولَّد من fees.json)"
        src_en = "Procedural guide – Fee table (generated from fees.json)"
        chunks.append(Chunk(cid, "ar", t_ar, "\n".join(ar), service, src_ar, [*_FEE_KW_AR.split(", "), *kw_ar.split(", ")]))
        chunks.append(Chunk(cid, "en", t_en, "\n".join(en), service, src_en, [*_FEE_KW_EN.split(", "), *kw_en.split(", ")]))
    return chunks


# ----------------------------------------------------------------------------
# 2) Calculator: deterministic, page-dependent services only
# ----------------------------------------------------------------------------
_PAGES = re.compile(r"(\d{1,4})\s*(?:صفحه|صفحات|ص\b|pages?\b|pg\b|p\b)")
_ANY_NUM = re.compile(r"\b(\d{1,4})\b")
_FEE_INTENT = re.compile(r"رسوم|بكام|كام|سعر|تكلف|فلوس|مصاريف|احسب|حساب|هدفع|ادفع|اجمالي|fee|cost|price|how much|calculat|total|pay")
_PROOF = re.compile(r"تدقيق|لغوي|لغويه|proofread|language review")
_PUB = re.compile(r"نشر|تحكيم|بحث|ورقه|مقال|publish|publication|referee|paper|article")
_INTL = re.compile(r"وافد|اجنبي|دولار|international|foreign|usd|dollar")
_EG = re.compile(r"مصري|جنيه|egyptian|egp|pound")
_EN_THESIS = re.compile(r"انجليز|english")
_AR_THESIS = re.compile(r"عربي|عربيه|arabic")


def parse_calc_request(question: str):
    """Return (service, pages, audiences, proof_langs) or None if this is not a page-based fee question."""
    q = normalize(question)
    # "تدقيق لغوي انجليزي 200 صفحة" has no money word but is clearly a price question.
    if not _FEE_INTENT.search(q) and not (_PAGES.search(q) and _PROOF.search(q)):
        return None
    if _PROOF.search(q):
        service = "proof"
    elif _PUB.search(q):
        service = "pub"
    else:
        return None
    m = _PAGES.search(q) or _ANY_NUM.search(q)
    if not m:
        return None
    pages = int(m.group(1))
    if not 1 <= pages <= 2000:
        return None
    if _INTL.search(q) and not _EG.search(q):
        audiences = ["intl"]
    elif _EG.search(q) and not _INTL.search(q):
        audiences = ["eg"]
    else:
        audiences = ["eg", "intl"]
    langs = None
    if service == "proof":
        en, ar = bool(_EN_THESIS.search(q)), bool(_AR_THESIS.search(q))
        langs = ["en"] if en and not ar else ["ar"] if ar and not en else ["ar", "en"]
    return service, pages, audiences, langs


def _calc_pub(f, pages):
    extra = max(0, pages - f["paper_pages"])
    items = [("ref", f["refereeing"]), ("pub", f["publishing"])]
    if extra:
        items.append(("extra", extra * f["paper_extra_page"]))
    if f["certificate"]:
        items.append(("cert", f["certificate"]))
    return extra, items


def _calc_proof(f, pages, lang):
    extra = max(0, pages - f["thesis_pages"])
    base, per = (f["proof_en_base"], f["proof_en_extra"]) if lang == "en" else (f["proof_ar_base"], f["proof_ar_extra"])
    items = [("base", base)]
    if extra:
        items.append(("extra", extra * per))
    if f["certificate"]:
        items.append(("cert", f["certificate"]))
    return extra, per, items


def calculate(fees: dict, service: str, pages: int, audiences: list[str], langs, out_lang: str) -> str:
    ar = out_lang == "ar"
    who = {"eg": ("باحث مصري", "Egyptian researcher"), "intl": ("باحث وافد", "International researcher")}
    blocks = []
    for a in audiences:
        f = fees[a]
        c = f["currency_ar"] if ar else f["currency_en"]
        money = (lambda x: f"{_n(x)} {c}") if ar else (lambda x: f"{c} {_n(x)}")
        if service == "pub":
            extra, items = _calc_pub(f, pages)
            lab = {"ref": ("رسوم التحكيم", "Refereeing fee"),
                   "pub": (f"رسوم النشر (حتى {f['paper_pages']} صفحة){'' if f['certificate'] else ' شاملة الإفادة'}",
                           f"Publishing fee (up to {f['paper_pages']} pages){'' if f['certificate'] else ', certificate included'}"),
                   "extra": (f"صفحات زيادة ({extra} × {_n(f['paper_extra_page'])})", f"Extra pages ({extra} × {_n(f['paper_extra_page'])})"),
                   "cert": ("رسوم الإفادة", "Certificate fee")}
            head = (f"تحكيم ونشر بحث {pages} صفحة — {who[a][0]}:" if ar
                    else f"Refereeing and publishing a {pages}-page paper — {who[a][1]}:")
            lines = [head] + [f"• {lab[k][0 if ar else 1]}: {money(v)}" for k, v in items]
            lines.append(f"الإجمالي: {money(sum(v for _, v in items))}" if ar else f"Total: {money(sum(v for _, v in items))}")
            blocks.append("\n".join(lines))
        else:
            for lg in langs:
                extra, per, items = _calc_proof(f, pages, lg)
                lname = ("الإنجليزية" if lg == "en" else "العربية") if ar else ("English" if lg == "en" else "Arabic")
                lab = {"base": (f"التدقيق اللغوي حتى {f['thesis_pages']} صفحة{'' if f['certificate'] else ' (شامل الإفادة)'}",
                                f"Proofreading up to {f['thesis_pages']} pages{'' if f['certificate'] else ' (certificate included)'}"),
                       "extra": (f"صفحات زيادة ({extra} × {_n(per)})", f"Extra pages ({extra} × {_n(per)})"),
                       "cert": ("رسوم الإفادة", "Certificate fee")}
                head = (f"تدقيق لغوي لرسالة باللغة {lname}، {pages} صفحة — {who[a][0]}:" if ar
                        else f"{lname} proofreading of a {pages}-page thesis — {who[a][1]}:")
                lines = [head] + [f"• {lab[k][0 if ar else 1]}: {money(v)}" for k, v in items]
                lines.append(f"الإجمالي: {money(sum(v for _, v in items))}" if ar else f"Total: {money(sum(v for _, v in items))}")
                blocks.append("\n".join(lines))
    note = []
    if service == "pub":
        note.append("رسوم التحكيم والنشر تُدفع معًا مرة واحدة تسهيلًا على الباحثين." if ar
                    else "Refereeing and publishing fees are paid together at once as a facilitation for researchers.")
    if len(audiences) == 2:
        note.append("تختلف الرسوم بين الباحث المصري والوافد، لذا عرضت الحالتين. اكتب «مصري» أو «وافد» إذا أردت حالة واحدة."
                    if ar else "Fees differ for Egyptian and international researchers, so both are shown.")
    return "\n\n".join(blocks + note)
