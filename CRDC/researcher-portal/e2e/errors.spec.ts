import { expect, test } from '@playwright/test'
import { friendlyError } from '../src/errors'

const invalidData = 'هذه البيانات غير مقبولة. راجعها وحاول مرة أخرى.'

test('friendlyError maps specific authorization messages before broad matches', () => {
  expect(friendlyError({ code: '42501', message: 'Staff cannot be assigned to their own researcher request' }))
    .toBe('لا يجوز تعيين موظف على طلب قدّمه بصفته باحثًا.')
  expect(friendlyError({ code: '42501', message: 'Staff cannot change the status of their own researcher request' }))
    .toBe('لا يجوز للموظف تغيير حالة طلب قدّمه بصفته باحثًا.')
})

test('friendlyError shows the identity message only for identity constraints', () => {
  const identityMessage = 'تعذّر حفظ هذه البيانات. راجع البيانات المدخلة، وإذا كنت متأكدًا من صحتها فتواصل مع إدارة المركز.'
  for (const constraint of ['researchers_national_id_key', 'researchers_passport_nationality_key', 'researchers_national_id_format']) {
    expect(friendlyError({ code: '23514', message: 'database rejected input', details: `constraint ${constraint}` })).toBe(identityMessage)
  }
  expect(friendlyError({ code: '23505', message: 'duplicate key', constraint: 'some_other_unique_key' })).toBe(invalidData)
  expect(friendlyError({ code: '23514', message: 'some other check constraint failed' })).toBe(invalidData)
})

test('friendlyError maps payment integrity errors to safe Arabic messages', () => {
  const scenarios: [string, string][] = [
    ['Payment amount must equal the selected service items total', 'يجب أن يساوي إجمالي المبلغ مجموع الخدمات المختارة. راجع المبلغ وحاول مرة أخرى.'],
    ['Payment and service items must have the same request and currency', 'يجب أن يكون إذن الدفع والخدمات للطلب نفسه وبالعملة نفسها.'],
    ['A service item is already linked to another payment', 'توجد خدمة مرتبطة بإذن دفع آخر بالفعل. راجع الطلب قبل المحاولة.'],
    ['Payment is linked to service items; its recorded values are locked', 'سُجّلت بيانات إذن الدفع على خدمات، ولم يعد تغييرها ممكنًا.'],
  ]
  for (const [message, expected] of scenarios) expect(friendlyError({ code: '23514', message })).toBe(expected)
  expect(friendlyError({ code: '23505', message: 'duplicate', details: 'payments_receipt_no_key' }))
    .toBe('رقم الإيصال مستخدم من قبل. راجعه وجرّب رقمًا آخر.')
  expect(friendlyError({ code: '23505', message: 'duplicate', constraint: 'payments_payment_order_no_key' }))
    .toBe('رقم إذن الدفع مستخدم من قبل. راجعه وجرّب رقمًا آخر.')
  expect(friendlyError({ code: '23505', message: 'Receipt reference is already in use' }))
    .toBe('رقم الإيصال مستخدم من قبل. راجعه وجرّب رقمًا آخر.')
  expect(friendlyError({ code: '23514', message: 'This receipt is not awaiting verification' }))
    .toBe('تمت مراجعة الإيصال بالفعل أو أنه غير موجود في قائمة المراجعة. حدّث الصفحة.')
})

test('friendlyError maps request bounds and never exposes raw database text', () => {
  expect(friendlyError({ code: '23514', message: 'Page count must be between 1 and 2000' })).toBe('يجب أن يكون عدد الصفحات من ١ إلى ٢٠٠٠.')
  expect(friendlyError({ code: '23514', constraint: 'service_requests_page_count_range' })).toBe('يجب أن يكون عدد الصفحات من ١ إلى ٢٠٠٠.')
  expect(friendlyError({ code: '23514', message: 'Work title must be between 3 and 300 characters' })).toBe('يجب أن يكون عنوان العمل من ٣ إلى ٣٠٠ حرف.')
  expect(friendlyError({ code: '23514', constraint: 'request_status_history_note_length' })).toBe('يجب ألا تزيد الملاحظة على ٥٠٠ حرف.')

  const rawDatabaseText = 'secret SQL detail: insert into crdc.researchers violates private_rule'
  expect(friendlyError({ code: '23514', message: rawDatabaseText })).toBe(invalidData)
  expect(friendlyError({ code: '23505', message: rawDatabaseText })).toBe(invalidData)
})
