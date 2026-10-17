import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../src/db'
import { noteRepository } from '../../src/repositories/note.repository'
import { vaultRepository } from '../../src/repositories/vault.repository'
import { changePassword, createVault, recoverVault, unlockVault } from '../../src/services/vault.service'
import { saveEncryptedNote, loadEncryptedNote } from '../../src/services/note.service'

describe('vault lifecycle', () => {
  beforeEach(async () => {
    await db.vaults.clear()
    await db.notes.clear()
  })

  it('creates and unlocks a vault with a valid password', async () => {
    const password = 'correct-horse-battery-staple'
    const result = await createVault(password)

    expect(result.vault.vaultId).toBeTruthy()
    expect(result.vault.passwordWrappedKey.nonce).toBeTruthy()
    expect(result.recoveryKey.length).toBe(32)

    const unlockedKey = await unlockVault(result.vault.vaultId, password)
    expect(unlockedKey.length).toBe(32)
    expect(unlockedKey).toEqual(result.vaultKey)
  })

  it('rejects the wrong password and recovers with the valid recovery key', async () => {
    const password = 'strong-password'
    const result = await createVault(password)

    await expect(unlockVault(result.vault.vaultId, 'wrong-password')).rejects.toThrow()

    const recoveredKey = await recoverVault(result.vault.vaultId, result.recoveryKey)
    expect(recoveredKey).toEqual(result.vaultKey)
  })

  it('changes the password while preserving access to the vault key', async () => {
    const password = 'old-password'
    const nextPassword = 'new-password'
    const result = await createVault(password)

    const updatedVault = await changePassword(result.vault.vaultId, password, nextPassword)
    const unlockedKey = await unlockVault(updatedVault.vaultId, nextPassword)

    expect(unlockedKey).toEqual(result.vaultKey)
    expect(updatedVault.salt).not.toBe(result.vault.salt)
  })

  it('stores encrypted notes in the database without plaintext leakage', async () => {
    const password = 'secret-password'
    const result = await createVault(password)
    const notePayload = {
      title: 'Private note',
      body: 'This should stay encrypted in storage',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: ['work'],
    }

    const savedNote = await saveEncryptedNote(result.vault.vaultId, result.vaultKey, notePayload, 'note-1')
    const storedRecord = await noteRepository.get(savedNote.noteId)

    expect(storedRecord?.ciphertext).toBeTruthy()
    expect(storedRecord?.ciphertext).not.toContain('Private note')
    expect(storedRecord?.ciphertext).not.toContain('This should stay encrypted in storage')

    const decrypted = await loadEncryptedNote(result.vault.vaultId, savedNote.noteId, result.vaultKey)
    expect(decrypted).toEqual(notePayload)
  })

  it('persists vault metadata and is accessible through the repository', async () => {
    const password = 'vault-password'
    const result = await createVault(password)
    const storedVault = await vaultRepository.get(result.vault.vaultId)

    expect(storedVault).toBeDefined()
    expect(storedVault?.vaultId).toBe(result.vault.vaultId)
    expect(storedVault?.passwordWrappedKey).toEqual(result.vault.passwordWrappedKey)
  })
})
