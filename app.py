import streamlit as st
import data, kpis, charts

st.set_page_config(page_title="لوحة مؤشرات CRDC", page_icon="📊", layout="wide")

# ---------- RTL + خط عربي ----------
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
html, body, [class*="css"], .stApp { font-family: 'Cairo', sans-serif; direction: rtl; text-align: right; }
[data-testid="stMetric"] { background:#f1f5f9; border-right:5px solid #c9a227; padding:12px 16px; border-radius:10px; }
[data-testid="stMetricLabel"], [data-testid="stMetricValue"] { justify-content:flex-end; }
</style>""", unsafe_allow_html=True)

# ---------- Login للأدمن (بسيط للـ MVP) ----------
ADMIN_PW = data.get_secret("ADMIN_PASSWORD", "demo123")
if not st.session_state.get("auth"):
    st.title("لوحة مؤشرات مركز الاستشارات والبحوث والتطوير")
    pw = st.text_input("كلمة مرور الإدارة", type="password")
    if st.button("دخول"):
        if pw == ADMIN_PW:
            st.session_state["auth"] = True
            st.rerun()
        st.error("كلمة المرور غير صحيحة")
    st.stop()

df = data.load_data()

# ---------- فلاتر ----------
with st.sidebar:
    st.header("الفلاتر")
    d_from, d_to = st.date_input("الفترة", (df.request_date.min().date(), df.request_date.max().date()))
    services = st.multiselect("الخدمة", sorted(df.service.unique()))
    degrees = st.multiselect("الدرجة العلمية", sorted(df.degree.unique()))
    overdue_days = st.slider("حد التأخير (أيام)", 5, 30, 14)
    if st.button("تحديث البيانات"):
        st.cache_data.clear(); st.rerun()

f = df[(df.request_date.dt.date >= d_from) & (df.request_date.dt.date <= d_to)]
if services: f = f[f.service.isin(services)]
if degrees: f = f[f.degree.isin(degrees)]
if f.empty:
    st.warning("لا توجد بيانات للفلاتر المختارة"); st.stop()

st.title("📊 لوحة مؤشرات المركز")

# ---------- KPI cards ----------
c = st.columns(5)
c[0].metric("إجمالي الطلبات", f"{kpis.total_requests(f):,}")
c[1].metric("الإيرادات (جنيه)", f"{kpis.revenue(f):,.0f}")
c[2].metric("متوسط زمن التنفيذ", f"{kpis.avg_turnaround_days(f):.1f} يوم")
c[3].metric("قيد التنفيذ", kpis.in_progress(f))
c[4].metric("نسبة الإنجاز", f"{kpis.completion_rate(f):.0f}%")

# ---------- الرسوم ----------
r1 = st.columns(2)
r1[0].plotly_chart(charts.monthly_line(kpis.monthly_requests(f)), width="stretch")
r1[1].plotly_chart(charts.revenue_bar(kpis.revenue_by_service(f)), width="stretch")
r2 = st.columns(2)
r2[0].plotly_chart(charts.status_donut(kpis.status_distribution(f)), width="stretch")
r2[1].plotly_chart(charts.degree_bar(kpis.degree_distribution(f)), width="stretch")

# ---------- الطلبات المتأخرة ----------
st.subheader("⚠️ طلبات متأخرة")
late = kpis.overdue(f, overdue_days)
if late.empty:
    st.success("لا توجد طلبات متأخرة")
else:
    st.dataframe(late.rename(columns={"request_id": "رقم الطلب", "researcher_name": "الباحث",
                 "service": "الخدمة", "status": "الحالة", "days_since_paid": "أيام منذ السداد"}),
                 width="stretch", hide_index=True)
