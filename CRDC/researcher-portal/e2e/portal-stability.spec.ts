import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

const supabaseUrl = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Portal-E2E-Test-2026!'
const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

// 14 digits, unique per run and per suffix, so reruns against the same database do not collide.
const nationalId = (prefix: string) => `2${prefix.slice(-2)}0101${String(Date.now()).slice(-7)}`

async function createConfirmedUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error(`could not create ${email}`)
  return data.user.id
}

// Profiles are created through the user's own session, exactly like the portal does.
async function createProfile(email: string, userId: string, national: string) {
  const client = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  const { error } = await client.schema('crdc').from('researchers').insert({
    auth_user_id: userId, full_name: 'باحث اختبار الاستقرار', applicant_type: 'egyptian', national_id: national, degree_id: 1, email,
  })
  if (error) throw error
}

async function signInThroughUi(page: Page, email: string) {
  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
}

test('M9/L6: an open profile form survives a token refresh, and a duplicate national ID shows a safe Arabic message', async ({ page }) => {
  const takenId = nationalId('29')
  const takenEmail = `e2e-r2-taken-${runId}@example.test`
  await createProfile(takenEmail, await createConfirmedUser(takenEmail), takenId)

  const email = `e2e-r2-form-${runId}@example.test`
  await createConfirmedUser(email)
  await signInThroughUi(page, email)
  await expect(page.getByRole('heading', { name: 'بيانات الباحث' })).toBeVisible()

  const fullName = page.getByLabel('الاسم بالكامل')
  await fullName.fill('نص لازم يفضل مكانه')
  await page.locator('input[name="national_id"]').fill(takenId)

  // Real refresh through the app's own Supabase client (the dev server serves it as an ES module),
  // which makes supabase-js emit TOKEN_REFRESHED for the same user while the form is open.
  const refreshed = page.evaluate(async () => {
    const events: string[] = []
    const { supabase } = await import('/src/supabase.ts')
    const { data } = supabase!.auth.onAuthStateChange((event) => { events.push(event) })
    const { error } = await supabase!.auth.refreshSession()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    data.subscription.unsubscribe()
    return { events, error: error?.message ?? null }
  })
  const result = await refreshed
  expect(result.error).toBeNull()
  expect(result.events).toContain('TOKEN_REFRESHED')
  await expect(page.getByRole('heading', { name: 'بيانات الباحث' })).toBeVisible()
  await expect(fullName).toHaveValue('نص لازم يفضل مكانه')
  await expect(page.locator('input[name="national_id"]')).toHaveValue(takenId)

  await page.locator('select[name="degree_id"]').selectOption('1')
  await page.locator('.form-card form button.primary-button').click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('تعذّر حفظ هذه البيانات')
  await expect(alert).not.toContainText(/23505|duplicate|violates|constraint|researchers_/i)
})

test('L2/L1: submitting a request twice quickly sends one request, and amounts are isolated as LTR', async ({ page }) => {
  const email = `e2e-r2-double-${runId}@example.test`
  await createProfile(email, await createConfirmedUser(email), nationalId('28'))
  await signInThroughUi(page, email)
  await expect(page.getByRole('navigation', { name: 'التنقل في حساب الباحث' })).toBeVisible()

  let created = 0
  await page.route('**/rest/v1/rpc/create_service_request', async (route) => {
    created += 1
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.continue()
  })

  await page.locator('input[name="work_title"]').fill(`Round2 double submit ${runId}`)
  await page.locator('input[name="page_count"]').fill('25')
  await page.locator('.fee-option').filter({ hasText: 'تدقيق لغوي عربي' }).locator('input[type="checkbox"]').check()
  const submit = page.getByRole('button', { name: 'تقديم الطلب' })
  await submit.dblclick()
  await expect(page.getByRole('heading', { name: 'تفاصيل الطلب' })).toBeVisible()
  expect(created).toBe(1)

  await expect(page.locator('.item-facts strong span[dir="ltr"]').first()).toContainText('EGP')
})
