import {
  base64ToBytes,
  bytesToBase64,
  createVaultMetadata,
  deriveArgon2idKey,
  generateRandomBytes,
  generateRecoveryKeyBytes,
  unwrapSecret,
  wrapSecret,
} from './crypto.service'
import { vaultRepository } from '../repositories/vault.repository'
import type { VaultRecord } from '../types/vault'

export interface VaultSetupResult {
  vault: VaultRecord
  recoveryKey: Uint8Array
  vaultKey: Uint8Array
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function createVault(password: string): Promise<VaultSetupResult> {
  const vaultId = crypto.randomUUID()
  const recoveryKey = await generateRecoveryKeyBytes()
  const vaultMetadata = await createVaultMetadata(vaultId, password, recoveryKey)
  const vaultKey = await unwrapSecret(
    vaultMetadata.passwordWrappedKey,
    await deriveArgon2idKey(password, base64ToBytes(vaultMetadata.salt)),
    vaultId,
  )

  const record: VaultRecord = {
    ...vaultMetadata,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  await vaultRepository.put(record)

  return {
    vault: record,
    recoveryKey,
    vaultKey,
  }
}

export async function unlockVault(vaultId: string, password: string): Promise<Uint8Array> {
  const record = await vaultRepository.get(vaultId)

  if (!record) {
    throw new Error('Vault not found')
  }

  const salt = base64ToBytes(record.salt)
  const passwordKey = await deriveArgon2idKey(password, salt)
  return unwrapSecret(record.passwordWrappedKey, passwordKey, record.vaultId)
}

export async function unlockAnyVault(password: string): Promise<{ vault: VaultRecord; vaultKey: Uint8Array }> {
  const vaults = await vaultRepository.list()

  for (const vault of vaults) {
    try {
      const vaultKey = await unlockVault(vault.vaultId, password)
      return { vault, vaultKey }
    } catch {
      continue
    }
  }

  throw new Error('Invalid password')
}

export async function recoverVault(vaultId: string, recoveryKey: Uint8Array): Promise<Uint8Array> {
  const record = await vaultRepository.get(vaultId)

  if (!record) {
    throw new Error('Vault not found')
  }

  return unwrapSecret(record.recoveryWrappedKey, recoveryKey, record.vaultId)
}

export async function changePassword(vaultId: string, currentPassword: string, nextPassword: string): Promise<VaultRecord> {
  const record = await vaultRepository.get(vaultId)

  if (!record) {
    throw new Error('Vault not found')
  }

  const currentKey = await unlockVault(vaultId, currentPassword)
  const nextSalt = generateRandomBytes(16)
  const nextPasswordKey = await deriveArgon2idKey(nextPassword, nextSalt)
  const nextWrappedKey = await wrapSecret(currentKey, nextPasswordKey, vaultId)

  const updated: VaultRecord = {
    ...record,
    salt: bytesToBase64(nextSalt),
    opsLimit: record.opsLimit,
    memLimit: record.memLimit,
    passwordWrappedKey: nextWrappedKey,
    updatedAt: nowIso(),
  }

  await vaultRepository.update(vaultId, updated)
  return updated
}

export async function getVault(vaultId: string): Promise<VaultRecord | undefined> {
  return vaultRepository.get(vaultId)
}
