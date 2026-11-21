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

test('admin paginates synthetic requests and assignments persist across pages', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const { data: syntheticRequests, error: seedError } = await admin.schema('crdc').from('service_requests').select('request_id').limit(45)
  if (seedError) throw seedError
  expect(syntheticRequests).toHaveLength(45)
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

  const visibleRows = page.getByTestId('admin-request-row')
  await expect(visibleRows).toHaveCount(20)
  const firstPageFirstId = await visibleRows.first().getAttribute('data-request-id')
  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(visibleRows).toHaveCount(20)
  await expect.poll(() => visibleRows.first().getAttribute('data-request-id')).not.toBe(firstPageFirstId)
  const secondPageFirstId = await visibleRows.first().getAttribute('data-request-id')
  expect(secondPageFirstId).not.toBe(firstPageFirstId)
  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(visibleRows).toHaveCount(20)
  await expect.poll(() => visibleRows.first().getAttribute('data-request-id')).not.toBe(secondPageFirstId)
  await page.getByRole('button', { name: 'السابق' }).click()
  await expect(visibleRows).toHaveCount(20)
  await expect.poll(() => visibleRows.first().getAttribute('data-request-id')).toBe(secondPageFirstId)
  await page.getByRole('button', { name: 'السابق' }).click()
  await expect(visibleRows).toHaveCount(20)
  await expect(visibleRows.first()).toHaveAttribute('data-request-id', firstPageFirstId!)

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

test('publication issue options follow the journal selected in the editor', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const email = `e2e-publication-admin-${runId}@example.test`
  const { data: adminUser, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError) throw createError
  const { error: staffError } = await admin.schema('crdc').from('staff_users').insert({
    auth_user_id: adminUser.user.id, full_name: 'مدير اختبار النشر', role: 'admin', is_active: true,
  })
  if (staffError) throw staffError

  const { data: allIssues, error: issuesError } = await admin.schema('crdc').from('journal_issues')
    .select('issue_id, journal_id').order('issue_id')
  if (issuesError) throw issuesError

  await page.goto('/')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'إدارة الطلبات والتعيينات' }).click()
  await page.getByLabel('فلترة بنوع العمل').selectOption('paper')
  await nav.getByRole('button', { name: 'كل الطلبات والبنود' }).click()

  const editor = page.locator('.publication-editor').first()
  await expect(editor).toBeVisible()
  const journalSelect = editor.locator('select[name="journal_id"]')
  const issueSelect = editor.locator('select[name="issue_id"]')
  const savedJournalId = Number(await journalSelect.inputValue())
  const targetIssue = allIssues.find((issue) => issue.journal_id !== savedJournalId)
  expect(targetIssue).toBeTruthy()
  const targetIssueIds = allIssues.filter((issue) => issue.journal_id === targetIssue!.journal_id).map((issue) => String(issue.issue_id))

  await journalSelect.selectOption(String(targetIssue!.journal_id))
  await expect(issueSelect).toHaveValue('')
  await expect.poll(() => issueSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)))
    .toEqual(expect.arrayContaining(['', ...targetIssueIds]))
  const visibleIssueIds = await issueSelect.locator('option').evaluateAll((options) => options.slice(1).map((option) => (option as HTMLOptionElement).value))
  expect(new Set(visibleIssueIds)).toEqual(new Set(targetIssueIds))
})

test('assigned reviewer updates a case and cannot see another reviewer case', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const reviewerEmail = `e2e-ops-reviewer-${runId}@example.test`
  const otherEmail = `e2e-ops-other-${runId}@example.test`
  const { data: reviewerUser, error: reviewerError } = await admin.auth.admin.createUser({ email: reviewerEmail, password, email_confirm: true })
  if (reviewerError) throw reviewerError
  const { data: otherUser, error: otherError } = await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true })
  if (otherError) throw otherError
  const { data: insertedStaff, error: staffError } = await admin.schema('crdc').from('staff_users').insert([
    { auth_user_id: reviewerUser.user.id, full_name: 'مراجع تشغيل', role: 'reviewer', is_active: true },
    { auth_user_id: otherUser.user.id, full_name: 'مراجع آخر', role: 'reviewer', is_active: true },
  ]).select('staff_id, full_name')
  if (staffError) throw staffError
  const reviewerStaffId = insertedStaff.find((row) => row.full_name === 'مراجع تشغيل')!.staff_id
  const otherStaffId = insertedStaff.find((row) => row.full_name === 'مراجع آخر')!.staff_id
  const { data: fixtureItems, error: itemError } = await admin.schema('crdc').from('request_items').select('item_id, request_id').order('item_id').limit(2)
  if (itemError || !fixtureItems || fixtureItems.length < 2) throw itemError ?? new Error('Seed has too few items')
  const { data: paid, error: paidError } = await admin.schema('crdc').from('request_statuses').select('status_id').eq('code', 'PAID').single()
  if (paidError) throw paidError
  for (const [index, fixture] of fixtureItems.entries()) {
    const { error: fixtureError } = await admin.schema('crdc').from('request_items').update({ assigned_staff_id: index === 0 ? reviewerStaffId : otherStaffId, status_id: paid.status_id }).eq('item_id', fixture.item_id)
    if (fixtureError) throw fixtureError
  }

  await page.goto('/')
  await page.locator('input[name="email"]').fill(reviewerEmail)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'الطلبات المسندة إليّ' }).click()
  const assigned = page.locator(`[data-testid="assigned-case"][data-item-id="${fixtureItems[0].item_id}"]`)
  await expect(assigned).toBeVisible()
  await expect(assigned.getByText('الملاحظة هتظهر للباحث')).toBeVisible()
  await expect(page.locator(`[data-testid="assigned-case"][data-item-id="${fixtureItems[1].item_id}"]`)).toHaveCount(0)
  await assigned.getByLabel('الحالة التشغيلية').selectOption('IN_PROGRESS')
  await assigned.getByLabel('ملاحظة للسجل').fill('بدأت مراجعة الاختبار')
  await assigned.getByRole('button', { name: 'حفظ الحالة' }).click()
  await expect(page.getByRole('status')).toContainText('تم تحديث حالة البند')
  await expect(assigned.getByText('بدأت مراجعة الاختبار')).toBeVisible()
  await expect(assigned.locator('.request-card-status')).toHaveText('قيد التنفيذ')

  const { data: savedHistory, error: historyError } = await admin.schema('crdc').from('request_status_history')
    .select('changed_at').eq('item_id', fixtureItems[0].item_id).order('changed_at', { ascending: false }).limit(1).single()
  if (historyError) throw historyError
  const displayedTimestamp = assigned.locator('.timeline-row').filter({ hasText: 'بدأت مراجعة الاختبار' }).locator('time')
  await expect(displayedTimestamp).toHaveAttribute('datetime', savedHistory.changed_at)
})

