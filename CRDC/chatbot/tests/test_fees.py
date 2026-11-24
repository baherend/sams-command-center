"""Calculator tests – no model needed, run with:  python -m pytest tests/"""
from rag import config
from rag.fees import calculate, load_fees, parse_calc_request

FEES = load_fees(config.KNOWLEDGE_DIR)


def total(q, lang="ar"):
    return calculate(FEES, *parse_calc_request(q), out_lang=lang)


def test_publication_egyptian_with_extra_pages():
    # 1500 refereeing + 1500 publishing + 7*80 extra + 500 certificate
    assert "4,060 جنيه" in total("كام رسوم نشر بحث 32 صفحة مصري")


def test_publication_international_certificate_included():
    # 200 + 400 (certificate included) + 7*20
    assert "740 دولار" in total("كام رسوم نشر بحث 32 صفحة وافد")


def test_proofreading_english_egyptian():
    # 4500 + 50*50 extra + 500 certificate
    assert "7,500 جنيه" in total("تدقيق لغوي انجليزي 200 صفحة مصري")


def test_arabic_digits_are_understood():
    assert "700 دولار" in total("احسب رسوم النشر لبحث ٣٠ صفحة وافد")


def test_no_pages_means_no_calculation():
    assert parse_calc_request("رسوم النشر كام؟") is None


def test_non_fee_question_is_not_calculated():
    assert parse_calc_request("البحث يكون 25 صفحة ولا اكتر؟") is None
