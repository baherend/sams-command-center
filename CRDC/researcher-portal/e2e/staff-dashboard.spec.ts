import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Page, Response } from '@playwright/test'

const supabaseUrl = process.env.SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Staff-E2E-Test-2026!'
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
const latinDigits = (text: string) => text.replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
const toNumber = (text: string) => Number(latinDigits(text).replace(/٬|,/g, '').replace(/٫/g, '.').replace(/[^0-9.]/g, ''))
const collectKeys = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap(collectKeys)
  : value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, inner]) => [key, ...collectKeys(inner)])
    : []
const piiKey = /name$|^name|email|national|passport|nationality|researcher|auth_user|staff|title/i
const allowedNameKeys = ['service_name_ar', 'status_name_ar']
const kpiLabels = [
  'إجمالي الطلبات', 'إجمالي البنود', 'البنود النشطة', 'البنود المكتملة',
  'متوسط مدة الإنجاز', 'الإيراد الموثّق (جنيه)', 'الإيراد الموثّق (دولار)',
]
const rangeLabels = ['الكل', 'آخر 30 يوم', 'آخر 90 يوم', 'آخر سنة']
const trendTitles = ['عدد الطلبات شهريًا', 'الإيراد الموثّق شهريًا (جنيه)', 'الإيراد الموثّق شهريًا (دولار)']
const isAnalyticsCall = (response: Response) => response.url().includes('get_analytics_dashboard') && response.request().method() === 'POST'

async function expectNoResearcherPii(page: Page, payload: unknown) {
  const badKeys = collectKeys(payload).filter((key) => piiKey.test(key) && !allowedNameKeys.includes(key))
  expect(badKeys).toEqual([])
  expect(JSON.stringify(payload)).not.toMatch(/@|example\.test|TEST-/i)
  const pageText = latinDigits(await page.locator('main').innerText())
  expect(pageText).not.toMatch(/@|example\.test|TEST-/i)
  expect(pageText).not.toMatch(/\b[23]\d{13}\b/)
  await expect(page.getByLabel('الرقم القومي')).toHaveCount(0)
  await expect(page.getByLabel('رقم جواز السفر')).toHaveCount(0)
}

async function expectAnalyticsDashboard(page: Page, firstPayload: unknown) {
  await expect(page.getByRole('heading', { name: 'الإحصائيات والمؤشرات', exact: true })).toBeVisible()
  const body = page.locator('.analytics-body')
  await expect(body).toHaveAttribute('aria-busy', 'false')

  const { count: requestCount, error: requestCountError } = await admin.schema('crdc').from('service_requests').select('request_id', { count: 'exact', head: true })
  if (requestCountError) throw requestCountError
  const { count: statusCount, error: statusCountError } = await admin.schema('crdc').from('request_statuses').select('status_id', { count: 'exact', head: true })
  if (statusCountError) throw statusCountError

  const kpis = page.locator('.analytics-kpis .staff-stat-card')
  await expect(kpis).toHaveCount(kpiLabels.length)
  for (const label of kpiLabels) {
    const card = kpis.filter({ hasText: label })
    await expect(card).toHaveCount(1)
    if (label !== 'متوسط مدة الإنجاز') await expect(card.locator('[dir="ltr"]').first()).toBeVisible()
  }
  await expect(kpis.filter({ hasText: '(جنيه)' })).toContainText('EGP')
  await expect(kpis.filter({ hasText: '(دولار)' })).toContainText('USD')
  const totalCard = kpis.filter({ hasText: 'إجمالي الطلبات' }).locator('strong')
  expect(toNumber(await totalCard.innerText())).toBe(requestCount)

  const charts = body.locator('svg[role="img"]')
  const serviceRows = await body.locator('ul[aria-label="عدد البنود لكل خدمة"] > li').count()
  expect(serviceRows).toBeGreaterThan(0)
  await expect(charts).toHaveCount(serviceRows + (statusCount ?? 0) + 1 + trendTitles.length)
  const unnamed = await charts.evaluateAll((elements) => elements.filter((element) => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).length)
  expect(unnamed).toBe(0)
  for (const title of trendTitles) await expect(body.getByRole('img', { name: title })).toHaveCount(1)

  // Trend axis reads left to right: oldest month on the left, newest on the right.
  await expect(body.locator('.analytics-chart-scroll').first()).toHaveAttribute('dir', 'ltr')
  const bars = body.getByRole('img', { name: trendTitles[0] }).locator('rect.bar')
  await expect(bars).toHaveCount(12)
  const xs = await bars.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('x'))))
  expect(xs).toEqual([...xs].sort((a, b) => a - b))

  await expectNoResearcherPii(page, firstPayload)

  const group = page.getByRole('group', { name: 'الفترة الزمنية' })
  for (const label of rangeLabels) await expect(group.getByRole('button', { name: label, exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: 'الكل', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const windowResponse = page.waitForResponse((response) => isAnalyticsCall(response) && (response.request().postData() ?? '').includes('"p_days":30'))
  await group.getByRole('button', { name: 'آخر 30 يوم', exact: true }).click()
  const payload30 = await (await windowResponse).json()
  expect(payload30.kpis.total_requests).toBeLessThanOrEqual(requestCount ?? 0)
  await expect(group.getByRole('button', { name: 'آخر 30 يوم', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(body).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => toNumber(await totalCard.innerText())).toBe(payload30.kpis.total_requests)
  await expectNoResearcherPii(page, payload30)
}

test('active viewer lands on the analytics dashboard, keeps the overview tab, and sees no researcher data', async ({ page }) => {
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

  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  const firstResponse = page.waitForResponse(isAnalyticsCall)
  await page.locator('.form-card form button.primary-button').click()

  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await expect(page.getByText('موظف اختبار المشاهد')).toBeVisible()
  await expect(page.getByText('مشاهد', { exact: true })).toBeVisible()
  await expectAnalyticsDashboard(page, await (await firstResponse).json())

  await nav.getByRole('button', { name: 'نظرة عامة وإحصائيات', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'نظرة عامة وإحصائيات' })).toBeVisible()
  await expect(page.getByText('إجمالي الطلبات')).toBeVisible()
  await expect(page.getByText('طلبات المصريين')).toBeVisible()
  await expect(page.getByText('طلبات الوافدين')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'بيانات الباحث' })).toHaveCount(0)
  await expect(page.getByLabel('الرقم القومي')).toHaveCount(0)
  await expect(page.getByLabel('رقم جواز السفر')).toHaveCount(0)
})

test('admin opens the analytics tab from the overview and sees the same aggregate-only dashboard', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const email = `e2e-analytics-admin-${runId}@example.test`
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError) throw createError
  const { error: staffError } = await admin.schema('crdc').from('staff_users').insert({
    auth_user_id: created.user.id, full_name: 'مدير اختبار الإحصائيات', role: 'admin', is_active: true,
  })
  if (staffError) throw staffError

  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await expect(page.getByRole('heading', { name: 'نظرة عامة وإحصائيات' })).toBeVisible()

  const firstResponse = page.waitForResponse(isAnalyticsCall)
  await nav.getByRole('button', { name: 'الإحصائيات والمؤشرات', exact: true }).click()
  await expectAnalyticsDashboard(page, await (await firstResponse).json())
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

  await page.goto('/#login')
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
  await expect(page.getByRole('status')).toContainText('تم تعيين')
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

  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'إدارة الطلبات والتعيينات' }).click()
  await page.getByLabel('التصفية حسب نوع العمل').selectOption('paper')
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

  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(reviewerEmail)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'الطلبات المسندة إليّ' }).click()
  const assigned = page.locator(`[data-testid="assigned-case"][data-item-id="${fixtureItems[0].item_id}"]`)
  await expect(assigned).toBeVisible()
  await expect(assigned.getByText('ستظهر الملاحظة للباحث')).toBeVisible()
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

