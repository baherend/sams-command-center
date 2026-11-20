import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'
import ResearcherPortal from './ResearcherPortal'

type Degree = {
  degree_id: number
  name_ar: string
  track: 'academic' | 'professional'
  level: 'masters' | 'phd'
}

type ResearcherProfile = {
  researcher_id: string
  full_name: string
  applicant_type: 'egyptian' | 'foreign'
  email: string
  degree_id: number | null
  degree_name: string | null
  specialty: string | null
  nationality: string | null
  national_id: string | null
  passport_no: string | null
  created_at: string
}

type Mode = 'sign-in' | 'sign-up'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'حصلت مشكلة غير متوقعة. جرّب تاني.'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ResearcherProfile | null>(null)
  const [degrees, setDegrees] = useState<Degree[]>([])
  const [mode, setMode] = useState<Mode>('sign-in')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [profileApplicantType, setProfileApplicantType] = useState<'egyptian' | 'foreign'>('egyptian')

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    if (!supabase || !nextSession?.user) {
      setProfile(null)
      setDegrees([])
      return
    }

    const [{ data: researcher, error: profileError }, { data: degreeRows, error: degreeError }] = await Promise.all([
      supabase
        .schema('crdc')
        .from('researchers')
        .select('researcher_id, full_name, applicant_type, email, degree_id, specialty, nationality, national_id, passport_no, created_at')
        .eq('auth_user_id', nextSession.user.id)
        .maybeSingle(),
      supabase.schema('crdc').from('degrees').select('degree_id, name_ar, track, level').order('degree_id'),
    ])

    if (profileError) throw profileError
    if (degreeError) throw degreeError
    setProfile(researcher ? {
      ...researcher,
      degree_name: degreeRows?.find((degree) => degree.degree_id === researcher.degree_id)?.name_ar ?? null,
    } as ResearcherProfile : null)
    setDegrees((degreeRows ?? []) as Degree[])
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let alive = true
    void supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (sessionError) throw sessionError
      if (!alive) return
      setSession(data.session)
      try {
        await loadProfile(data.session)
      } catch (loadError) {
        if (alive) setError(errorMessage(loadError))
      } finally {
        if (alive) setLoading(false)
      }
    }).catch((loadError: unknown) => {
      if (alive) {
        setError(errorMessage(loadError))
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return
      setSession(nextSession)
      setConfirmationPending(false)
      setLoading(Boolean(nextSession))
      window.setTimeout(() => {
        void loadProfile(nextSession)
          .catch((loadError: unknown) => setError(errorMessage(loadError)))
          .finally(() => setLoading(false))
      }, 0)
    })

    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setNotice('')

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const password = String(form.get('password') ?? '')

    try {
      if (mode === 'sign-up') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setConfirmationPending(true)
          setNotice('الحساب اتعمل. افتح رسالة التأكيد على إيميلك، وبعدها ارجع سجّل دخول علشان تكمل بيانات الباحث.')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
      }
    } catch (authError) {
      setError(errorMessage(authError))
    } finally {
      setBusy(false)
    }
  }

  async function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !session?.user) return
    setBusy(true)
    setError('')
    setNotice('')

    const form = new FormData(event.currentTarget)
    const applicantType = String(form.get('applicant_type')) as 'egyptian' | 'foreign'
    const degreeId = Number(form.get('degree_id'))

    try {
      const { data, error: insertError } = await supabase
        .schema('crdc')
        .from('researchers')
        .insert({
          auth_user_id: session.user.id,
          full_name: String(form.get('full_name') ?? '').trim(),
          applicant_type: applicantType,
          nationality: applicantType === 'foreign' ? String(form.get('nationality') ?? '').trim() : null,
          national_id: applicantType === 'egyptian' ? String(form.get('national_id') ?? '').trim() : null,
          passport_no: applicantType === 'foreign' ? String(form.get('passport_no') ?? '').trim() : null,
          degree_id: Number.isFinite(degreeId) && degreeId > 0 ? degreeId : null,
          specialty: String(form.get('specialty') ?? '').trim() || null,
          email: session.user.email?.trim().toLowerCase(),
        })
        .select('researcher_id, full_name, applicant_type, email, degree_id, specialty, nationality, national_id, passport_no, created_at')
        .single()

      if (insertError) throw insertError
      setProfile({
        ...data,
        degree_name: degrees.find((degree) => degree.degree_id === data.degree_id)?.name_ar ?? null,
      } as ResearcherProfile)
      setNotice('ملف الباحث اتسجل بنجاح. تقدر تبدأ تراجع خدمات المركز.')
    } catch (profileError) {
      setError(errorMessage(profileError))
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    setError('')
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(errorMessage(signOutError))
    setProfile(null)
  }

  if (!supabaseConfigured || !supabase) {
    return <SetupScreen />
  }

  if (session && profile) {
    return <ResearcherPortal profile={profile} onSignOut={signOut} />
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="مركز الاستشارات والبحوث والتطوير">
          <span className="brand-mark">م</span>
          <span><strong>مركز الاستشارات</strong><small>والبحوث والتطوير · أكاديمية السادات</small></span>
        </a>
        {session && <button className="quiet-button" onClick={signOut}>تسجيل الخروج</button>}
      </header>

      <section className="hero" id="home">
        <div className="hero-copy">
          <span className="eyebrow"><i /> بوابة الباحثين</span>
          <h1>خدماتك البحثية<br /><em>في مكان واحد</em></h1>
          <p>أنشئ حسابك، سجّل بياناتك الأساسية، وتابع طلبات خدمات المركز خطوة بخطوة.</p>
          <div className="hero-notes">
            <span><b>01</b> حساب آمن</span>
            <span><b>02</b> بياناتك خاصة</span>
            <span><b>03</b> متابعة واضحة</span>
          </div>
        </div>

        <div className="form-card">
          {loading ? <div className="loading"><span className="spinner" /> بنجهّز حسابك...</div> : !session ? (
            <>
              <div className="card-heading">
                <span className="card-icon">↗</span>
                <div>
                  <span className="eyebrow">أهلاً بيك</span>
                  <h2>{mode === 'sign-up' ? 'إنشاء حساب جديد' : 'سجّل دخولك'}</h2>
                </div>
              </div>
              <div className="mode-switch" role="tablist" aria-label="نوع العملية">
                <button className={mode === 'sign-in' ? 'active' : ''} onClick={() => { setMode('sign-in'); setNotice(''); setError(''); setConfirmationPending(false) }}>تسجيل الدخول</button>
                <button className={mode === 'sign-up' ? 'active' : ''} onClick={() => { setMode('sign-up'); setNotice(''); setError(''); setConfirmationPending(false) }}>حساب جديد</button>
              </div>
              <form className="form-stack" onSubmit={handleAuth}>
                <label>البريد الإلكتروني<input name="email" type="email" autoComplete="email" placeholder="name@example.com" required /></label>
                <label>كلمة المرور<input name="password" type="password" minLength={8} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} placeholder="٨ أحرف على الأقل" required /></label>
                {notice && <p className="message success" role="status">{notice}</p>}
                {error && <p className="message error" role="alert">{error}</p>}
                <button className="primary-button" disabled={busy || confirmationPending}>
                  {busy ? 'لحظة واحدة...' : mode === 'sign-up' ? 'إنشاء الحساب' : 'دخول'} <span>←</span>
                </button>
                <p className="form-footnote">بإنشاء حساب، هتقدر تتابع طلباتك وبياناتك من خلال حسابك الشخصي.</p>
              </form>
            </>
          ) : (
            <>
              <div className="card-heading">
                <span className="card-icon">✳</span>
                <div><span className="eyebrow">خطوة واحدة</span><h2>بيانات الباحث</h2></div>
              </div>
              <p className="card-description">اكتب بياناتك الأساسية علشان نجهّز ملفك في المركز.</p>
              <form className="form-stack" onSubmit={handleProfile}>
                <label>الاسم بالكامل<input name="full_name" autoComplete="name" required minLength={3} placeholder="الاسم زي ما تحب يظهر في الطلب" /></label>
                <label>نوع الباحث<select name="applicant_type" value={profileApplicantType} onChange={(event) => setProfileApplicantType(event.target.value as 'egyptian' | 'foreign')}><option value="egyptian">مصري</option><option value="foreign">وافد</option></select></label>
                <div className="two-fields">
                  {profileApplicantType === 'egyptian' ? (
                    <label>الرقم القومي<input name="national_id" inputMode="numeric" pattern="[0-9]{14}" minLength={14} maxLength={14} required placeholder="١٤ رقم" /></label>
                  ) : (
                    <>
                      <label>رقم جواز السفر<input name="passport_no" minLength={3} required placeholder="رقم الجواز" /></label>
                      <label>الجنسية<input name="nationality" minLength={2} required placeholder="الجنسية" /></label>
                    </>
                  )}
                </div>
                <label>الدرجة العلمية<select name="degree_id" defaultValue="" required><option value="" disabled>اختار الدرجة</option>{degrees.map((degree) => <option key={degree.degree_id} value={degree.degree_id}>{degree.name_ar}</option>)}</select></label>
                <label>التخصص<input name="specialty" placeholder="مثال: إدارة أعمال" /></label>
                {error && <p className="message error" role="alert">{error}</p>}
                <button className="primary-button" disabled={busy}>{busy ? 'بنسجل بياناتك...' : 'حفظ ملف الباحث'} <span>←</span></button>
                <p className="form-footnote">بياناتك بتظهر لك وللموظفين المصرّح لهم فقط. تعديل الملف بعد التسجيل بيتم عن طريق إدارة المركز.</p>
              </form>
            </>
          )}
        </div>
      </section>

      <footer className="page-footer"><span>CRDC</span><span>مركز الاستشارات والبحوث والتطوير</span><span>نموذج أولي · بياناتك في أمان</span></footer>
    </main>
  )
}

function SetupScreen() {
  return <main className="setup-screen" dir="rtl"><div className="setup-card"><span className="brand-mark">م</span><span className="eyebrow">إعداد الاتصال</span><h1>اربط البوابة بـSupabase</h1><p>انسخ ملف <code>.env.example</code> باسم <code>.env.local</code>، وحط عنوان المشروع ومفتاح الـpublishable أو anon key.</p><p className="form-footnote">مفتاح service role مايتحطّش أبدًا في الواجهة الأمامية.</p></div></main>
}

