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
