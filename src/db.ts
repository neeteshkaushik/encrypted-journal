import Dexie from "dexie";

import type { EncryptedNoteRecord } from "./types/note";
import type {
  PendingNoteDeletion,
  SyncNoteState,
  SyncOutboxRecord,
  SyncVaultState,
} from "./types/sync";
import type { VaultRecord } from "./types/vault";

export class EncryptedJournalDatabase extends Dexie {
  vaults!: Dexie.Table<VaultRecord, string>;
  notes!: Dexie.Table<EncryptedNoteRecord, string>;
  syncNoteStates!: Dexie.Table<SyncNoteState, [string, string, string]>;
  syncVaultStates!: Dexie.Table<SyncVaultState, [string, string]>;
  pendingNoteDeletions!: Dexie.Table<PendingNoteDeletion, [string, string]>;
  syncOutbox!: Dexie.Table<SyncOutboxRecord, string>;

  constructor() {
    super("encrypted-journal-db");

    this.version(1).stores({
      vaults: "vaultId, schemaVersion, createdAt",
      notes: "noteId, vaultId, schemaVersion, createdAt",
    });

    this.version(2).stores({
      vaults: "vaultId, schemaVersion, createdAt",
      notes: "noteId, vaultId, schemaVersion, createdAt",
      syncNoteStates: "[ownerId+vaultId+noteId], ownerId, vaultId, noteId",
      syncVaultStates: "[ownerId+vaultId], ownerId, vaultId",
      pendingNoteDeletions: "[vaultId+noteId], vaultId, noteId",
      syncOutbox: "changeId, vaultId, kind",
    });
  }
}

export const db = new EncryptedJournalDatabase();
