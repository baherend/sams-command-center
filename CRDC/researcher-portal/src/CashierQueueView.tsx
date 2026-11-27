import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { friendlyErrorText, useSingleFlight, type LocalizedText } from './errors'
import { useI18n, pickName, type Lang } from './i18n'

type WorkType = 'thesis' | 'paper'
type RequestStatus = { status_id: number; code: string; name_ar: string; name_en?: string | null; sort_order: number }
type CashierPayment = {
  payment_id: number
  request_id: number
  receipt_no: string
  amount: number | string
  currency: 'EGP' | 'USD'
  channel: 'treasury' | 'bank'
  paid_at: string
  receipt_storage_path: string
  submitted_by_researcher_at: string
  has_more: boolean
  file_url?: string | null
}
type CashierContact = { request_id: number; work_type: WorkType; work_title: string; full_name: string; email: string; applicant_type: 'egyptian' | 'foreign' }
type CashierItem = { item_id: number; payment_id: number; request_id: number; fee_id: number; service_id: number; currency: string; amount_due: number | string; status_id: number }
type CashierItemDisplay = CashierItem & { service_name: string; service_name_en?: string | null; option_code: string }
type CashierCursor = { submitted_by_researcher_at: string; payment_id: number }
type CashierQueueRow = { payment: CashierPayment; contact: CashierContact | undefined; items: CashierItemDisplay[] }

const receiptPageSize = 20
const formatDate = (value: string, lang: Lang = 'ar') => new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ar-EG', { dateStyle: 'medium' }).format(new Date(value))

type Props = {
  isAdmin: boolean
  isCashier: boolean
  statusById: Map<number, RequestStatus>
  onStatusesLoaded?: (statuses: RequestStatus[]) => void
  onServicesLoaded?: (services: { service_id: number; name_ar: string; name_en?: string | null }[]) => void
}

