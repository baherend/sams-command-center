import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'
import ResearcherPortal from './ResearcherPortal'

const StaffConsole = lazy(() => import('./StaffConsole'))
const AssistantWidget = lazy(() => import('./AssistantWidget'))
import PublicHome from './PublicHome'
import { friendlyErrorText, useSingleFlight, type LocalizedText } from './errors'
import { useI18n, pickName } from './i18n'

type StaffRole = 'admin' | 'reviewer' | 'publication_reviewer' | 'language_reviewer' | 'statistician' | 'digital_transformation_officer' | 'plagiarism_officer' | 'cashier' | 'viewer'
type StaffProfile = { staff_id: string; full_name: string; role: StaffRole; is_active: boolean }

type Degree = {
  degree_id: number
  name_ar: string
  name_en?: string | null
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
  degree_name_en?: string | null
  specialty: string | null
  nationality: string | null
  national_id: string | null
  passport_no: string | null
  created_at: string
}

type Mode = 'sign-in' | 'sign-up'

export default function App() {
  const { t, lang, dir, isEn } = useI18n()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ResearcherProfile | null>(null)
  const [staff, setStaff] = useState<StaffProfile | null>(null)
  const [inactiveStaff, setInactiveStaff] = useState(false)
  const [degrees, setDegrees] = useState<Degree[]>([])
  const [mode, setMode] = useState<Mode>(() => (typeof window !== 'undefined' && window.location.hash === '#signup' ? 'sign-up' : 'sign-in'))
  // Signed-out visitors land on the public home; #login and #signup open the account page.
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<LocalizedText | null>(null)
  const [error, setError] = useState<LocalizedText | null>(null)
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(() => typeof window !== 'undefined' && (window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery')))
  const [forgotPassword, setForgotPassword] = useState(false)
  const [profileApplicantType, setProfileApplicantType] = useState<'egyptian' | 'foreign'>('egyptian')
  // The user the portal state currently belongs to. Used to ignore auth events that do not
  // change who is signed in (token refresh, re-focus SIGNED_IN), which would otherwise reset forms.
  const activeUserId = useRef<string | null>(null)
  const singleFlight = useSingleFlight()

  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash
      setHash(next)
      if (next === '#signup') setMode('sign-up')
      if (next === '#login') setMode('sign-in')
      if (next === '#login' || next === '#signup') window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    setError(null)
    if (!supabase || !nextSession?.user) {
      setProfile(null)
      setStaff(null)
      setInactiveStaff(false)
      setDegrees([])
      return
    }

    setProfile(null)
    setStaff(null)
    setInactiveStaff(false)
    const { data: staffRow, error: staffError } = await supabase
      .schema('crdc')
      .from('staff_users')
      .select('staff_id, full_name, role, is_active')
      .eq('auth_user_id', nextSession.user.id)
      .maybeSingle()
    if (staffError) throw staffError
    if (staffRow) {
      if (staffRow.is_active) setStaff(staffRow as StaffProfile)
      else setInactiveStaff(true)
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
      supabase.schema('crdc').from('degrees').select('degree_id, name_ar, name_en, track, level').order('degree_id'),
    ])

    if (profileError) throw profileError
    if (degreeError) throw degreeError
    setProfile(researcher ? {
      ...researcher,
      degree_name: degreeRows?.find((degree) => degree.degree_id === researcher.degree_id)?.name_ar ?? null,
      degree_name_en: degreeRows?.find((degree) => degree.degree_id === researcher.degree_id)?.name_en ?? null,
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
      activeUserId.current = data.session?.user.id ?? null
      setSession(data.session)
      try {
        await loadProfile(data.session)
      } catch (loadError) {
        if (alive) setError(friendlyErrorText(loadError))
      } finally {
        if (alive) setLoading(false)
      }
    }).catch((loadError: unknown) => {
      if (alive) {
        setError(friendlyErrorText(loadError))
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!alive) return
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        setError(null)
      }
      const nextUserId = nextSession?.user.id ?? null
      if (nextUserId !== null && nextUserId === activeUserId.current) {
        // Same user (TOKEN_REFRESHED, duplicate SIGNED_IN, ...): keep the fresh session object
        // but do not reload the profile or touch loading/notice state, so open forms keep their input.
        setSession(nextSession)
        return
      }
      activeUserId.current = nextUserId
      setSession(nextSession)
      setConfirmationPending(false)
      setLoading(Boolean(nextSession))
      window.setTimeout(() => {
        void loadProfile(nextSession)
          .catch((loadError: unknown) => setError(friendlyErrorText(loadError)))
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
    const formElement = event.currentTarget
    await singleFlight(() => submitAuth(formElement))
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim().toLowerCase()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      if (resetError) throw resetError
      setNotice({ ar: 'إذا كان هذا البريد مرتبطًا بحساب، فستصلك رسالة تتضمن رابطًا آمنًا لإعادة تعيين كلمة المرور.', en: 'If this email is linked to an account, you will receive a secure password reset link.' })
    } catch (resetError) {
      setError(friendlyErrorText(resetError))
    } finally {
      setBusy(false)
    }
  }

  async function handleNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setRecoveryMode(false)
      setNotice({ ar: 'تم تعيين كلمة المرور الجديدة بنجاح.', en: 'Your new password has been set successfully.' })
    } catch (updateError) {
      setError(friendlyErrorText(updateError))
    } finally {
      setBusy(false)
    }
  }

  async function submitAuth(formElement: HTMLFormElement) {
    if (!supabase) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const form = new FormData(formElement)
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
          setNotice({ ar: 'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك الإلكتروني، ثم سجّل الدخول لاستكمال بيانات الباحث.', en: 'Account created. Check your email for the confirmation link, then sign in to complete your profile.' })
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
      }
    } catch (authError) {
      setError(friendlyErrorText(authError))
    } finally {
      setBusy(false)
    }
  }

  async function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    await singleFlight(() => submitProfile(formElement))
  }

  async function submitProfile(formElement: HTMLFormElement) {
    if (!supabase || !session?.user) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const form = new FormData(formElement)
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
        degree_name_en: degrees.find((degree) => degree.degree_id === data.degree_id)?.name_en ?? null,
      } as ResearcherProfile)
      setNotice({ ar: 'تم تسجيل ملف الباحث بنجاح، ويمكنك الآن الاطلاع على خدمات المركز.', en: 'Researcher profile saved. You can now explore the center services.' })
    } catch (profileError) {
      setError(friendlyErrorText(profileError))
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    setError(null)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(friendlyErrorText(signOutError))
    setProfile(null)
    setStaff(null)
    setInactiveStaff(false)
  }

  if (!supabaseConfigured || !supabase) {
    return <SetupScreen />
  }

  if (recoveryMode) return <main className="setup-screen" dir={dir}><div className="setup-card"><span className="eyebrow">{t('تأمين الحساب', 'Account Security')}</span><h1>{t('تعيين كلمة مرور جديدة', 'Set a New Password')}</h1><form className="form-stack" onSubmit={handleNewPassword}><label>{t('كلمة المرور الجديدة', 'New Password')}<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>{error && <p role="alert" className="message error">{error[lang]}</p>}<button className="primary-button" disabled={busy}>{busy ? t('لحظة واحدة...', 'One moment...') : t('حفظ كلمة المرور', 'Save Password')}</button></form></div></main>

  if (session && profile) {
    return (<><ResearcherPortal profile={profile} onSignOut={signOut} onProfileUpdated={setProfile} /><Suspense fallback={null}><AssistantWidget audience={profile.applicant_type === 'foreign' ? 'expat' : 'egyptian'} /></Suspense></>)
  }

  if (session && staff) return (<><Suspense fallback={<div className="loading" aria-busy="true"><span className="spinner" /> {t('بنحمّل لوحة الموظفين...', 'Loading staff console...')}</div>}><StaffConsole staff={staff} onSignOut={signOut} /></Suspense><Suspense fallback={null}><AssistantWidget audience="staff" /></Suspense></>)

  if (session && inactiveStaff) {
    return <main className="setup-screen" dir={dir}><div className="setup-card"><span className="brand-mark">{isEn ? 'C' : 'م'}</span><span className="eyebrow">{t('حساب موظف', 'Staff Account')}</span><h1>{t('الحساب غير مفعّل', 'Account Inactive')}</h1><p>{t('حساب الموظف هذا موقوف حاليًا. يُرجى التواصل مع إدارة المركز لتفعيله.', 'This staff account is currently inactive. Contact center administration to activate it.')}</p><button className="primary-button" onClick={signOut}>{t('تسجيل الخروج', 'Sign Out')}</button></div></main>
  }

  if (session && loading) {
    return <main className="setup-screen" dir={dir}><div className="setup-card"><span className="loading"><span className="spinner" /> {t('جارٍ التحقق من نوع الحساب...', 'Checking account type...')}</span></div></main>
  }

  if (session && error) {
    return <main className="setup-screen" dir={dir}><div className="setup-card"><span className="eyebrow">{t('تعذر تحميل الحساب', 'Failed to Load Account')}</span><h1>{t('حدثت مشكلة', 'Something Went Wrong')}</h1><p role="alert">{error[lang]}</p><button className="primary-button" onClick={signOut}>{t('تسجيل الخروج والمحاولة مرة أخرى', 'Sign Out and Try Again')}</button></div></main>
  }

  const showHome = !session && hash !== '#login' && hash !== '#signup'

  const header = (
      <header className="topbar">
        <a className="brand" href="#" onClick={() => { if (!session) window.location.hash = '' }} aria-label={t('مركز الاستشارات والبحوث والتطوير', 'Consultation, Research & Development Center')}>
          <img className="brand-seal" src="/brand/crdc-seal-96.webp" width={48} height={48} alt="" />
          <span><strong>{t('مركز الاستشارات والبحوث والتطوير', 'Consultation, Research & Development Center')}</strong><small>{t('أكاديمية السادات للعلوم الإدارية', 'Sadat Academy for Management Sciences')}</small></span>
        </a>
        {showHome && (
          <nav className="public-nav" aria-label={t('أقسام الصفحة', 'Page sections')}>
            <a href="#about">{t('عن المركز', 'About')}</a>
            <a href="#requirements">{t('المتطلبات', 'Requirements')}</a>
            <a href="#fees">{t('الرسوم', 'Fees')}</a>
            <a href="#steps">{t('الخطوات', 'Steps')}</a>
            <a href="#murshid">{t('مُرشِد', 'Murshid')}</a>
            <a href="#journals">{t('المجلات', 'Journals')}</a>
            <a href="#contact">{t('تواصل', 'Contact')}</a>
          </nav>
        )}
        {showHome && (
          <div className="header-actions">
            <a className="header-login" href="#login">{t('تسجيل الدخول', 'Sign in')}</a>
            <a className="header-signup" href="#signup">{t('إنشاء حساب', 'Create account')}</a>
          </div>
        )}
        <img className="academy-logo" src="/brand/sams-logo-192.jpg" width={44} height={44} alt={t('شعار أكاديمية السادات للعلوم الإدارية', 'Sadat Academy for Management Sciences logo')} />
        {session && <button className="quiet-button" onClick={signOut}>{t('تسجيل الخروج', 'Sign Out')}</button>}
      </header>
  )

  const footer = <footer className="page-footer"><span>CRDC</span><span>{t('مركز الاستشارات والبحوث والتطوير', 'Consultation, Research & Development Center')}</span><span>{t('نموذج أولي، وبياناتك محمية', 'Prototype · Your data is secure')}</span></footer>

  if (showHome) {
    return (
      <main className="page-shell" dir={dir}>
        {header}
        <section className="landing-hero" id="home">
          <article className="paper-sheet" aria-labelledby="landing-title">
            <header className="paper-running-head">
              <span>{t('مركز الاستشارات والبحوث والتطوير', 'Consultation, Research & Development Center')}</span>
              <span>{t('أكاديمية السادات للعلوم الإدارية', 'Sadat Academy for Management Sciences')}</span>
            </header>
            <div className="paper-body">
              <div className="paper-main">
                <p className="paper-kicker">{t('البوابة الإلكترونية لخدمات الباحثين والدراسات العليا', 'Online services for researchers and postgraduate students')}</p>
                <h1 id="landing-title"><span>{t('من المسودة', 'From draft')}</span> <span>{t('إلى المناقشة', 'to defense')}</span></h1>
                <div className="paper-abstract">
                  <span className="paper-label">{t('الملخص', 'Abstract')}</span>
                  <p>{t('يرافق المركز باحثي الماجستير والدكتوراه من المصريين والوافدين في بوابة واحدة: تعرّف على متطلبات درجتك، واحسب رسومك، وقدّم طلبك، وتابع كل خدمة حتى تسلّم إفادتها المعتمدة.', 'The center supports Egyptian and international master’s and PhD researchers in one portal: see what your degree requires, estimate your fees, submit your request and follow each service until you receive its certified statement.')}</p>
                </div>
                <p className="paper-keywords">
                  <span className="paper-label">{t('الكلمات المفتاحية', 'Keywords')}</span>
                  {t('تحكيم ونشر الأبحاث، التدقيق اللغوي، التحليل الإحصائي، قياس نسبة الاقتباس، شهادة أساسيات التحول الرقمي', 'peer review and publishing, proofreading, statistical analysis, plagiarism check, Digital Transformation Fundamentals certificate')}
                </p>
                <div className="landing-actions">
                  <a className="primary-button landing-cta" href="#signup">{t('قدّم طلب خدمة', 'Request a service')} <span>{isEn ? '→' : '←'}</span></a>
                  <a className="landing-secondary" href="#requirements">{t('تعرّف على متطلبات درجتك', 'See what your degree requires')}</a>
                </div>
              </div>
              <img className="landing-seal" src="/brand/crdc-seal-440.webp" width={260} height={260} alt="" />
            </div>
            <footer className="paper-footnote">
              <span aria-hidden="true">*</span> {t('لديك حساب بالفعل؟', 'Already registered?')} <a href="#login">{t('سجّل الدخول لمتابعة طلباتك', 'Sign in to track your requests')}</a>
            </footer>
          </article>
        </section>
        <PublicHome />
        {footer}
        <Suspense fallback={null}><AssistantWidget audience="all" /></Suspense>
      </main>
    )
  }

  return (
    <main className="page-shell" dir={dir}>
      {header}
      <section className="hero" id="home">
        <div className="hero-copy">
          <h1>{t('من التحكيم والنشر حتى إفادة المناقشة', 'From peer review and publishing to your defense certificate')}</h1>
          <p>{t('بوابة مركز الاستشارات والبحوث والتطوير لباحثي الماجستير والدكتوراه من المصريين والوافدين: قدّم طلبك، وادفع وارفع الإيصال، وتابع كل خدمة حتى تتسلّم إفادتها.', 'The CRDC portal for master’s and PhD researchers, Egyptian and international: submit your request, pay and upload the receipt, and track each service until you receive its certificate.')}</p>
          {!session && <a className="hero-link" href="#">{t('العودة إلى الصفحة الرئيسية', 'Back to the home page')}</a>}
        </div>

        <div className="form-card">
          {loading ? <div className="loading"><span className="spinner" /> {t('جارٍ تجهيز حسابك...', 'Preparing your account...')}</div> : !session ? (
            <>
              <div className="card-heading">
                <span className="card-icon">↗</span>
                <div>
                  <span className="eyebrow">{t('أهلًا بك', 'Welcome')}</span>
                  <h2>{forgotPassword ? t('استعادة كلمة المرور', 'Reset Password') : mode === 'sign-up' ? t('إنشاء حساب جديد', 'Create New Account') : t('تسجيل الدخول', 'Sign In')}</h2>
                </div>
              </div>
              {!forgotPassword && <div className="mode-switch" role="tablist" aria-label={t('نوع العملية', 'Action Type')}>
                <button className={mode === 'sign-in' ? 'active' : ''} onClick={() => { setMode('sign-in'); setNotice(null); setError(null); setConfirmationPending(false) }}>{t('تسجيل الدخول', 'Sign In')}</button>
                <button className={mode === 'sign-up' ? 'active' : ''} onClick={() => { setMode('sign-up'); setNotice(null); setError(null); setConfirmationPending(false) }}>{t('حساب جديد', 'Sign Up')}</button>
              </div>}
              {forgotPassword ? <form className="form-stack" onSubmit={handlePasswordReset}>
                <label>{t('البريد الإلكتروني', 'Email Address')}<input name="email" type="email" autoComplete="email" placeholder="name@example.com" required /></label>
                {notice && <p className="message success" role="status">{notice[lang]}</p>}{error && <p className="message error" role="alert">{error[lang]}</p>}
                <button className="primary-button" disabled={busy}>{busy ? t('لحظة واحدة...', 'One moment...') : 'إرسال رابط الاستعادة'}</button>
                <button type="button" className="quiet-button" onClick={() => { setForgotPassword(false); setNotice(null); setError(null) }}>{t('العودة لتسجيل الدخول', 'Back to Sign In')}</button>
              </form> : <form className="form-stack" onSubmit={handleAuth}>
                <label>{t('البريد الإلكتروني', 'Email Address')}<input name="email" type="email" autoComplete="email" placeholder="name@example.com" required /></label>
                <label>{t('كلمة المرور', 'Password')}<input name="password" type="password" minLength={8} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} placeholder={t('٨ أحرف على الأقل', 'At least 8 characters')} required /></label>
                {notice && <p className="message success" role="status">{notice[lang]}</p>}
                {error && <p className="message error" role="alert">{error[lang]}</p>}
                <button className="primary-button" disabled={busy || confirmationPending}>
                  {busy ? t('لحظة واحدة...', 'One moment...') : mode === 'sign-up' ? t('إنشاء الحساب', 'Create Account') : t('دخول', 'Sign In')} <span>{isEn ? '→' : '←'}</span>
                </button>
                {mode === 'sign-in' && <button type="button" className="quiet-button" onClick={() => { setForgotPassword(true); setNotice(null); setError(null) }}>{t('نسيت كلمة المرور؟', 'Forgot password?')}</button>}
                <p className="form-footnote">{t('بإنشاء حساب، يمكنك متابعة طلباتك وبياناتك من خلال حسابك الشخصي.', 'By creating an account, you can track your requests and profile from your personal dashboard.')}</p>
              </form>}
            </>
          ) : (
            <>
              <div className="card-heading">
                <span className="card-icon">✳</span>
                <div><span className="eyebrow">{t('خطوة واحدة', 'One Step')}</span><h2>{t('بيانات الباحث', 'Researcher Profile')}</h2></div>
              </div>
              <p className="card-description">{t('أدخل بياناتك الأساسية لتجهيز ملفك في المركز.', 'Enter your basic details so we can set up your profile at the center.')}</p>
              <form className="form-stack" onSubmit={handleProfile}>
                <label>{t('الاسم بالكامل', 'Full Name')}<input name="full_name" autoComplete="name" required minLength={3} placeholder={t('الاسم كما تريد أن يظهر في الطلب', 'Full name as it should appear on requests')} /></label>
                <label>{t('نوع الباحث', 'Applicant Type')}<select name="applicant_type" value={profileApplicantType} onChange={(event) => setProfileApplicantType(event.target.value as 'egyptian' | 'foreign')}><option value="egyptian">{t('مصري', 'Egyptian')}</option><option value="foreign">{t('وافد', 'International / Foreign')}</option></select></label>
                <div className="two-fields">
                  {profileApplicantType === 'egyptian' ? (
                    <label>{t('الرقم القومي', 'National ID')}<input name="national_id" inputMode="numeric" pattern="[23][0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{7}" minLength={14} maxLength={14} required placeholder={t('١٤ رقمًا', '14 digits')} /></label>
                  ) : (
                    <>
                      <label>{t('رقم جواز السفر', 'Passport Number')}<input name="passport_no" minLength={3} required placeholder={t('رقم الجواز', 'Passport No.')} /></label>
                      <label>{t('الجنسية', 'Nationality')}<input name="nationality" minLength={2} required placeholder={t('الجنسية', 'Nationality')} /></label>
                    </>
                  )}
                </div>
<label>{t('الدرجة العلمية', 'Academic Degree')}<select name="degree_id" defaultValue="" required><option value="" disabled>{t('اختر الدرجة', 'Select degree')}</option>{degrees.map((degree) => <option key={degree.degree_id} value={degree.degree_id}>{pickName(degree, lang)}</option>)}</select></label>
                <label>{t('التخصص', 'Specialty')}<input name="specialty" placeholder={t('مثال: إدارة أعمال', 'e.g., Business Administration')} /></label>
                {error && <p className="message error" role="alert">{error[lang]}</p>}
                <button className="primary-button" disabled={busy}>{busy ? t('جارٍ حفظ بياناتك...', 'Saving your profile...') : t('حفظ ملف الباحث', 'Save Researcher Profile')} <span>{isEn ? '→' : '←'}</span></button>
                <p className="form-footnote">{t('لا تظهر بياناتك إلا لك وللموظفين المصرّح لهم. ويتم تعديل الملف بعد التسجيل عن طريق إدارة المركز.', 'Your data is visible only to you and authorized staff. Profile updates after registration are handled by center administration.')}</p>
              </form>
            </>
          )}
        </div>
      </section>

      {footer}
    </main>
  )
}

function SetupScreen() {
  const { t, dir, isEn } = useI18n()
  return <main className="setup-screen" dir={dir}><div className="setup-card"><span className="brand-mark">{isEn ? 'C' : 'م'}</span><span className="eyebrow">{t('إعداد الاتصال', 'Connection Setup')}</span><h1>{t('اربط البوابة بـSupabase', 'Connect the Portal to Supabase')}</h1><p>انسخ ملف <code>.env.example</code> باسم <code>.env.local</code>، وأضف عنوان المشروع ومفتاح publishable أو anon key.</p><p className="form-footnote">لا يُوضع مفتاح service role في الواجهة الأمامية أبدًا.</p></div></main>
}

