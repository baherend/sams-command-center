import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

const supabaseUrl = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Cashier-E2E-Test-2026!'
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

test('researcher uploads a receipt and cashier approval records PAID', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const researcherEmail = `e2e-r4-researcher-${runId}@example.test`
  const cashierEmail = `e2e-r4-cashier-${runId}@example.test`
  const { data: researcherAuth, error: researcherCreateError } = await admin.auth.admin.createUser({ email: researcherEmail, password, email_confirm: true })
  if (researcherCreateError) throw researcherCreateError
  const { data: cashierAuth, error: cashierCreateError } = await admin.auth.admin.createUser({ email: cashierEmail, password, email_confirm: true })
  if (cashierCreateError) throw cashierCreateError
  const { error: staffError } = await admin.schema('crdc').from('staff_users').insert({
    auth_user_id: cashierAuth.user.id, full_name: 'أمين خزينة اختبار', role: 'cashier', is_active: true,
  })
  if (staffError) throw staffError

  await page.goto('/')
  await page.locator('input[name="email"]').fill(researcherEmail)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('heading', { name: 'بيانات الباحث' })).toBeVisible()
  await page.getByLabel('الاسم بالكامل').fill('باحث إيصال اختبار')
  await page.locator('select[name="applicant_type"]').selectOption('egyptian')
  await page.locator('input[name="national_id"]').fill(`2900101010${runId.slice(-4).padStart(4, '0')}`)
  await page.locator('select[name="degree_id"]').selectOption('1')
  await page.getByLabel('التخصص').fill('اختبار إيصالات')
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('navigation', { name: 'التنقل في حساب الباحث' })).toBeVisible()

  const requestTitle = `R4 receipt flow ${runId}`
  await page.locator('.fee-option').filter({ hasText: 'تدقيق لغوي عربي' }).locator('input[type="checkbox"]').check()
  const pageCount = page.locator('input[name="page_count"]')
  if (await pageCount.isVisible()) await pageCount.fill('20')
  await page.locator('input[name="work_title"]').fill(requestTitle)
  await page.getByRole('button', { name: 'تقديم الطلب' }).click()
  const requestHeading = page.getByRole('heading', { name: 'تفاصيل الطلب' })
  const requestError = page.getByRole('alert')
  await expect(requestHeading.or(requestError)).toBeVisible()
  if (await requestError.isVisible()) throw new Error(`Request creation failed: ${await requestError.textContent()}`)

  const researcher = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const cashier = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: researcherLoginError } = await researcher.auth.signInWithPassword({ email: researcherEmail, password })
  if (researcherLoginError) throw researcherLoginError
  const { error: cashierLoginError } = await cashier.auth.signInWithPassword({ email: cashierEmail, password })
  if (cashierLoginError) throw cashierLoginError

  const { data: request, error: requestError } = await researcher.schema('crdc').from('service_requests')
    .select('request_id').eq('work_title', requestTitle).single()
  if (requestError) throw requestError
  const { data: requestItems, error: itemsError } = await researcher.schema('crdc').from('request_items')
    .select('item_id,amount_due,currency').eq('request_id', request.request_id)
  if (itemsError || !requestItems?.length) throw itemsError ?? new Error('Request did not create service items')
  const amount = requestItems.reduce((sum, item) => sum + Number(item.amount_due), 0)
  const { data: payment, error: paymentError } = await cashier.schema('crdc').from('payments').insert({
    request_id: request.request_id,
    payment_order_no: `R4-ORDER-${runId}`,
    amount,
    currency: requestItems[0].currency,
    channel: 'treasury',
  }).select('payment_id').single()
  if (paymentError) throw paymentError
  const { error: linkError } = await cashier.schema('crdc').rpc('link_payment_to_items', {
    p_payment_id: payment.payment_id, p_item_ids: requestItems.map((item) => item.item_id),
  })
  if (linkError) throw linkError
  for (const item of requestItems) {
    const { error } = await cashier.schema('crdc').rpc('set_request_item_status', {
      p_item_id: item.item_id, p_status_code: 'PAYMENT_ORDER', p_note: 'إذن دفع لاختبار إيصال الخزينة',
    })
    if (error) throw error
  }

  await page.getByRole('navigation', { name: 'التنقل في حساب الباحث' }).getByRole('button', { name: 'طلباتي' }).click()
  await page.getByRole('button').filter({ hasText: requestTitle }).click()
  const receiptCard = page.getByTestId('payment-receipt-card')
  await expect(receiptCard).toBeVisible()
  await receiptCard.getByLabel('قناة السداد').selectOption('bank')
  await receiptCard.getByLabel('رقم الإيصال').fill(`R4-RECEIPT-${runId}`)
  await receiptCard.getByLabel('تاريخ السداد').fill(new Date().toISOString().slice(0, 10))
  await receiptCard.getByLabel('صورة أو ملف الإيصال').setInputFiles({
    name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nsynthetic receipt proof\n%%EOF'),
  })
  await receiptCard.getByRole('button', { name: 'إرسال الإيصال للمراجعة' }).click()
  await expect(receiptCard.getByText('بانتظار مراجعة الخزينة')).toBeVisible()

  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  await page.locator('input[name="email"]').fill(cashierEmail)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('heading', { name: 'مراجعة إيصالات السداد' })).toBeVisible()
  const cashierCard = page.getByTestId('cashier-receipt').filter({ hasText: requestTitle })
  await expect(cashierCard).toBeVisible()
  await cashierCard.getByRole('button', { name: 'إنشاء رابط معاينة آمن' }).click()
  await expect(cashierCard.getByRole('link', { name: 'معاينة الإيصال' })).toBeVisible()
  await cashierCard.getByRole('button', { name: 'اعتماد السداد' }).click()
  await expect(cashierCard).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('تم اعتماد السداد')

  const { data: paidItems, error: paidError } = await admin.schema('crdc').from('request_items').select('status_id').in('item_id', requestItems.map((item) => item.item_id))
  if (paidError) throw paidError
  const { data: paidStatus, error: statusError } = await admin.schema('crdc').from('request_statuses').select('status_id').eq('code', 'PAID').single()
  if (statusError) throw statusError
  expect(paidItems.every((item) => item.status_id === paidStatus.status_id)).toBe(true)
  const { data: finalPayment, error: finalPaymentError } = await admin.schema('crdc').from('payments').select('receipt_status,verified_at').eq('payment_id', payment.payment_id).single()
  if (finalPaymentError) throw finalPaymentError
  expect(finalPayment.receipt_status).toBe('verified')
  expect(finalPayment.verified_at).toBeTruthy()
})
