import { expect, test } from '@playwright/test'

test('visitors land on the public home and reach sign-in and sign-up from it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'من المسودة إلى المناقشة' })).toBeVisible()
  await expect(page.locator('input[name="email"]')).toHaveCount(0)

  await page.getByRole('link', { name: 'سجّل الدخول لمتابعة طلباتك' }).click()
  await expect(page).toHaveURL(/#login$/)
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await expect(page.locator('.form-card form button.primary-button')).toHaveText(/دخول/)

  await page.getByRole('link', { name: 'العودة إلى الصفحة الرئيسية' }).click()
  await page.getByRole('link', { name: 'قدّم طلب خدمة' }).click()
  await expect(page).toHaveURL(/#signup$/)
  await expect(page.locator('.form-card form button.primary-button')).toHaveText(/إنشاء الحساب/)
})

test('the public catalog loads for signed-out visitors without any account', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'دكتوراه أكاديمي' })).toBeVisible()
  await expect(page.locator('.estimator-total strong')).not.toHaveText('—')
})

test('opening Morshed while the model is loading does not conflict with page status alerts', async ({ page }) => {
  await page.route('**/rest/v1/rpc/get_catalog*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"catalog down"}' }))
  await page.route(/https:\/\/([^/]+\.)?(huggingface\.co|hf\.co)\//, () => new Promise(() => {}))

  await page.goto('/')
  await expect(page.locator('.public-unavailable').first()).toBeVisible()
  const statusCount = await page.getByRole('status').count()
  expect(statusCount).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'فتح مرشد' }).click()
  const modelStatus = page.getByTestId('murshid-model-status')
  await expect(modelStatus).toBeVisible()
  await expect(modelStatus).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('status')).toHaveCount(statusCount)
})

test('opening Morshed when model download fails keeps a single page status element', async ({ page }) => {
  await page.route('**/rest/v1/rpc/get_catalog*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"catalog down"}' }))
  await page.route(/https:\/\/([^/]+\.)?(huggingface\.co|hf\.co)\//, (route) => route.abort())

  await page.goto('/')
  await expect(page.locator('.public-unavailable').first()).toBeVisible()

  await page.getByRole('button', { name: 'فتح مرشد' }).click()
  const modelStatus = page.getByTestId('murshid-model-status')
  await expect(modelStatus).toBeVisible()
  await expect(modelStatus).toHaveClass(/kb-model-failed/)
  const statusCount = await page.getByRole('status').count()
  expect(statusCount).toBeGreaterThan(0)
})
