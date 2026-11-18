import plotly.express as px

NAVY, GOLD = "#1e3a5f", "#c9a227"
PALETTE = [NAVY, "#0f766e", GOLD, "#64748b", "#b45309", "#7c3aed"]
FONT = dict(family="Cairo, Tajawal, sans-serif", size=14)


def _style(fig, title):
    fig.update_layout(title=dict(text=title, x=1, xanchor="right"), font=FONT,
                      margin=dict(l=10, r=10, t=50, b=10), height=340,
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      legend=dict(orientation="h", y=-0.2), xaxis_title=None, yaxis_title=None)
    return fig


def monthly_line(m):
    fig = px.line(m, x="request_date", y="requests", markers=True,
                  color_discrete_sequence=[NAVY])
    fig.update_traces(hovertemplate="%{x|%Y-%m}<br>عدد الطلبات: %{y}<extra></extra>")
    return _style(fig, "الطلبات شهرياً")


def revenue_bar(r):
    fig = px.bar(r, x="fee", y="service", orientation="h", color_discrete_sequence=[GOLD])
    fig.update_traces(hovertemplate="%{y}<br>الإيرادات: %{x:,.0f} جنيه<extra></extra>")
    return _style(fig, "الإيرادات حسب الخدمة (جنيه)")


def status_donut(s):
    fig = px.pie(s, names="status", values="count", hole=.55, color_discrete_sequence=PALETTE)
    fig.update_traces(hovertemplate="%{label}: %{value}<extra></extra>")
    return _style(fig, "توزيع حالات الطلبات")


def degree_bar(d):
    fig = px.bar(d, x="researchers", y="degree", orientation="h", color_discrete_sequence=["#0f766e"])
    fig.update_traces(hovertemplate="%{y}: %{x} باحث<extra></extra>")
    return _style(fig, "الباحثون حسب الدرجة العلمية")
