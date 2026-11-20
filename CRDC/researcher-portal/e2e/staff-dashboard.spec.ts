import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

const supabaseUrl = process.env.SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Staff-E2E-Test-2026!'
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

test('active viewer signs into the staff shell and sees aggregate stats without researcher onboarding', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const email = `e2e-viewer-${runId}@example.test`
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError) throw createError

  const { error: staffError } = await admin.schema('crdc').from('staff_users').insert({
    auth_user_id: created.user.id,
    full_name: 'موظف اختبار المشاهد',
    role: 'viewer',
    is_active: true,
  })
  if (staffError) throw staffError

  await page.goto('/')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()

  await expect(page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })).toBeVisible()
  await expect(page.getByText('موظف اختبار المشاهد')).toBeVisible()
  await expect(page.getByText('مشاهد', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'نظرة عامة وإحصائيات' })).toBeVisible()
  await expect(page.getByText('إجمالي الطلبات')).toBeVisible()
  await expect(page.getByText('طلبات المصريين')).toBeVisible()
  await expect(page.getByText('طلبات الوافدين')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'بيانات الباحث' })).toHaveCount(0)
  await expect(page.getByLabel('الرقم القومي')).toHaveCount(0)
  await expect(page.getByLabel('رقم جواز السفر')).toHaveCount(0)
})

