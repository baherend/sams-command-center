import { useCallback, useRef } from 'react'

/** An error whose message is already a safe, user-facing Arabic sentence. */
export class UiError extends Error {}

type ErrorLike = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; constraint?: unknown; status?: unknown; name?: unknown }

const IDENTITY_MESSAGE = 'مش قادرين نحفظ البيانات دي. راجع البيانات المدخلة، ولو متأكد إنها صحيحة تواصل مع إدارة المركز.'

// Known RPC / trigger messages (raised by our own SQL) -> Arabic. Matched on a substring.
const MESSAGE_MAP: [string, string][] = [
  ['Receipt reference is already in use', 'رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.'],
  ['Payment order does not belong to this researcher', 'إذن الدفع ده مش تابع لطلبك. حدّث الصفحة وجرب تاني.'],
  ['This payment order is not awaiting a receipt', 'الإيصال الخاص بإذن الدفع ده مش متاح للإرسال دلوقتي. حدّث الصفحة.'],
  ['This receipt is not awaiting verification', 'الإيصال اتراجع بالفعل أو مش موجود في قائمة المراجعة. حدّث الصفحة.'],
  ['Payment order items are not all awaiting payment or the amount does not match', 'بنود إذن الدفع أو المبلغ اتغيرت. حدّث الصفحة وراجع الإجمالي.'],
  ['Payment order items or amount changed before verification', 'بيانات إذن الدفع اتغيرت قبل الاعتماد. حدّث القائمة وراجعها.'],
  ['Verified payment and receipt values are immutable', 'تم اعتماد السداد، وبيانات الإيصال غير قابلة للتعديل.'],
  ['Receipt file is no longer available', 'ملف الإيصال مش متاح دلوقتي. ارفض الطلب واطلب من الباحث إعادة رفعه.'],
  ['Receipt file is missing or has an unsupported type or size', 'ملف الإيصال غير صالح. ارفع PDF أو JPG أو PNG بحجم ٥ ميجابايت أو أقل.'],
  ['A receipt must be approved before recording PAID', 'اعتمد إيصال السداد الأول قبل تغيير الحالة إلى تم السداد.'],
  ['A payment date is required', 'اختار تاريخ السداد.'],
  ['Payment date is required and cannot be in the future', 'اختار تاريخ سداد صحيحًا، ولا تختار تاريخًا مستقبليًا.'],
  ['Cashier or admin role required', 'العملية دي متاحة لأمين الخزينة أو مدير النظام فقط.'],
  ['Only the researcher who owns this request may submit its receipt', 'صاحب الطلب فقط يقدر يرسل إيصال السداد.'],
  ['Researcher profile required', 'كمّل ملف الباحث الأول علشان تقدر ترسل الإيصال.'],
  ['A rejection reason between 3 and 500 characters is required', 'اكتب سبب رفض واضحًا من ٣ إلى ٥٠٠ حرف.'],
  ['Unknown payment channel', 'اختار قناة السداد من القائمة.'],
  ['Receipt reference is required and must be at most 100 characters', 'اكتب رقم الإيصال في حدود ١٠٠ حرف.'],
  ['Receipt file path is not valid for this payment order', 'ملف الإيصال مش مربوط بإذن الدفع ده. ارفع الملف مرة تانية.'],
  ['Payment amount must equal the selected service items total', 'إجمالي المبلغ لازم يساوي مجموع الخدمات المختارة. راجع المبلغ وحاول تاني.'],
  ['Payment and service items must have the same request and currency', 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.'],
  ['A service item is already linked to another payment', 'في خدمة مرتبطة بإذن دفع تاني بالفعل. راجع الطلب قبل المحاولة.'],
  ['Payment is linked to service items; its recorded values are locked', 'بيانات إذن الدفع اتسجلت على خدمات ومبقاش ينفع تغييرها.'],
  ['Page count must be between 1 and 2000', 'عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.'],
  ['Work title must be between 3 and 300 characters', 'عنوان العمل لازم يكون من ٣ إلى ٣٠٠ حرف.'],
  ['request_status_history_note_length', 'الملاحظة لازم تكون ٥٠٠ حرف أو أقل.'],
  ['service_requests_page_count_range', 'عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.'],
  ['service_requests_work_title_length', 'عنوان العمل لازم يكون من ٣ إلى ٣٠٠ حرف.'],
  ['ri_pay_fk', 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.'],
  ['payments_receipt_no_key', 'رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.'],
  ['payments_payment_order_no_key', 'رقم إذن الدفع مستخدم قبل كده. راجعه وجرب رقم تاني.'],
  ['Payment amount must equal', 'إجمالي المبلغ لازم يساوي مجموع الخدمات المختارة. راجع المبلغ وحاول تاني.'],
  ['Payment and service items', 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.'],
  ['A service item is already linked', 'في خدمة مرتبطة بإذن دفع تاني بالفعل. راجع الطلب قبل المحاولة.'],
  ['recorded values are locked', 'بيانات إذن الدفع اتسجلت على خدمات ومبقاش ينفع تغييرها.'],
  ['duplicate key value violates unique constraint "payments_receipt_no_key"', 'رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.'],
  ['duplicate key value violates unique constraint "payments_payment_order_no_key"', 'رقم إذن الدفع مستخدم قبل كده. راجعه وجرب رقم تاني.'],
  ['Staff cannot be assigned to their own researcher request', 'مينفعش تعيين موظف على طلب هو صاحبه كباحث.'],
  ['Staff cannot change the status of their own researcher request', 'مينفعش موظف يغيّر حالة طلب هو صاحبه كباحث.'],
  ['Staff cannot decide on their own researcher request', 'مينفعش موظف يقرر في طلب نشر هو صاحبه كباحث.'],
  ['Staff cannot create a publication submission for their own researcher request', 'مينفعش موظف ينشئ بيانات نشر لطلب هو صاحبه كباحث.'],
  ['Publication services require a separate paper request', 'خدمة النشر بتتقدم في طلب بحث منفصل عن الرسالة.'],
  ['Page count is required', 'اكتب عدد الصفحات علشان نكمل الطلب.'],
  ['Select at least one service', 'اختار خدمة واحدة على الأقل.'],
  ['Fee option is unavailable', 'الخدمة دي مش متاحة لنوع حسابك حاليًا. حدّث الصفحة وجرب تاني.'],
  ['profile before submitting', 'كمّل ملف الباحث الأول علشان تقدر تقدم طلب.'],
  ['own researcher request', 'مينفعش تتعامل مع طلب إنت صاحبه كباحث. اطلب من موظف تاني ينفذ الإجراء.'],
  ['Status transition is not allowed', 'الانتقال ده مش متاح من الحالة الحالية للبند. حدّث الصفحة وراجع الحالة.'],
  ['not assigned to this staff member', 'البند ده مش مسند لحسابك.'],
  ['Cashiers can only record payment statuses', 'حسابك يسجّل حالات السداد فقط.'],
  ['This role cannot set that status', 'حسابك مش مصرّح له بالحالة دي.'],
  ['Staff role is not permitted', 'حسابك مش مصرّح له يغيّر حالة البنود.'],
  ['Link the payment order', 'اربط إذن الدفع بالخدمة الأول.'],
  ['Link the paid receipt', 'اربط إيصال السداد بالخدمة الأول.'],
  ['Issue does not belong to this journal', 'العدد المختار مش تابع للمجلة دي.'],
  ['Publication submission not found', 'بيانات النشر لهذا البند غير موجودة.'],
  ['Journal not found', 'المجلة المختارة غير موجودة.'],
]

const IDENTITY_CONSTRAINTS = [
  'researchers_national_id_key',
  'researchers_passport_nationality_key',
  'researchers_national_id_format',
]
const IDENTITY_MESSAGE_MAP: [string, string][] = [
  ['researchers_national_id_key', IDENTITY_MESSAGE],
  ['researchers_passport_nationality_key', IDENTITY_MESSAGE],
  ['researchers_national_id_format', IDENTITY_MESSAGE],
]

// Postgres SQLSTATE / PostgREST codes -> Arabic.
const CODE_MAP: Record<string, string> = {
  '23502': 'في بيانات مطلوبة ناقصة. كمّلها وجرب تاني.',
  '23503': 'في بيانات مرتبطة مش موجودة. حدّث الصفحة وجرب تاني.',
  '22P02': 'في قيمة مش بالصيغة المطلوبة. راجع البيانات وجرب تاني.',
  '22001': 'في قيمة أطول من المسموح. اختصرها وجرب تاني.',
  '42501': 'مش مصرّح لك تنفذ العملية دي.',
  '28000': 'سجّل دخولك الأول وجرب تاني.',
  'P0002': 'العنصر المطلوب مش موجود. حدّث الصفحة وجرب تاني.',
  '40001': 'العملية اتعارضت مع عملية تانية. جرّب تاني.',
  '40P01': 'العملية اتعارضت مع عملية تانية. جرّب تاني.',
  '55P03': 'العنصر مشغول بعملية تانية. جرّب بعد لحظات.',
  PGRST301: 'الجلسة انتهت. سجّل دخولك تاني.',
  PGRST303: 'الجلسة انتهت. سجّل دخولك تاني.',
  PGRST116: 'العنصر المطلوب مش موجود. حدّث الصفحة وجرب تاني.',
  invalid_credentials: 'الإيميل أو كلمة المرور غير صحيحة.',
  email_not_confirmed: 'لازم تأكد إيميلك الأول من رسالة التأكيد.',
  user_already_exists: 'مش قادرين ننشئ الحساب بالبيانات دي. لو عندك حساب جرّب تسجّل دخول.',
  weak_password: 'كلمة المرور ضعيفة. استخدم ٨ أحرف على الأقل.',
  over_request_rate_limit: 'محاولات كتير في وقت قصير. استنى شوية وجرب تاني.',
  over_email_send_rate_limit: 'محاولات كتير في وقت قصير. استنى شوية وجرب تاني.',
}

const INVALID_DATA = 'البيانات دي مش مقبولة، راجعها وجرب تاني.'
const GENERIC = 'حصلت مشكلة. جرّب تاني، ولو استمرت تواصل مع إدارة المركز.'
const NETWORK = 'مش قادرين نتصل بالخدمة. راجع الإنترنت وجرب تاني.'

/**
 * Turns any thrown value into a short Arabic message that is safe to show.
 * Raw database messages, constraint names and SQLSTATE codes are never shown to the user.
 */
export function friendlyError(error: unknown, codeOverrides: Record<string, string> = {}): string {
  if (error instanceof UiError) return error.message
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike
  const message = typeof e.message === 'string' ? e.message : ''
  const code = typeof e.code === 'string' ? e.code : ''
  const diagnostic = [message, String(e.details ?? ''), String(e.hint ?? ''), String(e.constraint ?? '')].join(' ')

  const identityConstraint = IDENTITY_CONSTRAINTS.find((constraint) => diagnostic.includes(constraint))
  if (identityConstraint) return IDENTITY_MESSAGE_MAP.find(([constraint]) => constraint === identityConstraint)![1]

  const byMessage = MESSAGE_MAP.find(([needle]) => diagnostic.includes(needle))
  if (byMessage) return byMessage[1]
  if (code === '23505' || code === '23514') return INVALID_DATA
  if (code && codeOverrides[code]) return codeOverrides[code]
  if (code && CODE_MAP[code]) return CODE_MAP[code]
  if (/row-level security|permission denied/i.test(message)) return CODE_MAP['42501']
  if (/failed to fetch|fetch failed|networkerror|AuthRetryableFetchError/i.test(`${message} ${String(e.name ?? '')}`)) return NETWORK
  console.error('[crdc] unmapped error', error)
  return GENERIC
}

/**
 * Single-flight guard. State-based `disabled` only takes effect after a re-render, so a fast
 * double click can still fire twice; this ref flips synchronously and drops the second call.
 */
export function useSingleFlight() {
  const flying = useRef(false)
  return useCallback(async (task: () => Promise<void>) => {
    if (flying.current) return
    flying.current = true
    try { await task() } finally { flying.current = false }
  }, [])
}
