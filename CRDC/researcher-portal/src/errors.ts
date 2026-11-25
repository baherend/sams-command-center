import { useCallback, useRef } from 'react'

export type LocalizedText = { ar: string; en: string }

export class UiError extends Error {
  readonly ar: string
  readonly en: string

  constructor(messageOrPair: string | LocalizedText, enMessage?: string) {
    const ar = typeof messageOrPair === 'string' ? messageOrPair : messageOrPair.ar
    const en = typeof messageOrPair === 'string' ? (enMessage ?? messageOrPair) : messageOrPair.en
    super(ar)
    this.ar = ar
    this.en = en
  }

  localize(lang: 'ar' | 'en'): string {
    return lang === 'en' ? this.en : this.ar
  }
}

type ErrorLike = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; constraint?: unknown; status?: unknown; name?: unknown }

const IDENTITY_MESSAGE: LocalizedText = {
  ar: 'مش قادرين نحفظ البيانات دي. راجع البيانات المدخلة، ولو متأكد إنها صحيحة تواصل مع إدارة المركز.',
  en: 'Unable to save these details. Please review your input, or contact center administration if you are sure they are correct.',
}
const MESSAGE_MAP: [string, LocalizedText][] = [
  ['Receipt reference is already in use', { ar: 'رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.', en: 'This receipt number is already in use. Please verify and try another.' }],
  ['Payment order does not belong to this researcher', { ar: 'إذن الدفع ده مش تابع لطلبك. حدّث الصفحة وجرب تاني.', en: 'This payment order does not belong to your request. Refresh and try again.' }],
  ['This payment order is not awaiting a receipt', { ar: 'الإيصال الخاص بإذن الدفع ده مش متاح للإرسال دلوقتي. حدّث الصفحة.', en: 'This payment order is not currently awaiting a receipt. Please refresh the page.' }],
  ['This receipt is not awaiting verification', { ar: 'الإيصال اتراجع بالفعل أو مش موجود في قائمة المراجعة. حدّث الصفحة.', en: 'This receipt has already been reviewed or is no longer in the queue. Please refresh.' }],
  ['Payment order items are not all awaiting payment or the amount does not match', { ar: 'بنود إذن الدفع أو المبلغ اتغيرت. حدّث الصفحة وراجع الإجمالي.', en: 'Payment order items or amount have changed. Refresh the page and review the total.' }],
  ['Payment order items or amount changed before verification', { ar: 'بيانات إذن الدفع اتغيرت قبل الاعتماد. حدّث القائمة وراجعها.', en: 'Payment order details changed before verification. Refresh the list and review.' }],
  ['Verified payment and receipt values are immutable', { ar: 'تم اعتماد السداد، وبيانات الإيصال غير قابلة للتعديل.', en: 'Payment has been verified; receipt details can no longer be modified.' }],
  ['Receipt file is no longer available', { ar: 'ملف الإيصال مش متاح دلوقتي. ارفض الطلب واطلب من الباحث إعادة رفعه.', en: 'Receipt file is no longer available. Reject the receipt and ask the researcher to re-upload it.' }],
  ['Receipt file is missing or has an unsupported type or size', { ar: 'ملف الإيصال غير صالح. ارفع PDF أو JPG أو PNG بحجم ٥ ميجابايت أو أقل.', en: 'Invalid receipt file. Upload a PDF, JPG, or PNG file of 5 MB or less.' }],
  ['A receipt must be approved before recording PAID', { ar: 'اعتمد إيصال السداد الأول قبل تغيير الحالة إلى تم السداد.', en: 'Approve the payment receipt first before marking the status as PAID.' }],
  ['A payment date is required', { ar: 'اختار تاريخ السداد.', en: 'Please select the payment date.' }],
  ['Payment date is required and cannot be in the future', { ar: 'اختار تاريخ سداد صحيحًا، ولا تختار تاريخًا مستقبليًا.', en: 'Please select a valid payment date that is not in the future.' }],
  ['Cashier or admin role required', { ar: 'العملية دي متاحة لأمين الخزينة أو مدير النظام فقط.', en: 'This action is restricted to a cashier or system administrator.' }],
  ['Only the researcher who owns this request may submit its receipt', { ar: 'صاحب الطلب فقط يقدر يرسل إيصال السداد.', en: 'Only the researcher who owns this request may submit its payment receipt.' }],
  ['Researcher profile required', { ar: 'كمّل ملف الباحث الأول علشان تقدر ترسل الإيصال.', en: 'Complete your researcher profile first before submitting a receipt.' }],
  ['A rejection reason between 3 and 500 characters is required', { ar: 'اكتب سبب رفض واضحًا من ٣ إلى ٥٠٠ حرف.', en: 'Enter a clear rejection reason between 3 and 500 characters.' }],
  ['Unknown payment channel', { ar: 'اختار قناة السداد من القائمة.', en: 'Select a valid payment channel from the list.' }],
  ['Receipt reference is required and must be at most 100 characters', { ar: 'اكتب رقم الإيصال في حدود ١٠٠ حرف.', en: 'Receipt number is required and must be at most 100 characters.' }],
  ['Receipt file path is not valid for this payment order', { ar: 'ملف الإيصال مش مربوط بإذن الدفع ده. ارفع الملف مرة تانية.', en: 'Receipt file is not linked to this payment order. Please upload the file again.' }],
  ['Payment amount must equal the selected service items total', { ar: 'إجمالي المبلغ لازم يساوي مجموع الخدمات المختارة. راجع المبلغ وحاول تاني.', en: 'Total amount must equal the sum of selected service items. Review and try again.' }],
  ['Payment and service items must have the same request and currency', { ar: 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.', en: 'Payment order and service items must belong to the same request and currency.' }],
  ['A service item is already linked to another payment', { ar: 'في خدمة مرتبطة بإذن دفع تاني بالفعل. راجع الطلب قبل المحاولة.', en: 'A service item is already linked to another payment order. Review the request first.' }],
  ['Payment is linked to service items; its recorded values are locked', { ar: 'بيانات إذن الدفع اتسجلت على خدمات ومبقاش ينفع تغييرها.', en: 'Payment order is linked to service items and its recorded values are locked.' }],
  ['Page count must be between 1 and 2000', { ar: 'عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.', en: 'Page count must be between 1 and 2000.' }],
  ['Work title must be between 3 and 300 characters', { ar: 'عنوان العمل لازم يكون من ٣ إلى ٣٠٠ حرف.', en: 'Work title must be between 3 and 300 characters.' }],
  ['request_status_history_note_length', { ar: 'الملاحظة لازم تكون ٥٠٠ حرف أو أقل.', en: 'Note must be 500 characters or fewer.' }],
  ['service_requests_page_count_range', { ar: 'عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.', en: 'Page count must be between 1 and 2000.' }],
  ['service_requests_work_title_length', { ar: 'عنوان العمل لازم يكون من ٣ إلى ٣٠٠ حرف.', en: 'Work title must be between 3 and 300 characters.' }],
  ['ri_pay_fk', { ar: 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.', en: 'Payment order and service items must belong to the same request and currency.' }],
  ['payments_receipt_no_key', { ar: 'رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.', en: 'This receipt number is already in use. Please verify and try another.' }],
  ['payments_payment_order_no_key', { ar: 'رقم إذن الدفع مستخدم قبل كده. راجعه وجرب رقم تاني.', en: 'This payment order number is already in use. Please verify and try another.' }],
  ['Payment amount must equal', { ar: 'إجمالي المبلغ لازم يساوي مجموع الخدمات المختارة. راجع المبلغ وحاول تاني.', en: 'Total amount must equal the sum of selected service items. Review and try again.' }],
  ['Payment and service items', { ar: 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.', en: 'Payment order and service items must belong to the same request and currency.' }],
  ['A service item is already linked', { ar: 'في خدمة مرتبطة بإذن دفع تاني بالفعل. راجع الطلب قبل المحاولة.', en: 'A service item is already linked to another payment order. Review the request first.' }],
  ['recorded values are locked', { ar: 'بيانات إذن الدفع اتسجلت على خدمات ومبقاش ينفع تغييرها.', en: 'Payment order is linked to service items and its recorded values are locked.' }],
  ['duplicate key value violates unique constraint "payments_receipt_no_key"', { ar: 'رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.', en: 'This receipt number is already in use. Please verify and try another.' }],
  ['duplicate key value violates unique constraint "payments_payment_order_no_key"', { ar: 'رقم إذن الدفع مستخدم قبل كده. راجعه وجرب رقم تاني.', en: 'This payment order number is already in use. Please verify and try another.' }],
  ['Staff cannot be assigned to their own researcher request', { ar: 'مينفعش تعيين موظف على طلب هو صاحبه كباحث.', en: 'A staff member cannot be assigned to their own researcher request.' }],
  ['Staff cannot change the status of their own researcher request', { ar: 'مينفعش موظف يغيّر حالة طلب هو صاحبه كباحث.', en: 'A staff member cannot change the status of their own researcher request.' }],
  ['Staff cannot decide on their own researcher request', { ar: 'مينفعش موظف يقرر في طلب نشر هو صاحبه كباحث.', en: 'A staff member cannot submit a publication decision on their own researcher request.' }],
  ['Staff cannot create a publication submission for their own researcher request', { ar: 'مينفعش موظف ينشئ بيانات نشر لطلب هو صاحبه كباحث.', en: 'A staff member cannot create a publication submission for their own researcher request.' }],
  ['Publication services require a separate paper request', { ar: 'خدمة النشر بتتقدم في طلب بحث منفصل عن الرسالة.', en: 'Publication services require a separate research paper request rather than a thesis.' }],
  ['Page count is required', { ar: 'اكتب عدد الصفحات علشان نكمل الطلب.', en: 'Page count is required to complete this request.' }],
  ['Select at least one service', { ar: 'اختار خدمة واحدة على الأقل.', en: 'Please select at least one service.' }],
  ['Fee option is unavailable', { ar: 'الخدمة دي مش متاحة لنوع حسابك حاليًا. حدّث الصفحة وجرب تاني.', en: 'This service option is currently unavailable for your applicant type. Refresh and try again.' }],
  ['profile before submitting', { ar: 'كمّل ملف الباحث الأول علشان تقدر تقدم طلب.', en: 'Complete your researcher profile before submitting a request.' }],
  ['own researcher request', { ar: 'مينفعش تتعامل مع طلب إنت صاحبه كباحث. اطلب من موظف تاني ينفذ الإجراء.', en: 'You cannot process a request you submitted as a researcher. Ask another staff member to handle it.' }],
  ['Status transition is not allowed', { ar: 'الانتقال ده مش متاح من الحالة الحالية للبند. حدّث الصفحة وراجع الحالة.', en: 'This status transition is not allowed from the current item status. Refresh and verify.' }],
  ['not assigned to this staff member', { ar: 'البند ده مش مسند لحسابك.', en: 'This item is not assigned to your account.' }],
  ['Cashiers can only record payment statuses', { ar: 'حسابك يسجّل حالات السداد فقط.', en: 'Your role can only record payment statuses.' }],
  ['This role cannot set that status', { ar: 'حسابك مش مصرّح له بالحالة دي.', en: 'Your role is not authorized to set this status.' }],
  ['Staff role is not permitted', { ar: 'حسابك مش مصرّح له يغيّر حالة البنود.', en: 'Your staff role is not permitted to change item statuses.' }],
  ['Link the payment order', { ar: 'اربط إذن الدفع بالخدمة الأول.', en: 'Link the payment order to the service item first.' }],
  ['Link the paid receipt', { ar: 'اربط إيصال السداد بالخدمة الأول.', en: 'Link the paid receipt to the service item first.' }],
  ['Issue does not belong to this journal', { ar: 'العدد المختار مش تابع للمجلة دي.', en: 'The selected issue does not belong to this journal.' }],
  ['Publication submission not found', { ar: 'بيانات النشر لهذا البند غير موجودة.', en: 'Publication submission record for this item was not found.' }],
  ['Journal not found', { ar: 'المجلة المختارة غير موجودة.', en: 'The selected journal was not found.' }],
]
const IDENTITY_CONSTRAINTS = [
  'researchers_national_id_key',
  'researchers_passport_nationality_key',
  'researchers_national_id_format',
]
const IDENTITY_MESSAGE_MAP: [string, LocalizedText][] = [
  ['researchers_national_id_key', IDENTITY_MESSAGE],
  ['researchers_passport_nationality_key', IDENTITY_MESSAGE],
  ['researchers_national_id_format', IDENTITY_MESSAGE],
]

const CODE_MAP: Record<string, LocalizedText> = {
  '23502': { ar: 'في بيانات مطلوبة ناقصة. كمّلها وجرب تاني.', en: 'Required fields are missing. Please complete them and try again.' },
  '23503': { ar: 'في بيانات مرتبطة مش موجودة. حدّث الصفحة وجرب تاني.', en: 'Related reference data was not found. Refresh the page and try again.' },
  '22P02': { ar: 'في قيمة مش بالصيغة المطلوبة. راجع البيانات وجرب تاني.', en: 'Invalid input format. Please check your entries and try again.' },
  '22001': { ar: 'في قيمة أطول من المسموح. اختصرها وجرب تاني.', en: 'One of the values exceeds the maximum allowed length.' },
  '42501': { ar: 'مش مصرّح لك تنفذ العملية دي.', en: 'You are not authorized to perform this action.' },
  '28000': { ar: 'سجّل دخولك الأول وجرب تاني.', en: 'Please sign in first and try again.' },
  P0002: { ar: 'العنصر المطلوب مش موجود. حدّث الصفحة وجرب تاني.', en: 'The requested record was not found. Refresh and try again.' },
  '40001': { ar: 'العملية اتعارضت مع عملية تانية. جرّب تاني.', en: 'A concurrent update conflict occurred. Please try again.' },
  '40P01': { ar: 'العملية اتعارضت مع عملية تانية. جرّب تاني.', en: 'A database deadlock occurred. Please try again.' },
  '55P03': { ar: 'العنصر مشغول بعملية تانية. جرّب بعد لحظات.', en: 'This record is temporarily locked by another operation. Try again shortly.' },
  PGRST301: { ar: 'الجلسة انتهت. سجّل دخولك تاني.', en: 'Your session has expired. Please sign in again.' },
  PGRST303: { ar: 'الجلسة انتهت. سجّل دخولك تاني.', en: 'Your session has expired. Please sign in again.' },
  PGRST116: { ar: 'العنصر المطلوب مش موجود. حدّث الصفحة وجرب تاني.', en: 'The requested record was not found. Refresh and try again.' },
  invalid_credentials: { ar: 'الإيميل أو كلمة المرور غير صحيحة.', en: 'Invalid email address or password.' },
  email_not_confirmed: { ar: 'لازم تأكد إيميلك الأول من رسالة التأكيد.', en: 'Please confirm your email address using the link sent to your inbox.' },
  user_already_exists: { ar: 'مش قادرين ننشئ الحساب بالبيانات دي. لو عندك حساب جرّب تسجّل دخول.', en: 'Unable to create an account with these details. If you already have an account, try signing in.' },
  weak_password: { ar: 'كلمة المرور ضعيفة. استخدم ٨ أحرف على الأقل.', en: 'Password is too weak. Use at least 8 characters.' },
  over_request_rate_limit: { ar: 'محاولات كتير في وقت قصير. استنى شوية وجرب تاني.', en: 'Too many requests in a short time. Please wait a moment and try again.' },
  over_email_send_rate_limit: { ar: 'محاولات كتير في وقت قصير. استنى شوية وجرب تاني.', en: 'Too many email requests in a short time. Please wait a moment and try again.' },
}

const INVALID_DATA: LocalizedText = { ar: 'البيانات دي مش مقبولة، راجعها وجرب تاني.', en: 'These details are not valid. Please review and try again.' }
const GENERIC: LocalizedText = { ar: 'حصلت مشكلة. جرّب تاني، ولو استمرت تواصل مع إدارة المركز.', en: 'Something went wrong. Please try again, or contact center administration if it persists.' }
const NETWORK: LocalizedText = { ar: 'مش قادرين نتصل بالخدمة. راجع الإنترنت وجرب تاني.', en: 'Unable to reach the service. Check your internet connection and try again.' }

const currentLang = (lang?: 'ar' | 'en'): 'ar' | 'en' =>
  lang ?? (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'ar')

export function friendlyErrorText(error: unknown, codeOverrides: Record<string, LocalizedText | string> = {}): LocalizedText {
  if (error instanceof UiError) return { ar: error.ar, en: error.en }
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike
  const message = typeof e.message === 'string' ? e.message : ''
  const code = typeof e.code === 'string' ? e.code : ''
  const diagnostic = [message, String(e.details ?? ''), String(e.hint ?? ''), String(e.constraint ?? '')].join(' ')

  const identityConstraint = IDENTITY_CONSTRAINTS.find((constraint) => diagnostic.includes(constraint))
  if (identityConstraint) return IDENTITY_MESSAGE_MAP.find(([constraint]) => constraint === identityConstraint)![1]

  const byMessage = MESSAGE_MAP.find(([needle]) => diagnostic.includes(needle))
  if (byMessage) return byMessage[1]
  if (code === '23505' || code === '23514') return INVALID_DATA
  if (code && codeOverrides[code]) {
    const ov = codeOverrides[code]
    return typeof ov === 'string' ? { ar: ov, en: ov } : ov
  }
  if (code && CODE_MAP[code]) return CODE_MAP[code]
  if (/row-level security|permission denied/i.test(message)) return CODE_MAP['42501']
  if (/failed to fetch|fetch failed|networkerror|AuthRetryableFetchError/i.test(`${message} ${String(e.name ?? '')}`)) return NETWORK
  console.error('[crdc] unmapped error', error)
  return GENERIC
}

export function friendlyError(error: unknown, codeOverrides: Record<string, LocalizedText | string> = {}, lang?: 'ar' | 'en'): string {
  return friendlyErrorText(error, codeOverrides)[currentLang(lang)]
}

export function useSingleFlight() {
  const flying = useRef(false)
  return useCallback(async (task: () => Promise<void>) => {
    if (flying.current) return
    flying.current = true
    try { await task() } finally { flying.current = false }
  }, [])
}
