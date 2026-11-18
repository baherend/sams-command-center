"""دوال صافية (pure) لحساب الـ KPIs — الشات بوت يقدر يستخدمها برضه."""
import pandas as pd

DONE = "تم الإنجاز"
PAID_STATUSES = ["تم السداد", "قيد التنفيذ", "تعديلات مطلوبة", "تم الإنجاز"]


def total_requests(df): return int(len(df))
def revenue(df): return float(df.loc[df.status.isin(PAID_STATUSES), "fee"].sum())
def in_progress(df): return int(df.status.isin(["قيد التنفيذ", "تعديلات مطلوبة"]).sum())


def completion_rate(df):
    return float((df.status == DONE).mean() * 100) if len(df) else 0.0


def avg_turnaround_days(df):
    d = df[(df.status == DONE)].dropna(subset=["paid_date", "done_date"])
    return float((d.done_date - d.paid_date).dt.days.mean()) if len(d) else 0.0


def monthly_requests(df):
    return (df.set_index("request_date").resample("MS").size()
              .rename("requests").reset_index())


def revenue_by_service(df):
    p = df[df.status.isin(PAID_STATUSES)]
    return p.groupby("service", as_index=False)["fee"].sum().sort_values("fee")


def status_distribution(df):
    return df.groupby("status", as_index=False).size().rename(columns={"size": "count"})


def degree_distribution(df):
    return df.groupby("degree", as_index=False)["researcher_id"].nunique() \
             .rename(columns={"researcher_id": "researchers"}).sort_values("researchers")


def overdue(df, days: int = 14):
    """طلبات قيد التنفيذ/تعديلات بقالها أكتر من `days` يوم من السداد."""
    d = df[df.status.isin(["قيد التنفيذ", "تعديلات مطلوبة"])].copy()
    d["days_since_paid"] = (pd.Timestamp.today().normalize() - d.paid_date).dt.days
    return (d[d.days_since_paid > days]
            .sort_values("days_since_paid", ascending=False)
            [["request_id", "researcher_name", "service", "status", "days_since_paid"]])
