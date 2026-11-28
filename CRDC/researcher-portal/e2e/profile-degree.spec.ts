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
    full_name: 'Degree Test Researcher',
    applicant_type: 'egyptian',
    national_id: `2900101${String(Date.now()).slice(-7)}`,
    degree_id: 1,
    specialty: 'Test',
    email,
  })
  if (profileError) throw profileError
}

test('saved academic degree is shown in the profile form after save and after reload', async ({ page }) => {
  const email = `degree-${Date.now()}@example.test`
  await createResearcher(email)
  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  await page.getByRole('button', { name: '\u0645\u0644\u0641\u064a \u0627\u0644\u0634\u062e\u0635\u064a' }).click()

  const select = page.locator('select[name="degree_id"]')
  await expect(select).toHaveValue('1')
  await select.selectOption('4')
  await page.getByRole('button', { name: '\u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a' }).click()
  await expect(page.getByRole('status')).toContainText('\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0628\u064a\u0627\u0646\u0627\u062a\u0643 \u0627\u0644\u0634\u062e\u0635\u064a\u0629')

  await page.reload()
  await page.getByRole('button', { name: '\u0645\u0644\u0641\u064a \u0627\u0644\u0634\u062e\u0635\u064a' }).click()
  await expect(page.locator('select[name="degree_id"]')).toHaveValue('4')
})