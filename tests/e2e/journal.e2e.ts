import { expect, test } from '@playwright/test'

const initialPassword = 'correct horse battery staple'

async function createVault(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/')
  await expect(page.getByLabel('Storage and recovery information')).toBeVisible()
  await page.getByRole('button', { name: 'Create new vault' }).click()
  await page.getByLabel('Master password').fill(initialPassword)
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

  await page.getByLabel('Journal title').fill('A browser-tested entry')
  await page.getByLabel('Journal text').fill('This entry should survive a lock and reload.')
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Encrypted Journal' })).toBeVisible()

  await page.getByLabel('Master password').fill(initialPassword)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('button', { name: 'A browser-tested entry' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'A browser-tested entry' }).click()

  await expect(page.getByLabel('Journal title')).toHaveValue('A browser-tested entry')
  await expect(page.getByLabel('Journal text')).toHaveValue('This entry should survive a lock and reload.')
})

test('keeps the editor usable without horizontal overflow on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createVault(page)

  await expect(page.getByLabel('Journal title')).toBeVisible()
  await expect(page.getByLabel('Journal text')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible()
  await expect(page.getByLabel('Storage and recovery information')).toBeVisible()

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
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Change password' }).click()
  await page.getByLabel('Current master password').fill(initialPassword)
  await page.getByLabel('New master password').fill(replacementPassword)
  await page.getByLabel('Confirm new password').fill(replacementPassword)
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('status')).toHaveText('Master password updated.')

  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await page.getByRole('button', { name: 'Forgot your password? Recover with your key' }).click()
  await page.getByLabel('Recovery key').fill(recoveryKey)
  await page.getByLabel('New master password').fill('recovered journal password')
  await page.getByLabel('Confirm new password').fill('recovered journal password')
  await page.getByRole('button', { name: 'Recover vault' }).click()

  await expect(page.getByRole('button', { name: 'Entry retained through recovery' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await page.getByLabel('Master password').fill('recovered journal password')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('button', { name: 'Entry retained through recovery' })).toBeVisible({ timeout: 15_000 })
})

test('exports an encrypted backup and restores it in a fresh browser profile', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await createVault(page)

  await page.getByLabel('Journal title').fill('Backup round-trip note')
  await page.getByLabel('Journal text').fill('Restored from the encrypted backup.')
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 15_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup' }).click()
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
    await restorePage.getByRole('button', { name: 'Restore from backup' }).click()
    await restorePage.getByLabel('Choose an encrypted journal backup file').setInputFiles({
      name: 'journal-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupContents),
    })
    await expect(restorePage.getByRole('status')).toContainText('Backup restored (1 note)')

    await restorePage.getByLabel('Master password').fill(initialPassword)
    await restorePage.getByRole('button', { name: 'Unlock' }).click()
    await expect(restorePage.getByRole('button', { name: 'Backup round-trip note' })).toBeVisible({ timeout: 15_000 })
    await restorePage.getByRole('button', { name: 'Backup round-trip note' }).click()
    await expect(restorePage.getByLabel('Journal text')).toHaveValue('Restored from the encrypted backup.')
  } finally {
    await cleanContext.close()
  }
})
