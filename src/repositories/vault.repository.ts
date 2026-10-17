import { db } from '../db'
import type { VaultRecord } from '../types/vault'

export class VaultRepository {
  async list(): Promise<VaultRecord[]> {
    return db.vaults.toArray()
  }

  async get(vaultId: string): Promise<VaultRecord | undefined> {
    return db.vaults.get(vaultId)
  }

  async put(record: VaultRecord): Promise<string> {
    await db.vaults.put(record)
    return record.vaultId
  }

  async update(vaultId: string, partial: Partial<VaultRecord>): Promise<void> {
    await db.vaults.update(vaultId, partial)
  }

  async delete(vaultId: string): Promise<void> {
    await db.vaults.delete(vaultId)
  }
}

export const vaultRepository = new VaultRepository()
