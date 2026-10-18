import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../src/db'
import { noteRepository } from '../../src/repositories/note.repository'
import { vaultRepository } from '../../src/repositories/vault.repository'
import { exportEncryptedBackup, restoreEncryptedBackup } from '../../src/services/backup.service'
import { loadEncryptedNote, saveEncryptedNote } from '../../src/services/note.service'
import { createVault, unlockVault } from '../../src/services/vault.service'

describe('encrypted backup flow', () => {
  beforeEach(async () => {
    await db.vaults.clear()
    await db.notes.clear()
    await db.syncNoteStates.clear()
    await db.syncVaultStates.clear()
    await db.pendingNoteDeletions.clear()
    await db.syncOutbox.clear()
  })

  it('exports only encrypted note data and restores it into an empty database', async () => {
    const source = await createVault('backup-password')
    const payload = {
      title: 'Private backup title',
      body: 'Private backup body',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: ['private'],
    }
    await saveEncryptedNote(source.vault.vaultId, source.vaultKey, payload, 'backup-note')

    const backup = await exportEncryptedBackup(source.vault.vaultId)
    expect(backup).not.toContain(payload.title)
    expect(backup).not.toContain(payload.body)

    await db.vaults.clear()
    await db.notes.clear()
    await expect(vaultRepository.get(source.vault.vaultId)).resolves.toBeUndefined()

    const result = await restoreEncryptedBackup(backup)
    expect(result).toEqual({ vaultId: source.vault.vaultId, noteCount: 1 })

    const restoredVaultKey = await unlockVault(source.vault.vaultId, 'backup-password')
    await expect(loadEncryptedNote(source.vault.vaultId, 'backup-note', restoredVaultKey)).resolves.toEqual(payload)
  })

  it('does not overwrite an already imported vault', async () => {
    const source = await createVault('backup-password')
    const backup = await exportEncryptedBackup(source.vault.vaultId)

    await expect(restoreEncryptedBackup(backup)).rejects.toThrow('already been imported')
    await expect(vaultRepository.get(source.vault.vaultId)).resolves.toBeDefined()
  })

  it('rejects unsupported and malformed backup files', async () => {
    await expect(restoreEncryptedBackup('not-json')).rejects.toThrow('not valid JSON')
    await expect(
      restoreEncryptedBackup(JSON.stringify({ format: 'encrypted-journal-backup', formatVersion: 99 })),
    ).rejects.toThrow('not a supported')
  })

  it('rolls back the vault import if a note ID already belongs to another vault', async () => {
    const source = await createVault('source-password')
    await saveEncryptedNote(source.vault.vaultId, source.vaultKey, {
      title: 'Source',
      body: 'Source body',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: [],
    }, 'shared-note-id')
    const backup = await exportEncryptedBackup(source.vault.vaultId)

    await db.vaults.clear()
    await db.notes.clear()
    const other = await createVault('other-password')
    await saveEncryptedNote(other.vault.vaultId, other.vaultKey, {
      title: 'Existing',
      body: 'Existing body',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: [],
    }, 'shared-note-id')

    await expect(restoreEncryptedBackup(backup)).rejects.toThrow('already in use')
    await expect(vaultRepository.get(source.vault.vaultId)).resolves.toBeUndefined()
    await expect(noteRepository.get('shared-note-id')).resolves.toMatchObject({ vaultId: other.vault.vaultId })
  })
})
