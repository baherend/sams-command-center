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

test('admin assigns an active reviewer to a request and the assignment persists', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const adminEmail = `e2e-admin-${runId}@example.test`
  const reviewerEmail = `e2e-reviewer-${runId}@example.test`
  const { data: adminUser, error: adminCreateError } = await admin.auth.admin.createUser({ email: adminEmail, password, email_confirm: true })
  if (adminCreateError) throw adminCreateError
  const { data: reviewerUser, error: reviewerCreateError } = await admin.auth.admin.createUser({ email: reviewerEmail, password, email_confirm: true })
  if (reviewerCreateError) throw reviewerCreateError

  const { error: staffInsertError } = await admin.schema('crdc').from('staff_users').insert([
    { auth_user_id: adminUser.user.id, full_name: 'مدير اختبار', role: 'admin', is_active: true },
    { auth_user_id: reviewerUser.user.id, full_name: 'مراجع اختبار', role: 'reviewer', is_active: true },
  ])
  if (staffInsertError) throw staffInsertError

  await page.goto('/')
  await page.locator('input[name="email"]').fill(adminEmail)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const staffNav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(staffNav).toBeVisible()
  await staffNav.getByRole('button', { name: 'إدارة الطلبات والتعيينات' }).click()
  await expect(page.getByRole('heading', { name: 'إدارة الطلبات والتعيينات' })).toBeVisible()

  const requestRow = page.getByTestId('admin-request-row').first()
  await expect(requestRow).toBeVisible()
  const requestId = await requestRow.getAttribute('data-request-id')
  await requestRow.getByLabel('تعيين المراجع أو الإحصائي').selectOption({ label: 'مراجع اختبار · مراجع' })
  await expect(page.getByRole('status')).toContainText('اتعيّن')
  await expect(requestRow.locator('.assigned-staff-names')).toContainText('مراجع اختبار')

  await page.reload()
  await page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' }).getByRole('button', { name: 'إدارة الطلبات والتعيينات' }).click()
  const refreshedRow = page.locator(`[data-testid="admin-request-row"][data-request-id="${requestId}"]`)
  await expect(refreshedRow).toBeVisible()
  await expect(refreshedRow.locator('.assigned-staff-names')).toContainText('مراجع اختبار')
})

