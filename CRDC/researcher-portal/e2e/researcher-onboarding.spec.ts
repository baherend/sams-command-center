import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

const supabaseUrl = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Portal-E2E-Test-2026!'
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function confirmLocalSignup(email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 })
  if (error) throw error

  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) throw new Error(`Supabase Auth did not create ${email}`)

  const { error: confirmError } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
  if (confirmError) throw confirmError
}

async function registerAndCreateProfile(
  page: Page,
  email: string,
  applicantType: 'egyptian' | 'foreign',
) {
  await page.goto('/')
  await page.getByRole('tablist').getByRole('button', { name: 'حساب جديد' }).click()
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('status')).toContainText('الحساب اتعمل')

  // Confirm only inside the isolated local Auth instance so this test can continue to profile creation.
  await confirmLocalSignup(email)

  await page.getByRole('tablist').getByRole('button', { name: 'تسجيل الدخول' }).click()
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  await expect(page.getByRole('heading', { name: 'بيانات الباحث' })).toBeVisible()

  await page.getByLabel('الاسم بالكامل').fill(applicantType === 'egyptian' ? 'باحث اختبار مصري' : 'باحث اختبار وافد')
  await page.locator('select[name="applicant_type"]').selectOption(applicantType)
  if (applicantType === 'egyptian') {
    await page.locator('input[name="national_id"]').fill('12345678901234')
  } else {
    await page.locator('input[name="passport_no"]').fill('E2E-PASSPORT-001')
    await page.locator('input[name="nationality"]').fill('Testland')
  }
  await page.locator('select[name="degree_id"]').selectOption(applicantType === 'egyptian' ? '1' : '2')
  await page.getByLabel('التخصص').fill('إدارة أعمال')
  await page.locator('.form-card form button.primary-button').click()

  const saveError = page.getByRole('alert')
  if (await saveError.isVisible()) {
    throw new Error(`Researcher profile save failed: ${await saveError.textContent()}`)
  }
  await expect(page.getByRole('heading', { name: 'حسابك جاهز' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('ملف الباحث اتسجل بنجاح')
}

async function visibleResearcherEmails(email: string) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError

  const { data, error } = await client.schema('crdc').from('researchers').select('email').order('email')
  if (error) throw error
  return data.map((row) => row.email)
}

test('Egyptian and foreign researchers can register, save profiles, and only read their own profile', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const egyptianEmail = `e2e-egyptian-${runId}@example.test`
  const foreignEmail = `e2e-foreign-${runId}@example.test`

  await registerAndCreateProfile(page, egyptianEmail, 'egyptian')
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  await registerAndCreateProfile(page, foreignEmail, 'foreign')

  expect(await visibleResearcherEmails(egyptianEmail)).toEqual([egyptianEmail])
  expect(await visibleResearcherEmails(foreignEmail)).toEqual([foreignEmail])
})
