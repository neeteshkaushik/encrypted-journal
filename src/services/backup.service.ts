import { db } from '../db'
import { noteRepository } from '../repositories/note.repository'
import { vaultRepository } from '../repositories/vault.repository'
import type { EncryptedNoteRecord } from '../types/note'
import { SCHEMA_VERSION, type VaultRecord } from '../types/vault'

const BACKUP_FORMAT = 'encrypted-journal-backup'
const BACKUP_FORMAT_VERSION = 1

interface EncryptedJournalBackup {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  exportedAt: string
  vault: VaultRecord
  notes: EncryptedNoteRecord[]
}

export interface RestoreBackupResult {
  vaultId: string
  noteCount: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isValidBase64(value: string, minimumLength = 1): boolean {
  try {
    return atob(value).length >= minimumLength
  } catch {
    return false
  }
}

function isWrappedSecret(value: unknown): boolean {
  if (!isObject(value) || !isNonEmptyString(value.nonce) || !isNonEmptyString(value.ciphertext)) {
    return false
  }

  return isValidBase64(value.nonce) && atob(value.nonce).length === 12 && isValidBase64(value.ciphertext, 16)
}

function isVaultRecord(value: unknown): value is VaultRecord {
  if (!isObject(value)) {
    return false
  }

  return (
    isNonEmptyString(value.vaultId) &&
    value.schemaVersion === SCHEMA_VERSION &&
    value.algorithm === 'argon2id13' &&
    isNonEmptyString(value.salt) &&
    isValidBase64(value.salt, 16) &&
    typeof value.opsLimit === 'number' &&
    Number.isSafeInteger(value.opsLimit) &&
    value.opsLimit > 0 &&
    typeof value.memLimit === 'number' &&
    Number.isSafeInteger(value.memLimit) &&
    value.memLimit > 0 &&
    isWrappedSecret(value.passwordWrappedKey) &&
    isWrappedSecret(value.recoveryWrappedKey) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  )
}

function isEncryptedNoteRecord(value: unknown, vaultId: string): value is EncryptedNoteRecord {
  if (!isObject(value)) {
    return false
  }

  return (
    isNonEmptyString(value.noteId) &&
    value.vaultId === vaultId &&
    value.schemaVersion === SCHEMA_VERSION &&
    isNonEmptyString(value.nonce) &&
    isValidBase64(value.nonce) &&
    atob(value.nonce).length === 12 &&
    isNonEmptyString(value.ciphertext) &&
    isValidBase64(value.ciphertext, 16)
  )
}

function parseBackup(json: string): EncryptedJournalBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }

  if (
    !isObject(parsed) ||
    parsed.format !== BACKUP_FORMAT ||
    parsed.formatVersion !== BACKUP_FORMAT_VERSION ||
    !isNonEmptyString(parsed.exportedAt) ||
    !isVaultRecord(parsed.vault) ||
    !Array.isArray(parsed.notes)
  ) {
    throw new Error('The selected file is not a supported Encrypted Journal backup.')
  }

  const vaultId = parsed.vault.vaultId
  if (!parsed.notes.every((note) => isEncryptedNoteRecord(note, vaultId))) {
    throw new Error('The backup contains invalid or unsupported encrypted notes.')
  }

  const notes = parsed.notes as EncryptedNoteRecord[]
  const noteIds = new Set(notes.map((note) => note.noteId))
  if (noteIds.size !== notes.length) {
    throw new Error('The backup contains duplicate note IDs.')
  }

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: parsed.exportedAt,
    vault: parsed.vault,
    notes,
  }
}

export async function exportEncryptedBackup(vaultId: string): Promise<string> {
  const vault = await vaultRepository.get(vaultId)
  if (!vault) {
    throw new Error('Vault not found.')
  }

  const notes = await noteRepository.listByVault(vaultId)
  const backup: EncryptedJournalBackup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    vault,
    notes,
  }

  return JSON.stringify(backup, null, 2)
}

export async function restoreEncryptedBackup(json: string): Promise<RestoreBackupResult> {
  const backup = parseBackup(json)

  await db.transaction('rw', db.vaults, db.notes, async () => {
    if (await db.vaults.get(backup.vault.vaultId)) {
      throw new Error('This backup has already been imported into this browser profile.')
    }

    for (const note of backup.notes) {
      if (await db.notes.get(note.noteId)) {
        throw new Error('A note ID in this backup is already in use. No backup data was imported.')
      }
    }

    await db.vaults.add(backup.vault)
    if (backup.notes.length) {
      await db.notes.bulkAdd(backup.notes)
    }
  })

  return { vaultId: backup.vault.vaultId, noteCount: backup.notes.length }
}
