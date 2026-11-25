"""Arabic-aware text helpers: normalization, tokenization, language detection, linkify."""
import html
import re

_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")  # harakat + tatweel
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_TOKEN = re.compile(r"[a-z0-9%/]+|[ء-ي]+")

# Very common words that carry no meaning for retrieval.
_STOP = set("""
في من على عن الى الي الى ان او و ما ماذا هل هو هي انا انت احنا انتم ده دي دا كده ايه اي
مع لو يا بس كمان عشان علشان اللي الذي التي هذا هذه ذلك تلك كل لا لم لن قد ثم
the a an of to in on for is are be do does i my me you your it this that what how can with and or
مركز اكاديميه باحث center academy researcher
""".split())  # last line: words that appear everywhere in this domain, so matching them proves nothing


def to_ascii_digits(s: str) -> str:
    return s.translate(_DIGITS)


def normalize(s: str) -> str:
    """Normalize Arabic spelling variants so 'الرسالة' == 'الرساله', 'أ/إ/آ' == 'ا', Arabic digits -> ASCII."""
    s = to_ascii_digits(s or "").lower()
    s = _DIACRITICS.sub("", s)
    s = re.sub("[أإآٱ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return re.sub(r"\s+", " ", s).strip()


def _light_stem(tok: str) -> str:
    """Strip the most common Arabic prefixes (ال، وال، بال، لل) so 'والنشر' matches 'نشر'."""
    for p in ("وال", "بال", "فال", "كال", "لل", "ال"):
        if tok.startswith(p) and len(tok) - len(p) >= 3:
            return tok[len(p):]
    if tok.startswith("و") and len(tok) >= 5:
        return tok[1:]
    return tok


def tokenize(s: str) -> list[str]:
    toks = [_light_stem(t) for t in _TOKEN.findall(normalize(s)) if t not in _STOP]
    return [t for t in toks if t not in _STOP and len(t) > 1]


def is_arabic(s: str) -> bool:
    ar = len(re.findall(r"[؀-ۿ]", s))
    lat = len(re.findall(r"[A-Za-z]", s))
    return ar >= lat


_URL_OR_EMAIL = re.compile(
    r"(https?://[^\s<>()،,]+[^\s<>()،,.:;!?])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"
)


def linkify(text: str) -> str:
    """Escape the text, then turn every URL and email into a clickable <a> link. Safe to insert as HTML."""
    out, last = [], 0
    for m in _URL_OR_EMAIL.finditer(text):
        out.append(html.escape(text[last:m.start()]))
        if m.group(1):
            url = m.group(1)
            out.append(f'<a href="{html.escape(url)}" target="_blank" rel="noopener noreferrer" dir="ltr">{html.escape(url)}</a>')
        else:
            mail = m.group(2)
            out.append(f'<a href="mailto:{html.escape(mail)}" dir="ltr">{html.escape(mail)}</a>')
        last = m.end()
    out.append(html.escape(text[last:]))
    return "".join(out).replace("\n", "<br>")


def mask_personal_data(s: str) -> str:
    """For logs only: hide long digit runs (national ID, passport, phone) and emails."""
    s = re.sub(r"\d{7,}", "[رقم مخفي]", to_ascii_digits(s))
    return re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[email]", s)
