import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

const url = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Round5-Portal-Test-2026!'
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function createResearcher(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const researcher = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: loginError } = await researcher.auth.signInWithPassword({ email, password })
  if (loginError) throw loginError
  const { error: profileError } = await researcher.schema('crdc').from('researchers').insert({
    auth_user_id: data.user.id,
    full_name: 'باحث جولة خمسة',
    applicant_type: 'egyptian',
    national_id: `2900101${String(Date.now()).slice(-7)}`,
    degree_id: 1,
    specialty: 'قبل التعديل',
    email,
  })
  if (profileError) throw profileError
  return data.user
}

test('researcher requests password reset and completes PASSWORD_RECOVERY', async ({ page, baseURL }) => {
  const email = `r5-reset-${Date.now()}@example.test`
  await createResearcher(email)
  await page.goto('/#login')
  await page.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click()
  await page.locator('input[name="email"]').fill(email)
  await page.getByRole('button', { name: 'إرسال رابط الاستعادة' }).click()
  await expect(page.getByRole('status')).toContainText('إذا كان هذا البريد مرتبطًا بحساب')

  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: baseURL! } })
  if (error) throw error
  await page.goto(data.properties.action_link)
  await expect(page.getByRole('heading', { name: 'تعيين كلمة مرور جديدة' })).toBeVisible()
  const newPassword = 'Round5-New-Password-2026!'
  await page.getByLabel('كلمة المرور الجديدة').fill(newPassword)
  await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click()
  await expect(page.getByRole('navigation', { name: 'التنقل في حساب الباحث' })).toBeVisible()

  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  // Signing out returns to the public home; sign in again from its header link.
  await page.getByRole('link', { name: 'تسجيل الدخول' }).click()
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(newPassword)
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('navigation', { name: 'التنقل في حساب الباحث' })).toBeVisible()
})

test('researcher can edit allowed profile fields while identity fields stay read-only', async ({ page }) => {
  const email = `r5-profile-${Date.now()}@example.test`
  await createResearcher(email)
  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('navigation', { name: 'التنقل في حساب الباحث' })).toBeVisible()
  await page.getByRole('button', { name: 'ملفي الشخصي' }).click()
  await expect(page.getByRole('heading', { name: 'تعديل البيانات الشخصية' })).toBeVisible()

  await expect(page.locator('input[readonly]')).toHaveCount(3)
  await expect(page.locator('input[readonly]').nth(0)).toHaveValue('مصري')
  await expect(page.locator('input[readonly]').nth(1)).toHaveValue(email)
  await expect(page.locator('input[readonly]').nth(2)).toHaveValue(/^29/)
  await page.locator('input[name="full_name"]').fill('باحث تم تحديث بياناته')
  await page.locator('input[name="specialty"]').fill('تخصص محدث')
  await page.getByRole('button', { name: 'حفظ التعديلات' }).click()
  await expect(page.getByRole('status')).toContainText('تم تحديث بياناتك الشخصية')
  await expect(page.getByRole('heading', { name: 'باحث تم تحديث بياناته' })).toBeVisible()
})
