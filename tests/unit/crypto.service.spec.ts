import { describe, expect, it } from 'vitest'

import {
  SCHEMA_VERSION,
  base64ToBytes,
  bytesToBase64,
  createVaultMetadata,
  decryptNotePayload,
  deriveArgon2idKey,
  encryptNotePayload,
  encryptWithAesGcm,
  generateRecoveryKeyBytes,
  generateVaultKey,
  rewrapVaultKey,
  unlockVault,
  unlockWithRecoveryKey,
  unwrapSecret,
  wrapSecret,
} from '../../src/services/crypto.service'
import type { NotePayload } from '../../src/types/note'
import type { WrappedSecret } from '../../src/types/vault'

describe('crypto service', () => {
  it('produces different ciphertext for different plaintext inputs', async () => {
    const vaultKey = await generateVaultKey()
    const aad = new TextEncoder().encode('vault:test:note:1')

    const first = await encryptWithAesGcm(new TextEncoder().encode('first note'), vaultKey, aad)
    const second = await encryptWithAesGcm(new TextEncoder().encode('second note'), vaultKey, aad)

    expect(bytesToBase64(first.ciphertext)).not.toBe(bytesToBase64(second.ciphertext))
  })

  it('uses fresh nonces for every encryption operation', async () => {
    const vaultKey = await generateVaultKey()
    const aad = new TextEncoder().encode('vault:test:note:1')

    const first = await encryptWithAesGcm(new TextEncoder().encode('message one'), vaultKey, aad)
    const second = await encryptWithAesGcm(new TextEncoder().encode('message two'), vaultKey, aad)

    expect(bytesToBase64(first.iv)).not.toBe(bytesToBase64(second.iv))
  })

  it('rejects incorrect password attempts', async () => {
    const vaultId = 'vault-123'
    const masterPassword = 'correct-horse-battery-staple'
    const wrongPassword = 'wrong-password'

    const vaultMetadata = await createVaultMetadata(vaultId, masterPassword)
    const wrongKey = await deriveArgon2idKey(wrongPassword, base64ToBytes(vaultMetadata.salt))

    await expect(unwrapSecret(vaultMetadata.passwordWrappedKey, wrongKey, vaultId)).rejects.toThrow()
  })

  it('fails when ciphertext is modified', async () => {
    const vaultKey = await generateVaultKey()
    const wrapped = await wrapSecret(new TextEncoder().encode('sensitive data'), vaultKey, 'vault-42')
    const tamperedCiphertext = base64ToBytes(wrapped.ciphertext)
    tamperedCiphertext[tamperedCiphertext.length - 1] ^= 0x01

    const tampered: WrappedSecret = {
      ...wrapped,
      ciphertext: bytesToBase64(tamperedCiphertext),
    }

    await expect(unwrapSecret(tampered, vaultKey, 'vault-42')).rejects.toThrow()
  })

  it('rejects malformed or wrong-length nonces', async () => {
    const vaultKey = await generateVaultKey()
    const wrapped = await wrapSecret(new TextEncoder().encode('payload'), vaultKey, 'vault-malformed')
    const invalidWrapped = { ...wrapped, nonce: 'AAAA' }

    await expect(unwrapSecret(invalidWrapped, vaultKey, 'vault-malformed')).rejects.toThrow()
  })

  it('recovers the vault key with the correct recovery key', async () => {
    const vaultId = 'vault-recovery'
    const masterPassword = 'secure-password'
    const vaultMetadata = await createVaultMetadata(vaultId, masterPassword)
    const recoveryKey = await generateRecoveryKeyBytes()

    const recoveryWrapped = await wrapSecret(
      await unlockVault(vaultMetadata, masterPassword),
      recoveryKey,
      vaultId,
    )

    const recovered = await unwrapSecret(recoveryWrapped, recoveryKey, vaultId)
    const original = await unlockVault(vaultMetadata, masterPassword)

    expect(bytesToBase64(recovered)).toBe(bytesToBase64(original))
  })

  it('preserves access to all entries after a password change', async () => {
    const vaultId = 'vault-password-change'
    const oldPassword = 'old-password'
    const newPassword = 'new-password'
    const vaultKey = await generateVaultKey()
    const salt = new Uint8Array(16)
    crypto.getRandomValues(salt)

    const wrapped = await wrapSecret(vaultKey, await deriveArgon2idKey(oldPassword, salt), vaultId)
    const nextSalt = new Uint8Array(16)
    crypto.getRandomValues(nextSalt)
    const rewrapped = await rewrapVaultKey(vaultKey, vaultId, newPassword, nextSalt)

    const oldKey = await deriveArgon2idKey(oldPassword, salt)
    const newKey = await deriveArgon2idKey(newPassword, nextSalt)

    expect(bytesToBase64(await unwrapSecret(wrapped, oldKey, vaultId))).toBe(bytesToBase64(vaultKey))
    expect(bytesToBase64(await unwrapSecret(rewrapped, newKey, vaultId))).toBe(bytesToBase64(vaultKey))
  })

  it('keeps plaintext out of persisted records', async () => {
    const vaultKey = await generateVaultKey()
    const payload: NotePayload = {
      title: 'Private diary',
      body: 'This should stay encrypted',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: ['personal'],
    }

    const record = await encryptNotePayload(payload, vaultKey, 'vault-plain', 'note-plain')

    expect(record.ciphertext).toBeTruthy()
    expect(record.ciphertext).not.toContain('Private diary')
    expect(record.ciphertext).not.toContain('This should stay encrypted')
    expect(JSON.stringify(record)).not.toContain('Private diary')
  })

  it('decrypts and verifies note payloads correctly', async () => {
    const vaultKey = await generateVaultKey()
    const payload: NotePayload = {
      title: 'Sensitive note',
      body: 'Hidden content',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: ['work'],
    }

    const record = await encryptNotePayload(payload, vaultKey, 'vault-note', 'note-1')
    const decrypted = await decryptNotePayload(record, vaultKey)

    expect(decrypted).toEqual(payload)
    expect(record.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('rejects unsupported record versions safely', async () => {
    const vaultKey = await generateVaultKey()
    const payload: NotePayload = {
      title: 'Title',
      body: 'Body',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      tags: [],
    }

    const record = await encryptNotePayload(payload, vaultKey, 'vault-invalid-version', 'note-invalid')
    const invalidRecord = { ...record, schemaVersion: 99 }

    await expect(decryptNotePayload(invalidRecord, vaultKey)).rejects.toThrow('Unsupported note schema version')
  })

  it('uses the recovery key to unlock the vault metadata without the master password', async () => {
    const vaultId = 'vault-recovery-flow'
    const vaultMetadata = await createVaultMetadata(vaultId, 'master-password')
    const recoveryKey = await generateRecoveryKeyBytes()
    const recoveryWrapped = await wrapSecret(
      await unlockVault(vaultMetadata, 'master-password'),
      recoveryKey,
      vaultId,
    )

    const unlocked = await unwrapSecret(recoveryWrapped, recoveryKey, vaultId)
    const original = await unlockVault(vaultMetadata, 'master-password')

    expect(bytesToBase64(unlocked)).toBe(bytesToBase64(original))
  })

  it('fails when a recovery key is wrong', async () => {
    const vaultId = 'vault-bad-recovery'
    const vaultMetadata = await createVaultMetadata(vaultId, 'master-password')
    const correctRecoveryKey = await generateRecoveryKeyBytes()
    const wrongRecoveryKey = await generateRecoveryKeyBytes()

    const wrapped = await wrapSecret(await unlockVault(vaultMetadata, 'master-password'), correctRecoveryKey, vaultId)

    await expect(unwrapSecret(wrapped, wrongRecoveryKey, vaultId)).rejects.toThrow()
  })

  it('supports the recovery flow defined in the vault metadata', async () => {
    const vaultMetadata = await createVaultMetadata('vault-recovery-flow-2', 'strong-password')
    const recoveryKey = await generateRecoveryKeyBytes()
    const wrapped = await wrapSecret(await unlockVault(vaultMetadata, 'strong-password'), recoveryKey, 'vault-recovery-flow-2')
    const recovered = await unlockWithRecoveryKey({ ...vaultMetadata, recoveryWrappedKey: wrapped }, recoveryKey)
    const expected = await unlockVault(vaultMetadata, 'strong-password')

    expect(bytesToBase64(recovered)).toBe(bytesToBase64(expected))
  })
})