export default function CashierQueueView({ isAdmin, isCashier, statusById, onStatusesLoaded, onServicesLoaded }: Props) {
  const { lang, isEn, t } = useI18n()
  const [notice, setNotice] = useState<LocalizedText | null>(null)
  const [error, setError] = useState<LocalizedText | null>(null)
  const [cashierRows, setCashierRows] = useState<CashierQueueRow[]>([])
  const [cashierLoading, setCashierLoading] = useState(false)
  const [cashierPageIndex, setCashierPageIndex] = useState(0)
  const [cashierCursorStack, setCashierCursorStack] = useState<(CashierCursor | null)[]>([null])
  const [cashierHasMore, setCashierHasMore] = useState(false)
  const [cashierBusyPayment, setCashierBusyPayment] = useState<number | null>(null)
  const [cashierSignedUrls, setCashierSignedUrls] = useState<Record<number, string>>({})
  const [cashierReasons, setCashierReasons] = useState<Record<number, string>>({})
  const [cashierRefreshToken, setCashierRefreshToken] = useState(0)
  const singleFlight = useSingleFlight()
  const cashierPageCursor = cashierCursorStack[cashierPageIndex] ?? null

  useEffect(() => {
    if ((!isAdmin && !isCashier) || !supabase) return
    let alive = true
    setCashierLoading(true)
    setError(null)
    void (async () => {
      try {
        const { data: pageData, error: pageError } = await supabase.schema('crdc').rpc('cashier_payment_receipt_page', {
          p_after_submitted_at: cashierPageCursor?.submitted_by_researcher_at ?? null,
          p_after_payment_id: cashierPageCursor?.payment_id ?? null,
          p_direction: 'next',
        })
        if (pageError) throw pageError
        const fetchedPayments = (pageData ?? []) as CashierPayment[]
        const pagePayments = fetchedPayments.slice(0, receiptPageSize)
        const paymentIds = pagePayments.map((payment) => payment.payment_id)
        const requestIds = [...new Set(pagePayments.map((payment) => payment.request_id))]
        const [itemResult, contactResult, statusResult] = await Promise.all([
          paymentIds.length
            ? supabase.schema('crdc').from('request_items').select('item_id,payment_id,request_id,fee_id,service_id,currency,amount_due,status_id').in('payment_id', paymentIds).order('item_id')
            : Promise.resolve({ data: [], error: null }),
          requestIds.length
            ? supabase.schema('crdc').from('cashier_request_contacts').select('request_id,work_type,work_title,full_name,email,applicant_type').in('request_id', requestIds)
            : Promise.resolve({ data: [], error: null }),
          supabase.schema('crdc').from('request_statuses').select('status_id,code,name_ar,name_en,sort_order').order('sort_order'),
        ])
        if (itemResult.error || contactResult.error || statusResult.error) throw itemResult.error ?? contactResult.error ?? statusResult.error
        const itemRows = (itemResult.data ?? []) as CashierItem[]
        const serviceIds = [...new Set(itemRows.map((item) => item.service_id))]
        const feeIds = [...new Set(itemRows.map((item) => item.fee_id))]
        const [serviceResult, feeResult] = await Promise.all([
          serviceIds.length ? supabase.schema('crdc').from('services').select('service_id,name_ar,name_en').in('service_id', serviceIds) : Promise.resolve({ data: [], error: null }),
          feeIds.length ? supabase.schema('crdc').from('fee_schedule').select('fee_id,option_code').in('fee_id', feeIds) : Promise.resolve({ data: [], error: null }),
        ])
        if (serviceResult.error || feeResult.error) throw serviceResult.error ?? feeResult.error
        if (!alive) return
        const serviceRows = new Map((serviceResult.data ?? []).map((row) => [row.service_id, row]))
        const feeCodes = new Map((feeResult.data ?? []).map((row) => [row.fee_id, row.option_code]))
        const contacts = new Map(((contactResult.data ?? []) as CashierContact[]).map((row) => [row.request_id, row]))
        const itemsByPayment = new Map<number, CashierItemDisplay[]>()
        for (const item of itemRows) {
          const display = { ...item, service_name: serviceRows.get(item.service_id)?.name_ar ?? 'SERVICE_FALLBACK', service_name_en: serviceRows.get(item.service_id)?.name_en ?? null, option_code: feeCodes.get(item.fee_id) ?? '' }
          itemsByPayment.set(item.payment_id, [...(itemsByPayment.get(item.payment_id) ?? []), display])
        }
        setCashierRows(pagePayments.map((payment) => ({
          payment,
          contact: contacts.get(payment.request_id),
          items: itemsByPayment.get(payment.payment_id) ?? [],
        })))
        setCashierHasMore(Boolean(fetchedPayments[0]?.has_more))
        onStatusesLoaded?.((statusResult.data ?? []) as RequestStatus[])
        onServicesLoaded?.((serviceResult.data ?? []) as { service_id: number; name_ar: string; name_en?: string | null }[])
      } catch (queueError) {
        if (alive) setError(friendlyErrorText(queueError))
      } finally {
        if (alive) setCashierLoading(false)
      }
    })()
    return () => { alive = false }
  }, [isAdmin, isCashier, cashierPageIndex, cashierPageCursor, cashierRefreshToken])

  function nextCashierPage() {
    if (!cashierHasMore || !cashierRows.length) return
    const lastPayment = cashierRows[cashierRows.length - 1].payment
    setCashierCursorStack((current) => [
      ...current.slice(0, cashierPageIndex + 1),
      { submitted_by_researcher_at: lastPayment.submitted_by_researcher_at, payment_id: lastPayment.payment_id },
    ])
    setCashierPageIndex((current) => current + 1)
  }

  function previousCashierPage() {
    if (cashierPageIndex > 0) setCashierPageIndex((current) => current - 1)
  }

  async function previewReceipt(payment: CashierPayment) {
    if (!supabase) return
    setError(null)
    const { data, error: signedError } = await supabase.storage.from('payment-receipts')
      .createSignedUrl(payment.receipt_storage_path, 300, { download: true })
    if (signedError) { setError(friendlyErrorText(signedError)); return }
    setCashierSignedUrls((current) => ({ ...current, [payment.payment_id]: data.signedUrl }))
  }

  async function approveReceipt(payment: CashierPayment) {
    if (!supabase) return
    setCashierBusyPayment(payment.payment_id); setError(null); setNotice(null)
    try {
      const { error: approveError } = await supabase.schema('crdc').rpc('approve_payment_receipt', { p_payment_id: payment.payment_id })
      if (approveError) throw approveError
      setNotice({ ar: 'تم اعتماد السداد وتحديث حالات الخدمات.', en: 'Payment approved and service item statuses updated.' })
      setCashierSignedUrls((current) => { const next = { ...current }; delete next[payment.payment_id]; return next })
      setCashierRefreshToken((value) => value + 1)
    } catch (approveError) {
      setError(friendlyErrorText(approveError))
    } finally {
      setCashierBusyPayment(null)
    }
  }

  async function rejectReceipt(payment: CashierPayment, reason: string) {
    if (!supabase) return
    setCashierBusyPayment(payment.payment_id); setError(null); setNotice(null)
    try {
      const { error: rejectError } = await supabase.schema('crdc').rpc('reject_payment_receipt', {
        p_payment_id: payment.payment_id,
        p_reason: reason.trim(),
      })
      if (rejectError) throw rejectError
      setNotice({ ar: 'تم رفض الإيصال وإرسال السبب للباحث.', en: 'Receipt rejected and reason sent to the researcher.' })
      setCashierSignedUrls((current) => { const next = { ...current }; delete next[payment.payment_id]; return next })
      setCashierReasons((current) => ({ ...current, [payment.payment_id]: '' }))
      setCashierRefreshToken((value) => value + 1)
    } catch (rejectError) {
      setError(friendlyErrorText(rejectError))
    } finally {
      setCashierBusyPayment(null)
    }
  }

  return (
          <>
            <div className="portal-heading"><span className="eyebrow">{t('الخزينة', 'Cashier')}</span><h1>{isEn ? 'Review Payment Receipts' : 'مراجعة إيصالات السداد'}</h1><p>راجع المبلغ والإيصال والخدمات المشمولة قبل اعتماد السداد أو طلب إعادة الإرسال.</p></div>
            {notice && <p className="message success" role="status">{notice[lang]}</p>}
            {error && <p className="message error" role="alert">{error[lang]}</p>}
            {cashierLoading ? <div className="portal-card loading"><span className="spinner" /> {t('جارٍ تحميل الإيصالات...', 'Loading receipts...')}</div> : cashierRows.length ? <div className="request-list cashier-receipt-list">
              {cashierRows.map(({ payment, contact, items: coveredItems }) => <article className="portal-card cashier-receipt-card" data-testid="cashier-receipt" data-payment-id={payment.payment_id} key={payment.payment_id}>
                <div className="cashier-receipt-heading"><div><span className="eyebrow">{t('إيصال بانتظار المراجعة', 'Receipt Pending Review')}</span><h2>{contact?.work_title ?? t(`طلب رقم ${payment.request_id}`, `Request #${payment.request_id}`)}</h2></div><span className="status-pill">{t('بانتظار مراجعة الخزينة', 'Pending Treasury Review')}</span></div>
                <dl className="cashier-receipt-facts">
                  <dt>{t('رقم الطلب', 'Request ID')}</dt><dd><span dir="ltr">#{payment.request_id}</span></dd>
                  <dt>{t('الباحث', 'Researcher')}</dt><dd>{contact?.full_name ?? t('بيانات الباحث غير متاحة', 'Researcher details unavailable')} <small dir="ltr">{contact?.email ?? ''}</small></dd>
                  <dt>{t('نوع الباحث', 'Applicant Type')}</dt><dd>{contact?.applicant_type === 'egyptian' ? t('مصري', 'Egyptian') : t('وافد', 'International')}</dd>
                  <dt>{t('رقم الإيصال', 'Receipt No.')}</dt><dd><span dir="ltr">{payment.receipt_no}</span></dd>
                  <dt>{t('تاريخ السداد', 'Payment Date')}</dt><dd>{formatDate(payment.paid_at, lang)}</dd>
                  <dt>{t('قناة السداد', 'Payment Channel')}</dt><dd>{payment.channel === 'treasury' ? t('الخزينة', 'Treasury') : t('البنك', 'Bank')}</dd>
                  <dt>{t('إجمالي المبلغ', 'Total Amount')}</dt><dd><strong><span dir="ltr">{Number(payment.amount).toLocaleString(isEn ? 'en-US' : 'ar-EG', { maximumFractionDigits: 2 })} {payment.currency}</span></strong></dd>
                  <dt>{t('وصل للمراجعة', 'Submitted At')}</dt><dd><time dateTime={payment.submitted_by_researcher_at}>{formatDate(payment.submitted_by_researcher_at, lang)}</time></dd>
                </dl>
                <section className="cashier-covered-items"><h3>{t('الخدمات المشمولة', 'Covered Services')}</h3>{coveredItems.length ? <ul>{coveredItems.map((item) => <li key={item.item_id}>
                  <span>{item.service_name === 'SERVICE_FALLBACK' ? t('خدمة', 'Service') : pickName({ name_ar: item.service_name, name_en: item.service_name_en }, lang)}{item.option_code ? ` · ${item.option_code}` : ''}</span><span className="cashier-item-meta">{(() => { const s = statusById.get(item.status_id); return s ? pickName(s, lang) : t('غير محدد', 'Unspecified') })()} · <span dir="ltr">{Number(item.amount_due).toLocaleString(isEn ? 'en-US' : 'ar-EG', { maximumFractionDigits: 2 })} {item.currency}</span></span>
                </li>)}</ul> : <p className="empty-state">{t('لا توجد بنود مرتبطة بإذن الدفع.', 'No items linked to this payment order.')}</p>}</section>
                <div className="cashier-receipt-actions">
                  <button className="quiet-button" disabled={cashierBusyPayment !== null} onClick={() => void singleFlight(() => previewReceipt(payment))}>{t('إنشاء رابط معاينة آمن', 'Generate Secure Preview Link')}</button>
                  {cashierSignedUrls[payment.payment_id] && <a className="quiet-button" href={cashierSignedUrls[payment.payment_id]} target="_blank" rel="noreferrer">{t('معاينة الإيصال', 'Preview Receipt')}</a>}
                  <button className="primary-button" disabled={cashierBusyPayment !== null || !coveredItems.length} onClick={() => void singleFlight(() => approveReceipt(payment))}>{cashierBusyPayment === payment.payment_id ? t('جارٍ الحفظ...', 'Saving...') : t('اعتماد السداد', 'Approve Payment')}</button>
                </div>
                <form className="cashier-rejection-form" onSubmit={(event) => { event.preventDefault(); const reason = cashierReasons[payment.payment_id] ?? ''; void singleFlight(() => rejectReceipt(payment, reason)) }}>
                  <label>{t('سبب الرفض', 'Rejection Reason')}<textarea required minLength={3} maxLength={500} value={cashierReasons[payment.payment_id] ?? ''} onChange={(event) => setCashierReasons((current) => ({ ...current, [payment.payment_id]: event.target.value }))} placeholder={t('اكتب سببًا واضحًا للباحث', 'Write a clear reason for the researcher')} /></label>
                  <button className="quiet-button" type="submit" disabled={cashierBusyPayment !== null}>{isEn ? 'Reject Receipt & Notify Researcher' : 'رفض الإيصال وإبلاغ الباحث'}</button>
                </form>
              </article>)}
            </div> : <div className="portal-card empty-requests"><h2>{t('لا توجد إيصالات بانتظار المراجعة', 'No Receipts Pending Review')}</h2><p>{t('ستظهر هنا الإيصالات الجديدة مع تفاصيل المبلغ والخدمات.', 'Any newly uploaded receipts will appear here with amount and service details.')}</p></div>}
            {!cashierLoading && cashierRows.length > 0 && <nav className="queue-pagination" aria-label={t('التنقل بين إيصالات السداد', 'Payment receipts pagination')}>
              <button className="quiet-button" disabled={cashierPageIndex === 0} onClick={previousCashierPage}>{t('السابق', 'Previous')}</button>
              <span>{t('صفحة ', 'Page ')}{(cashierPageIndex + 1).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
              <button className="quiet-button" disabled={!cashierHasMore} onClick={nextCashierPage}>{t('التالي', 'Next')}</button>
            </nav>}
          </>
  )
}
