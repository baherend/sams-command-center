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
  const portalNav = page.getByRole('navigation', { name: 'التنقل في حساب الباحث' })
  await expect(portalNav.or(saveError)).toBeVisible()
  if (await saveError.isVisible()) {
    throw new Error(`Researcher profile save failed: ${await saveError.textContent()}`)
  }
  await expect(portalNav).toBeVisible()
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

async function visibleRequestTitles(email: string) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError

  const { data, error } = await client.schema('crdc').from('service_requests').select('work_title').order('created_at')
  if (error) throw error
  return data.map((row) => row.work_title)
}

test('researchers can register, create and track a request, and only see their own data', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const egyptianEmail = `e2e-egyptian-${runId}@example.test`
  const foreignEmail = `e2e-foreign-${runId}@example.test`
  const requestTitle = `Playwright test request ${runId}`

  await registerAndCreateProfile(page, egyptianEmail, 'egyptian')
  await page.locator('input[name="work_title"]').fill(requestTitle)
  await page.locator('input[name="page_count"]').fill('25')
  await page.locator('.fee-option').filter({ hasText: 'تدقيق لغوي عربي' }).locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'تقديم الطلب' }).click()

  await expect(page.getByRole('heading', { name: 'تفاصيل الطلب' })).toBeVisible()
  await expect(page.getByText(requestTitle, { exact: true })).toBeVisible()
  await expect(page.getByText('تدقيق لغوي عربي', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'التنقل في حساب الباحث' }).getByRole('button', { name: 'طلباتي' }).click()
  const requestCard = page.getByRole('button').filter({ hasText: requestTitle })
  await expect(requestCard).toBeVisible()
  await requestCard.click()
  await expect(page.getByRole('heading', { name: 'تفاصيل الطلب' })).toBeVisible()
  await expect(page.getByText(requestTitle, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
  await expect(page.getByRole('tablist')).toBeVisible()
  await registerAndCreateProfile(page, foreignEmail, 'foreign')

  expect(await visibleResearcherEmails(egyptianEmail)).toEqual([egyptianEmail])
  expect(await visibleResearcherEmails(foreignEmail)).toEqual([foreignEmail])
  expect(await visibleRequestTitles(egyptianEmail)).toContain(requestTitle)
  expect(await visibleRequestTitles(foreignEmail)).not.toContain(requestTitle)
})
