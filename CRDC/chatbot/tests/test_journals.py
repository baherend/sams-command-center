"""Journal routing tests – no model needed:  python -m pytest tests/"""
from rag import config
from rag.journals import JournalRouter, load_journals

R = JournalRouter(load_journals(config.KNOWLEDGE_DIR))


def test_routing_intent_detected():
    assert R.wants_routing("أنشر بحثي في أنهي مجلة؟")
    assert R.wants_routing("Which journal should I publish in?")


def test_journal_links_question_is_not_routing():
    # "what are the links" is a plain guide question, answered by retrieval
    assert not R.wants_routing("What are the journal links?")
    assert not R.wants_routing("ازاي ارفع البحث على المجلة؟")


def test_button_pick_returns_one_journal():
    spec = R.match("تخصصي: المحاسبة والمراجعة")
    assert spec["id"] == "accounting"
    text = R.result(spec, "ar", config.CENTER_EMAIL)
    assert "مجلة السادات للبحوث الإدارية والمالية" in text and "https://sjsaf.journals.ekb.eg" in text
    assert "مجلة البحوث الإدارية\n" not in text


def test_shared_field_returns_both_journals():
    text = R.result(R.match("تخصصي: إدارة الأعمال والموارد البشرية والتسويق"), "ar", config.CENTER_EMAIL)
    assert "https://jso.journals.ekb.eg" in text and "https://sjsaf.journals.ekb.eg" in text


def test_field_inside_question_answers_directly():
    assert R.match("انشر فين بحث عن السياحة والفنادق؟")["id"] == "tourism"


def test_two_fields_in_one_question_asks_instead_of_guessing():
    assert R.match("انشر فين بحث عن الذكاء الاصطناعي في المحاسبة؟") is None


def test_other_shows_both_and_proposed_note():
    text = R.result(R.match("تخصصي: غير ذلك / مش متأكد"), "ar", config.CENTER_EMAIL)
    assert "jso" in text and "sjsaf" in text
    assert "مقترح" in text   # routing_status is still "proposed"


def test_chooser_has_a_button_per_field_plus_other():
    _, options = R.chooser("ar")
    assert len(options) == len(R.specs) + 1
    assert all(o["value"].startswith("تخصصي:") for o in options)
