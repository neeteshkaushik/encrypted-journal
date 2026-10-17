export interface NotePayload {
  title: string
  body: string
  createdAt: string
  updatedAt: string
  tags: string[]
  revision?: number
}

export interface EncryptedNoteRecord {
  noteId: string
  vaultId: string
  schemaVersion: number
  nonce: string
  ciphertext: string
}
