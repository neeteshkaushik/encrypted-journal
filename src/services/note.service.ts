import { noteRepository } from '../repositories/note.repository'
import { encryptNotePayload, decryptNotePayload } from './crypto.service'
import type { EncryptedNoteRecord, NotePayload } from '../types/note'

export async function saveEncryptedNote(
  vaultId: string,
  vaultKey: Uint8Array,
  payload: NotePayload,
  noteId?: string,
): Promise<EncryptedNoteRecord> {
  const resolvedNoteId = noteId ?? crypto.randomUUID()
  const record = await encryptNotePayload(payload, vaultKey, vaultId, resolvedNoteId)
  await noteRepository.put(record)
  return record
}

export async function loadEncryptedNote(
  vaultId: string,
  noteId: string,
  vaultKey: Uint8Array,
): Promise<NotePayload> {
  const record = await noteRepository.get(noteId)

  if (!record || record.vaultId !== vaultId) {
    throw new Error('Note not found')
  }

  return decryptNotePayload(record, vaultKey)
}

export async function listNotesForVault(vaultId: string): Promise<EncryptedNoteRecord[]> {
  return noteRepository.listByVault(vaultId)
}

export async function deleteNote(noteId: string): Promise<void> {
  await noteRepository.delete(noteId)
}