test('reviewer sees all journals and switches publication journal on a single assigned item', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const reviewerEmail = `e2e-pub-reviewer-${runId}@example.test`
  const { data: reviewerUser, error: reviewerError } = await admin.auth.admin.createUser({ email: reviewerEmail, password, email_confirm: true })
  if (reviewerError) throw reviewerError
  const { data: insertedStaff, error: staffError } = await admin.schema('crdc').from('staff_users').insert({ auth_user_id: reviewerUser.user.id, full_name: 'مراجع مجلات النشر', role: 'reviewer', is_active: true }).select('staff_id').single()
  if (staffError) throw staffError

  const [{ data: allIssues, error: issuesError }, { data: paperReq, error: reqError }] = await Promise.all([
    admin.schema('crdc').from('journal_issues').select('issue_id, journal_id').order('issue_id'),
    admin.schema('crdc').from('service_requests').select('request_id').eq('work_type', 'paper').order('request_id').limit(1).single(),
  ])
  if (issuesError) throw issuesError
  if (reqError) throw reqError
  const { data: reqItems, error: itemError } = await admin.schema('crdc').from('request_items').select('item_id').eq('request_id', paperReq.request_id).order('item_id')
  if (itemError || !reqItems?.length) throw itemError ?? new Error('No items for paper request')
  const allJournals = [...new Set(allIssues.map((issue) => issue.journal_id))].map((journal_id) => ({ journal_id }))
  expect(allJournals.length).toBeGreaterThanOrEqual(2)

  const { error: assignError } = await admin.schema('crdc').from('request_items').update({ assigned_staff_id: insertedStaff.staff_id }).in('item_id', reqItems.map((row) => row.item_id))
  if (assignError) throw assignError

  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(reviewerEmail)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: 'التنقل في لوحة الموظف' })
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'الطلبات المسندة إليّ' }).click()

  const editor = page.locator('.publication-editor').first()
  await expect(assigned).toBeVisible()
  const editor = assigned.locator('.publication-editor')
  const journalSelect = editor.locator('select[name="journal_id"]')
  const issueSelect = editor.locator('select[name="issue_id"]')

  const expectedJournalIds = allJournals.map((journal) => String(journal.journal_id))
  await expect.poll(() => journalSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual(expect.arrayContaining(expectedJournalIds))

  const savedJournalId = Number(await journalSelect.inputValue())
  const otherJournal = allJournals.find((journal) => journal.journal_id !== savedJournalId)!
  const targetIssue = allIssues.find((issue) => issue.journal_id === otherJournal.journal_id)!

  await journalSelect.selectOption(String(otherJournal.journal_id))
  await expect(issueSelect).toHaveValue('')
  await issueSelect.selectOption(String(targetIssue.issue_id))
  await editor.getByRole('button', { name: 'حفظ قرار النشر' }).click()
  await expect(page.getByRole('status')).toContainText('تم حفظ قرار النشر')

  await page.reload()
  await nav.getByRole('button', { name: 'الطلبات المسندة إليّ' }).click()
  const reloadedEditor = page.locator('.publication-editor').first()
  await expect(reloadedEditor.locator('select[name="journal_id"]')).toHaveValue(String(otherJournal.journal_id))
  await expect(reloadedEditor.locator('select[name="issue_id"]')).toHaveValue(String(targetIssue.issue_id))
})
