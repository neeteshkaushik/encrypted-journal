import { noteRepository } from "../repositories/note.repository";
import { db } from "../db";
import type { EncryptedNoteRecord, NotePayload } from "../types/note";

export async function saveEncryptedNote(
  vaultId: string,
  vaultKey: Uint8Array,
  payload: NotePayload,
  noteId?: string,
): Promise<EncryptedNoteRecord> {
  const resolvedNoteId = noteId ?? crypto.randomUUID();
  const { encryptNotePayload } = await import("./crypto.service");
  const record = await encryptNotePayload(
    payload,
    vaultKey,
    vaultId,
    resolvedNoteId,
  );
  await noteRepository.put(record);
  return record;
}

export async function loadEncryptedNote(
  vaultId: string,
  noteId: string,
  vaultKey: Uint8Array,
): Promise<NotePayload> {
  const record = await noteRepository.get(noteId);

  if (!record || record.vaultId !== vaultId) {
    throw new Error("Note not found");
  }

  const { decryptNotePayload } = await import("./crypto.service");
  return decryptNotePayload(record, vaultKey);
}

export async function listNotesForVault(
  vaultId: string,
): Promise<EncryptedNoteRecord[]> {
  return noteRepository.listByVault(vaultId);
}

export async function deleteNote(noteId: string): Promise<void> {
  const record = await noteRepository.get(noteId);
  if (!record) {
    return;
  }

  await db.transaction("rw", db.notes, db.pendingNoteDeletions, async () => {
    await db.pendingNoteDeletions.put({
      vaultId: record.vaultId,
      noteId,
      createdAt: new Date().toISOString(),
    });
    await noteRepository.delete(noteId);
  });
}
