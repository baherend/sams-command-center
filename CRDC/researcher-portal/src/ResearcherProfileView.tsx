import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { friendlyErrorText, useSingleFlight, type LocalizedText } from './errors'
import { useI18n, pickName, type Lang } from './i18n'

type ApplicantType = 'egyptian' | 'foreign'
type ResearcherProfile = {
  researcher_id: string
  full_name: string
  applicant_type: ApplicantType
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

const formatDate = (value: string | null | undefined, lang: Lang = 'ar') =>
  value ? new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ar-EG', { dateStyle: 'medium' }).format(new Date(value)) : '—'

type Props = {
  profile: ResearcherProfile
  onProfileUpdated: (profile: ResearcherProfile) => void
  setNotice: (notice: LocalizedText | null) => void
  setError: (error: LocalizedText | null) => void
}

export default function ResearcherProfileView({ profile, onProfileUpdated, setNotice, setError }: Props) {
  const { t, lang, isEn } = useI18n()
  const singleFlight = useSingleFlight()
  const [profileSaving, setProfileSaving] = useState(false)
  const [degrees, setDegrees] = useState<{ degree_id: number; name_ar: string; name_en?: string | null }[]>([])

  useEffect(() => {
    if (!supabase) return
    void supabase.schema('crdc').from('degrees').select('degree_id, name_ar, name_en').order('degree_id')
      .then(({ data }) => setDegrees(data ?? []))
  }, [])

  async function submitProfileEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    await singleFlight(async () => {
      if (!supabase) return
      setProfileSaving(true)
      setError(null)
      setNotice(null)
      const form = new FormData(formElement)
      const degreeId = Number(form.get('degree_id'))
      try {
        const { data, error: updateError } = await supabase.schema('crdc').from('researchers')
          .update({
            full_name: String(form.get('full_name') ?? '').trim(),
            degree_id: Number.isFinite(degreeId) && degreeId > 0 ? degreeId : null,
            specialty: String(form.get('specialty') ?? '').trim() || null,
          })
          .eq('researcher_id', profile.researcher_id)
          .select('researcher_id, full_name, applicant_type, email, degree_id, specialty, nationality, national_id, passport_no, created_at')
          .single()
        if (updateError) throw updateError
        onProfileUpdated({ ...data, degree_name: degrees.find((degree) => degree.degree_id === data.degree_id)?.name_ar ?? null, degree_name_en: degrees.find((degree) => degree.degree_id === data.degree_id)?.name_en ?? null } as ResearcherProfile)
        setNotice({ ar: 'تم تحديث بياناتك الشخصية.', en: 'Your profile has been updated.' })
      } catch (updateError) {
        setError(friendlyErrorText(updateError))
      } finally {
        setProfileSaving(false)
      }
    })
  }

  return (
    <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Researcher Account' : 'حساب الباحث'}</span><h1>{isEn ? 'My Profile' : 'ملفي الشخصي'}</h1><p>{t('بياناتك الأساسية المسجلة في حساب الباحث.', 'Your core details registered on your researcher account.')}</p></div>
            <article className="portal-card profile-card"><div className="profile-card-header"><div className="success-orbit"><span>✓</span></div><div><span className="eyebrow">{t('حسابك جاهز', 'Account Active')}</span><h2>{profile.full_name}</h2></div></div>
              <h3>{isEn ? 'Edit Personal Details' : 'تعديل البيانات الشخصية'}</h3>
              <form className="form-stack" onSubmit={submitProfileEdit}>
                <label>{isEn ? 'Applicant Type' : 'نوع الباحث'}<input value={profile.applicant_type === 'egyptian' ? (isEn ? 'Egyptian' : 'مصري') : (isEn ? 'International / Foreign' : 'وافد')} readOnly /></label>
                <label>{isEn ? 'Email Address' : 'البريد الإلكتروني'}<input value={profile.email} dir="ltr" readOnly /></label>
                <label>{profile.applicant_type === 'egyptian' ? t('الرقم القومي', 'National ID') : t('رقم جواز السفر', 'Passport Number')}<input value={profile.applicant_type === 'egyptian' ? profile.national_id ?? '' : profile.passport_no ?? ''} dir="ltr" readOnly /></label>
                {profile.applicant_type === 'foreign' && <label>{t('الجنسية', 'Nationality')}<input value={profile.nationality ?? ''} readOnly /></label>}
                <label>{isEn ? 'Full Name' : 'الاسم بالكامل'}<input name="full_name" defaultValue={profile.full_name} minLength={3} required /></label>
                <label>{isEn ? 'Academic Degree' : 'الدرجة العلمية'}<select name="degree_id" defaultValue={profile.degree_id ?? ''}><option value="">{t('بدون تحديد', 'Not specified')}</option>{degrees.map((degree) => <option key={degree.degree_id} value={degree.degree_id}>{pickName(degree, lang)}</option>)}</select></label>
                <label>{isEn ? 'Specialty' : 'التخصص'}<input name="specialty" defaultValue={profile.specialty ?? ''} /></label>
                <button className="primary-button" disabled={profileSaving}>{profileSaving ? (isEn ? 'Saving changes...' : 'جارٍ حفظ التعديلات...') : (isEn ? 'Save Changes' : 'حفظ التعديلات')}</button>
              </form>
              <dl className="profile-details"><dt>{t('تاريخ إنشاء الملف', 'Profile Created On')}</dt><dd>{formatDate(profile.created_at, lang)}</dd></dl>
            </article>
    </>
  )
}
