import { expect, test } from '@playwright/test'
import { friendlyError } from '../src/errors'

const invalidData = 'البيانات دي مش مقبولة، راجعها وجرب تاني.'

test('friendlyError maps specific authorization messages before broad matches', () => {
  expect(friendlyError({ code: '42501', message: 'Staff cannot be assigned to their own researcher request' }))
    .toBe('مينفعش تعيين موظف على طلب هو صاحبه كباحث.')
  expect(friendlyError({ code: '42501', message: 'Staff cannot change the status of their own researcher request' }))
    .toBe('مينفعش موظف يغيّر حالة طلب هو صاحبه كباحث.')
})

test('friendlyError shows the identity message only for identity constraints', () => {
  const identityMessage = 'مش قادرين نحفظ البيانات دي. راجع البيانات المدخلة، ولو متأكد إنها صحيحة تواصل مع إدارة المركز.'
  for (const constraint of ['researchers_national_id_key', 'researchers_passport_nationality_key', 'researchers_national_id_format']) {
    expect(friendlyError({ code: '23514', message: 'database rejected input', details: `constraint ${constraint}` })).toBe(identityMessage)
  }
  expect(friendlyError({ code: '23505', message: 'duplicate key', constraint: 'some_other_unique_key' })).toBe(invalidData)
  expect(friendlyError({ code: '23514', message: 'some other check constraint failed' })).toBe(invalidData)
})

test('friendlyError maps payment integrity errors to safe Arabic messages', () => {
  const scenarios: [string, string][] = [
    ['Payment amount must equal the selected service items total', 'إجمالي المبلغ لازم يساوي مجموع الخدمات المختارة. راجع المبلغ وحاول تاني.'],
    ['Payment and service items must have the same request and currency', 'إذن الدفع والخدمات لازم يكونوا لنفس الطلب وبنفس العملة.'],
    ['A service item is already linked to another payment', 'في خدمة مرتبطة بإذن دفع تاني بالفعل. راجع الطلب قبل المحاولة.'],
    ['Payment is linked to service items; its recorded values are locked', 'بيانات إذن الدفع اتسجلت على خدمات ومبقاش ينفع تغييرها.'],
  ]
  for (const [message, expected] of scenarios) expect(friendlyError({ code: '23514', message })).toBe(expected)
  expect(friendlyError({ code: '23505', message: 'duplicate', details: 'payments_receipt_no_key' }))
    .toBe('رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.')
  expect(friendlyError({ code: '23505', message: 'duplicate', constraint: 'payments_payment_order_no_key' }))
    .toBe('رقم إذن الدفع مستخدم قبل كده. راجعه وجرب رقم تاني.')
  expect(friendlyError({ code: '23505', message: 'Receipt reference is already in use' }))
    .toBe('رقم الإيصال مستخدم قبل كده. راجعه وجرب رقم تاني.')
  expect(friendlyError({ code: '23514', message: 'This receipt is not awaiting verification' }))
    .toBe('الإيصال اتراجع بالفعل أو مش موجود في قائمة المراجعة. حدّث الصفحة.')
})

test('friendlyError maps request bounds and never exposes raw database text', () => {
  expect(friendlyError({ code: '23514', message: 'Page count must be between 1 and 2000' })).toBe('عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.')
  expect(friendlyError({ code: '23514', constraint: 'service_requests_page_count_range' })).toBe('عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.')
  expect(friendlyError({ code: '23514', message: 'Work title must be between 3 and 300 characters' })).toBe('عنوان العمل لازم يكون من ٣ إلى ٣٠٠ حرف.')
  expect(friendlyError({ code: '23514', constraint: 'request_status_history_note_length' })).toBe('الملاحظة لازم تكون ٥٠٠ حرف أو أقل.')

  const rawDatabaseText = 'secret SQL detail: insert into crdc.researchers violates private_rule'
  expect(friendlyError({ code: '23514', message: rawDatabaseText })).toBe(invalidData)
  expect(friendlyError({ code: '23505', message: rawDatabaseText })).toBe(invalidData)
})
