import type { EncryptedNoteRecord } from "./note";
import type { VaultRecord } from "./vault";

export interface RemoteNoteChange {
  owner_id: string;
  vault_id: string;
  note_id: string;
  change_id: string;
  parent_change_id: string | null;
  encrypted_record: EncryptedNoteRecord | null;
  is_deleted: boolean;
  created_at: string;
}

export interface RemoteVaultChange {
  owner_id: string;
  vault_id: string;
  change_id: string;
  parent_change_id: string | null;
  encrypted_record: VaultRecord;
  created_at: string;
}

export interface SyncNoteState {
  ownerId: string;
  vaultId: string;
  noteId: string;
  headChangeId: string;
  baselineRecord: EncryptedNoteRecord | null;
  preservedHeadIds: string[];
  localOnlyFromChangeId?: string;
  conflictCopyFromChangeId?: string;
}

export interface SyncVaultState {
  ownerId: string;
  vaultId: string;
  headChangeId: string;
  baselineRecord: VaultRecord;
}

export type SyncOutboxRecord =
  | {
      changeId: string;
      vaultId: string;
      kind: "vault";
      change: RemoteVaultChange;
    }
  | {
      changeId: string;
      vaultId: string;
      kind: "note";
      change: RemoteNoteChange;
    };

export interface PendingNoteDeletion {
  vaultId: string;
  noteId: string;
  createdAt: string;
}

export interface SyncVaultOption {
  vaultId: string;
  encryptedRecord: VaultRecord;
  changeId: string;
  updatedAt: string;
}

export interface SyncResult {
  downloaded: number;
  uploaded: number;
  preserved: number;
  deleted: number;
  warning?: string;
}
