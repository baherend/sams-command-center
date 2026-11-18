"""المكان الوحيد اللي بيعرف مصدر البيانات. باقي الكود بيستخدم load_data() بس."""
import os
import numpy as np
import pandas as pd
import streamlit as st

STATUSES = ["تم الطلب", "إذن دفع", "تم السداد", "قيد التنفيذ", "تعديلات مطلوبة", "تم الإنجاز"]
SERVICES = {  # الرسوم الأساسية من الدليل الإجرائي (راجعيها مع المركز)
    "تحكيم بحث علمي": 1500,
    "نشر بحث علمي": 2000,
    "تدقيق لغوي عربي": 3500,
    "تدقيق لغوي إنجليزي": 5000,
    "مراجعة إحصائية": 3500,
    "تحليل إحصائي": 7500,
    "قياس نسبة الاقتباس": 250,
    "التحول الرقمي": 1050,
}
DEGREES = ["دكتوراه أكاديمي", "ماجستير أكاديمي", "دكتوراه مهني", "ماجستير مهني"]
REQUIRED_COLS = ["request_id", "researcher_id", "researcher_name", "service", "degree",
                 "pages", "fee", "status", "request_date", "paid_date", "done_date"]
DATE_COLS = ["request_date", "paid_date", "done_date"]


def get_secret(key, default=None):
    """env أولاً، بعدين st.secrets، بعدين default (من غير ما يقع لو مفيش secrets.toml)."""
    if os.getenv(key):
        return os.getenv(key)
    try:
        return st.secrets[key]
    except Exception:
        return default


def _demo(n: int = 160, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp.today().normalize() - pd.Timedelta(days=180)
    req = start + pd.to_timedelta(rng.integers(0, 180, n), unit="D")
    service = rng.choice(list(SERVICES), n, p=[.14, .16, .12, .08, .1, .08, .2, .12])
    status = rng.choice(STATUSES, n, p=[.06, .05, .09, .2, .1, .5])
    paid = req + pd.to_timedelta(rng.integers(0, 4, n), unit="D")
    done = paid + pd.to_timedelta(rng.integers(3, 25, n), unit="D")
    df = pd.DataFrame({
        "request_id": [f"R{1000+i}" for i in range(n)],
        "researcher_id": [f"RS{rng.integers(1, 61):03d}" for _ in range(n)],
        "researcher_name": [f"باحث {rng.integers(1, 61)}" for _ in range(n)],
        "service": service,
        "degree": rng.choice(DEGREES, n, p=[.3, .45, .1, .15]),
        "pages": rng.integers(15, 160, n),
        "status": status,
        "request_date": req, "paid_date": paid, "done_date": done,
    })
    df["fee"] = df["service"].map(SERVICES)
    # التواريخ اللي لسه ماحصلتش
    df.loc[df.status.isin(["تم الطلب", "إذن دفع"]), "paid_date"] = pd.NaT
    df.loc[df.status != "تم الإنجاز", "done_date"] = pd.NaT
    return df


def _validate(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"أعمدة ناقصة في ملف البيانات: {missing}")
    for c in DATE_COLS:
        df[c] = pd.to_datetime(df[c], errors="coerce")
    df["fee"] = pd.to_numeric(df["fee"], errors="coerce").fillna(0)
    df["pages"] = pd.to_numeric(df["pages"], errors="coerce")
    return df


@st.cache_data(ttl=300, show_spinner="جاري تحميل البيانات...")
def load_data() -> pd.DataFrame:
    """DATA_SOURCE = demo | excel | gsheet  (من env أو st.secrets)"""
    src = get_secret("DATA_SOURCE", "demo")
    if src == "excel":
        path = get_secret("EXCEL_PATH", "requests.xlsx")
        return _validate(pd.read_excel(path, sheet_name="requests"))
    if src == "gsheet":
        import gspread
        gc = gspread.service_account_from_dict(dict(st.secrets["gcp_service_account"]))
        ws = gc.open_by_key(st.secrets["SHEET_ID"]).worksheet("requests")
        return _validate(pd.DataFrame(ws.get_all_records()))
    return _validate(_demo())
