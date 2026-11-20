import { useCallback, useRef } from 'react'

/** An error whose message is already a safe, user-facing Arabic sentence. */
export class UiError extends Error {}

type ErrorLike = { code?: unknown; message?: unknown; status?: unknown; name?: unknown }

const IDENTITY_MESSAGE = 'مش قادرين نحفظ البيانات دي. راجع البيانات المدخلة، ولو متأكد إنها صحيحة تواصل مع إدارة المركز.'

// Known RPC / trigger messages (raised by our own SQL) -> Arabic. Matched on a substring.
const MESSAGE_MAP: [string, string][] = [
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
  ['Staff cannot be assigned', 'مينفعش تعيين موظف على طلب هو صاحبه كباحث.'],
]

// Postgres SQLSTATE / PostgREST codes -> Arabic.
const CODE_MAP: Record<string, string> = {
  '23505': IDENTITY_MESSAGE,
  '23514': IDENTITY_MESSAGE,
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

  const byMessage = MESSAGE_MAP.find(([needle]) => message.includes(needle))
  if (byMessage) return byMessage[1]
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
