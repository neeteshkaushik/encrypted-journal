import { expect, test } from '@playwright/test'

const initialPassword = 'correct horse battery staple'

async function createVault(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Use recovery key' })).toBeVisible()
  await expect(page.locator('.sync-connection-indicator')).toBeVisible()
  await expect(page.locator('.sync-connection-indicator')).toHaveText(/Sync (account connected|not connected|unavailable|status unavailable|status…)/)
  await expect(page.getByRole('heading', { name: 'Sync across browsers' })).toHaveCount(0)
  const unlockPassword = page.getByLabel('Master password')
  await expect(unlockPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(unlockPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide' }).click()
  await page.getByRole('button', { name: 'Create a vault' }).click()
  await page.getByLabel('Master password').fill(initialPassword)
  await expect(page.getByRole('button', { name: 'Create vault' })).toBeDisabled()
  await page.getByLabel('Confirm password').fill('different password')
  await expect(page.getByText('These passwords do not match.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create vault' })).toBeDisabled()
  await page.getByLabel('Confirm password').fill(initialPassword)
  await page.getByRole('button', { name: 'Create vault' }).click()

  const recoveryKey = (await page.locator('.recovery-box code').textContent())?.trim()
  if (!recoveryKey) {
    throw new Error('Vault setup did not display a recovery key')
  }

  await page.getByLabel('I have saved this recovery key in a safe place.').check()
  await page.getByRole('button', { name: 'Continue to journal' }).click()
  return recoveryKey
}

test('creates, autosaves, locks, and unlocks an edited journal entry', async ({ page }) => {
  await createVault(page)
  await expect(page.locator('.journal-sync-indicator')).toBeVisible()

  await page.getByLabel('Journal title').fill('A browser-tested entry')
  await page.getByLabel('Journal text').fill('This entry should survive a lock and reload.')
  await expect(page.locator('.save-status')).toHaveCount(0)

  await page.locator('summary[aria-label="More journal actions"]').click()
  await page.getByRole('button', { name: 'Lock journal' }).click()
  await expect(page.getByRole('heading', { name: 'Encrypted Journal' })).toBeVisible()

  await page.getByLabel('Master password').fill(initialPassword)
  await page.getByRole('button', { name: 'Unlock my journal' }).click()
  await expect(page.getByRole('button', { name: 'A browser-tested entry' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'A browser-tested entry' }).click()

  await expect(page.getByLabel('Journal title')).toHaveValue('A browser-tested entry')
  await expect(page.getByLabel('Journal text')).toHaveValue('This entry should survive a lock and reload.')
})

test('keeps the privacy mask aligned with the editor caret', async ({ page }) => {
  await createVault(page)
  const title = page.getByLabel('Journal title')
  const body = page.getByLabel('Journal text')
  await title.fill('A long masked journal title for alignment')
  await body.fill('Completed words wrap across several lines while the final unfinished word remains visible')
  await page.getByRole('button', { name: 'Privacy mode' }).click()

  const typography = await page.evaluate(() => {
    const styleOf = (selector: string) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`)
      const style = getComputedStyle(element)
      return ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
        .map((property) => style[property as keyof CSSStyleDeclaration])
    }

    return {
      title: [styleOf('.title-input'), styleOf('.title-mask')],
      body: [styleOf('.editor-body'), styleOf('.body-mask')],
    }
  })

  expect(typography.title[0]).toEqual(typography.title[1])
  expect(typography.body[0]).toEqual(typography.body[1])
})

test('keeps the editor usable without horizontal overflow on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createVault(page)

  await expect(page.getByLabel('Journal title')).toBeVisible()
  await expect(page.getByLabel('Journal text')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible()
  await page.getByRole('button', { name: 'Hide note list' }).click()
  await expect(page.getByRole('button', { name: 'Show note list' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible()
  await page.getByRole('button', { name: 'Show note list' }).click()
  await page.locator('summary[aria-label="More journal actions"]').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export encrypted backup' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to journal' }).click()

  const dimensions = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
})

test('changes password and recovers the vault using its recovery key', async ({ page }) => {
  test.setTimeout(120_000)
  const recoveryKey = await createVault(page)
  const replacementPassword = 'a different strong password'

  await page.getByLabel('Journal title').fill('Entry retained through recovery')
  await page.getByLabel('Journal text').fill('Encrypted content remains accessible.')
  await expect(page.locator('.save-status')).toHaveCount(0)

  await page.locator('summary[aria-label="More journal actions"]').click()
  await page.getByRole('button', { name: 'Change password' }).click()
  await page.getByLabel('Current master password').fill(initialPassword)
  await page.getByLabel('New master password').fill(replacementPassword)
  await page.getByLabel('Confirm new password').fill(replacementPassword)
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('status')).toHaveText('Master password updated.')

  await page.locator('summary[aria-label="More journal actions"]').click()
  await page.getByRole('button', { name: 'Lock journal' }).click()
  await page.getByRole('button', { name: 'Use recovery key' }).click()
  await page.getByLabel('Recovery key').fill(recoveryKey)
  await page.getByLabel('New master password').fill('recovered journal password')
  await page.getByLabel('Confirm new password').fill('recovered journal password')
  await page.getByRole('button', { name: 'Recover vault' }).click()

  await expect(page.getByRole('button', { name: 'Entry retained through recovery' })).toBeVisible({ timeout: 15_000 })
  await page.locator('summary[aria-label="More journal actions"]').click()
  await page.getByRole('button', { name: 'Lock journal' }).click()
  await page.getByLabel('Master password').fill('recovered journal password')
  await page.getByRole('button', { name: 'Unlock my journal' }).click()
  await expect(page.getByRole('button', { name: 'Entry retained through recovery' })).toBeVisible({ timeout: 15_000 })
})

test('exports an encrypted backup and restores it in a fresh browser profile', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await createVault(page)

  await page.getByLabel('Journal title').fill('Backup round-trip note')
  await page.getByLabel('Journal text').fill('Restored from the encrypted backup.')
  await expect(page.locator('.save-status')).toHaveCount(0)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('summary[aria-label="More journal actions"]').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Export encrypted backup' }).click()
  const download = await downloadPromise
  const backupPath = await download.path()
  if (!backupPath) {
    throw new Error('Backup download did not produce a file')
  }

  const { readFile } = await import('node:fs/promises')
  const backupContents = await readFile(backupPath, 'utf8')
  expect(backupContents).not.toContain('Backup round-trip note')
  expect(backupContents).not.toContain('Restored from the encrypted backup.')

  const cleanContext = await browser.newContext()
  try {
    const restorePage = await cleanContext.newPage()
    await restorePage.goto('/')
    await restorePage.getByRole('button', { name: 'New browser? Restore or sync' }).click()
    await restorePage.getByRole('button', { name: 'Restore encrypted backup' }).click()
    await restorePage.getByLabel('Choose an encrypted journal backup file').setInputFiles({
      name: 'journal-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupContents),
    })
    await expect(restorePage.getByRole('status')).toContainText('Backup restored (1 note)')

    await restorePage.getByRole('button', { name: 'Back to unlock' }).click()
    await restorePage.getByLabel('Master password').fill(initialPassword)
    await restorePage.getByRole('button', { name: 'Unlock my journal' }).click()
    await expect(restorePage.getByRole('button', { name: 'Backup round-trip note' })).toBeVisible({ timeout: 15_000 })
    await restorePage.getByRole('button', { name: 'Backup round-trip note' }).click()
    await expect(restorePage.getByLabel('Journal text')).toHaveValue('Restored from the encrypted backup.')
  } finally {
    await cleanContext.close()
  }
})
