import { db } from '../db'
import type { EncryptedNoteRecord } from '../types/note'

export class NoteRepository {
  async put(record: EncryptedNoteRecord): Promise<string> {
    await db.notes.put(record)
    return record.noteId
  }

  async get(noteId: string): Promise<EncryptedNoteRecord | undefined> {
    return db.notes.get(noteId)
  }

  async listByVault(vaultId: string): Promise<EncryptedNoteRecord[]> {
    return db.notes.where('vaultId').equals(vaultId).sortBy('noteId')
  }

  async delete(noteId: string): Promise<void> {
    await db.notes.delete(noteId)
  }
}

export const noteRepository = new NoteRepository()
