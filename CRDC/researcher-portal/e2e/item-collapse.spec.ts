import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

const supabaseUrl = process.env.SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const password = 'Collapse-E2E-Test-2026!'
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const navName = '\u0627\u0644\u062a\u0646\u0642\u0644 \u0641\u064a \u0644\u0648\u062d\u0629 \u0627\u0644\u0645\u0648\u0638\u0641'
const assignedTab = new RegExp('\u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u0633\u0646\u062f\u0629')
const statusLabel = '\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u064a\u0629'
const noteLabel = '\u0645\u0644\u0627\u062d\u0638\u0629 \u0644\u0644\u0633\u062c\u0644'
const saveButton = '\u062d\u0641\u0638 \u0627\u0644\u062d\u0627\u0644\u0629'
const updatedNotice = '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u062d\u0627\u0644\u0629 \u0627\u0644\u0628\u0646\u062f'
const inProgressLabel = '\u0642\u064a\u062f \u0627\u0644\u062a\u0646\u0641\u064a\u0630'
const note = 'collapse test note'

async function expectState(card: Locator, open: boolean) {
  await expect(card.locator('.item-toggle')).toHaveAttribute('aria-expanded', open ? 'true' : 'false')
  await expect(card.locator('.item-collapse')).toHaveAttribute('data-open', open ? 'true' : 'false')
  if (open) await expect(card.locator('.item-collapse')).not.toHaveAttribute('inert', '')
  else await expect(card.locator('.item-collapse')).toHaveAttribute('inert', '')
}

test('item cards start collapsed, stay open until their own arrow closes them, and survive saving', async ({ page }) => {
  const runId = process.env.GITHUB_RUN_ID ?? Date.now().toString()
  const email = `e2e-collapse-reviewer-${runId}@example.test`
  const { data: user, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (userError) throw userError
  const { data: staff, error: staffError } = await admin.schema('crdc').from('staff_users')
    .insert({ auth_user_id: user.user.id, full_name: 'Collapse Test Reviewer', role: 'reviewer', is_active: true })
    .select('staff_id').single()
  if (staffError) throw staffError
  const { data: fixtureItems, error: itemError } = await admin.schema('crdc').from('request_items')
    .select('item_id').order('item_id', { ascending: false }).limit(2)
  if (itemError || !fixtureItems || fixtureItems.length < 2) throw itemError ?? new Error('Seed has too few items')
  const { data: paid, error: paidError } = await admin.schema('crdc').from('request_statuses').select('status_id').eq('code', 'PAID').single()
  if (paidError) throw paidError
  for (const fixture of fixtureItems) {
    const { error: assignError } = await admin.schema('crdc').from('request_items')
      .update({ assigned_staff_id: staff.staff_id, status_id: paid.status_id }).eq('item_id', fixture.item_id)
    if (assignError) throw assignError
  }

  await page.goto('/#login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('.form-card form button.primary-button').click()
  const nav = page.getByRole('navigation', { name: navName })
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: assignedTab }).click()

  const caseFor = (itemId: number) => page.locator(`[data-testid="assigned-case"][data-item-id="${itemId}"]`)
  const first = caseFor(fixtureItems[0].item_id)
  const second = caseFor(fixtureItems[1].item_id)
  await expect(page.locator('[data-testid="assigned-case"]')).toHaveCount(2)

  await expectState(first, false)
  await expectState(second, false)

  await first.locator('.item-toggle').click()
  await expectState(first, true)
  await expectState(second, false)
  await second.locator('.item-toggle').click()
  await expectState(first, true)
  await expectState(second, true)

  await first.getByLabel(statusLabel).selectOption('IN_PROGRESS')
  await first.getByLabel(noteLabel).fill(note)
  await first.getByRole('button', { name: saveButton }).click()
  await expect(page.getByRole('status')).toContainText(updatedNotice)
  await expect(first.getByText(note)).toBeVisible()
  await expect(first.locator('.request-card-status')).toHaveText(inProgressLabel)
  await expectState(first, true)
  await expectState(second, true)

  await first.locator('.item-toggle').click()
  await expectState(first, false)
  await expectState(second, true)
  await expect(second.getByLabel(statusLabel)).toBeVisible()

  await page.reload()
  await nav.getByRole('button', { name: assignedTab }).click()
  await expect(page.locator('[data-testid="assigned-case"]')).toHaveCount(2)
  await expectState(first, false)
  await expectState(second, false)
})
