import Dexie from 'dexie'

import type { EncryptedNoteRecord } from './types/note'
import type { VaultRecord } from './types/vault'

export class EncryptedJournalDatabase extends Dexie {
  vaults!: Dexie.Table<VaultRecord, string>
  notes!: Dexie.Table<EncryptedNoteRecord, string>

  constructor() {
    super('encrypted-journal-db')

    this.version(1).stores({
      vaults: 'vaultId, schemaVersion, createdAt',
      notes: 'noteId, vaultId, schemaVersion, createdAt',
    })
  }
}

export const db = new EncryptedJournalDatabase()
