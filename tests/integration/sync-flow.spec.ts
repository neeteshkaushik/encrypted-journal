import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type QueryResult = { data: Row[]; error: null };
  interface QueryBuilder {
    select: (columns: string) => QueryBuilder;
    eq: (column: string, value: string) => QueryBuilder;
    order: (column: string, options: { ascending: boolean }) => QueryBuilder;
    range: (from: number, to: number) => Promise<QueryResult>;
    limit: (count: number) => Promise<QueryResult>;
    insert: (values: Row) => Promise<{ error: null }>;
  }

  const tables: Record<string, Row[]> = {
    journal_vault_changes: [],
    journal_note_changes: [],
  };

  return {
    tables,
    reset() {
      tables.journal_vault_changes.length = 0;
      tables.journal_note_changes.length = 0;
    },
    client: {
      auth: {
        async getUser() {
          return { data: { user: { id: "test-user" } }, error: null };
        },
      },
      from(tableName: string): QueryBuilder {
        const filters: Array<[string, string]> = [];
        const builder: QueryBuilder = {
          select() {
            return builder;
          },
          eq(column, value) {
            filters.push([column, value]);
            return builder;
          },
          order() {
            return builder;
          },
          async range(from, to) {
            const rows = tables[tableName].filter((row) =>
              filters.every(([column, value]) => row[column] === value),
            );
            return { data: rows.slice(from, to + 1), error: null };
          },
          async limit(count) {
            const rows = tables[tableName].filter((row) =>
              filters.every(([column, value]) => row[column] === value),
            );
            return { data: rows.slice(0, count), error: null };
          },
          async insert(values) {
            tables[tableName].push({
              ...values,
              created_at: new Date().toISOString(),
            });
            return { error: null };
          },
        };
        return builder;
      },
    },
  };
});

vi.mock("../../src/services/supabase.client", () => ({
  getSupabaseClient: () => backend.client,
}));

import { db } from "../../src/db";
import { noteRepository } from "../../src/repositories/note.repository";
import { vaultRepository } from "../../src/repositories/vault.repository";
import {
  decryptNotePayload,
  encryptNotePayload,
} from "../../src/services/crypto.service";
import {
  deleteNote,
  loadEncryptedNote,
  saveEncryptedNote,
} from "../../src/services/note.service";
import {
  downloadRemoteVault,
  syncVault,
} from "../../src/services/sync.service";
import { createVault, unlockVault } from "../../src/services/vault.service";
import type { RemoteNoteChange } from "../../src/types/sync";

function notePayload(body: string) {
  return {
    title: "Shared title",
    body,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    tags: [],
  };
}

async function clearLocalDatabase() {
  await db.transaction(
    "rw",
    [
      db.vaults,
      db.notes,
      db.syncNoteStates,
      db.syncVaultStates,
      db.pendingNoteDeletions,
      db.syncOutbox,
    ],
    async () => {
      await db.vaults.clear();
      await db.notes.clear();
      await db.syncNoteStates.clear();
      await db.syncVaultStates.clear();
      await db.pendingNoteDeletions.clear();
      await db.syncOutbox.clear();
    },
  );
}

describe("encrypted optional sync", () => {
  beforeEach(async () => {
    await clearLocalDatabase();
    backend.reset();
  });

  it("uploads encrypted records and downloads them into another browser database", async () => {
    const created = await createVault("journal-password");
    const payload = notePayload("Private cross-browser content");
    await saveEncryptedNote(
      created.vault.vaultId,
      created.vaultKey,
      payload,
      "sync-note",
    );

    await expect(
      syncVault(created.vault.vaultId, created.vaultKey),
    ).resolves.toMatchObject({
      uploaded: 1,
      downloaded: 0,
    });
    expect(JSON.stringify(backend.tables)).not.toContain(payload.body);
    expect(backend.tables.journal_note_changes[0]).toMatchObject({
      encrypted_record: {
        noteId: "sync-note",
        vaultId: created.vault.vaultId,
      },
      is_deleted: false,
    });

    await clearLocalDatabase();
    await downloadRemoteVault(created.vault.vaultId);
    const vaultKey = await unlockVault(
      created.vault.vaultId,
      "journal-password",
    );
    await expect(
      syncVault(created.vault.vaultId, vaultKey),
    ).resolves.toMatchObject({ downloaded: 1 });
    await expect(
      loadEncryptedNote(created.vault.vaultId, "sync-note", vaultKey),
    ).resolves.toEqual(payload);
  });

  it("preserves divergent encrypted edits as a separate note on repeated syncs", async () => {
    const created = await createVault("journal-password");
    const noteId = "branch-note";
    const original = await saveEncryptedNote(
      created.vault.vaultId,
      created.vaultKey,
      notePayload("Original"),
      noteId,
    );
    await syncVault(created.vault.vaultId, created.vaultKey);
    const baseChange = backend.tables.journal_note_changes[0];
    expect(baseChange).toBeDefined();

    await clearLocalDatabase();
    await downloadRemoteVault(created.vault.vaultId);
    const otherDeviceKey = await unlockVault(
      created.vault.vaultId,
      "journal-password",
    );
    await syncVault(created.vault.vaultId, otherDeviceKey);
    await saveEncryptedNote(
      created.vault.vaultId,
      otherDeviceKey,
      notePayload("Device B edit"),
      noteId,
    );

    const remoteEdit = await encryptNotePayload(
      notePayload("Device A edit"),
      created.vaultKey,
      created.vault.vaultId,
      noteId,
    );
    backend.tables.journal_note_changes.push({
      owner_id: "test-user",
      vault_id: created.vault.vaultId,
      note_id: noteId,
      change_id: "concurrent-edit",
      parent_change_id: baseChange?.change_id,
      encrypted_record: remoteEdit,
      is_deleted: false,
      created_at: new Date(Date.now() + 1000).toISOString(),
    });

    const result = await syncVault(created.vault.vaultId, otherDeviceKey);
    expect(result.preserved).toBe(1);
    let notes = await noteRepository.listByVault(created.vault.vaultId);
    expect(notes).toHaveLength(2);
    const bodies = await Promise.all(
      notes.map(
        async (note) => (await decryptNotePayload(note, otherDeviceKey)).body,
      ),
    );
    expect(bodies).toEqual(
      expect.arrayContaining(["Device A edit", "Device B edit"]),
    );

    const secondSync = await syncVault(created.vault.vaultId, otherDeviceKey);
    expect(secondSync.preserved).toBe(0);
    notes = await noteRepository.listByVault(created.vault.vaultId);
    expect(notes).toHaveLength(2);
    await expect(
      loadEncryptedNote(created.vault.vaultId, original.noteId, otherDeviceKey),
    ).resolves.toBeDefined();

    const conflictCopy = notes.find((note) => note.noteId !== noteId);
    expect(conflictCopy).toBeDefined();
    const conflictState = await db.syncNoteStates.get([
      "test-user",
      created.vault.vaultId,
      conflictCopy!.noteId,
    ]);
    expect(conflictState?.conflictCopyFromChangeId).toBe("concurrent-edit");
    expect(
      backend.tables.journal_note_changes.filter(
        (change) => change.note_id === conflictCopy?.noteId,
      ),
    ).toHaveLength(0);
    await saveEncryptedNote(
      created.vault.vaultId,
      otherDeviceKey,
      notePayload("Edited preserved copy"),
      conflictCopy!.noteId,
    );
    expect(
      (await syncVault(created.vault.vaultId, otherDeviceKey)).uploaded,
    ).toBe(1);
    expect(
      backend.tables.journal_note_changes.filter(
        (change) => change.note_id === conflictCopy?.noteId,
      ),
    ).toHaveLength(1);
  });

  it("uploads a tombstone and preserves a concurrent remote edit", async () => {
    const created = await createVault("journal-password");
    const noteId = "deleted-note";
    await saveEncryptedNote(
      created.vault.vaultId,
      created.vaultKey,
      notePayload("Before delete"),
      noteId,
    );
    await syncVault(created.vault.vaultId, created.vaultKey);
    const baseChange = backend.tables.journal_note_changes[0];
    expect(baseChange).toBeDefined();

    const remoteEdit = await encryptNotePayload(
      notePayload("Concurrent surviving edit"),
      created.vaultKey,
      created.vault.vaultId,
      noteId,
    );
    backend.tables.journal_note_changes.push({
      owner_id: "test-user",
      vault_id: created.vault.vaultId,
      note_id: noteId,
      change_id: "concurrent-after-delete",
      parent_change_id: baseChange?.change_id,
      encrypted_record: remoteEdit,
      is_deleted: false,
      created_at: new Date(Date.now() + 1000).toISOString(),
    } satisfies RemoteNoteChange);

    await deleteNote(noteId);
    const result = await syncVault(created.vault.vaultId, created.vaultKey);

    expect(result.uploaded).toBe(1);
    expect(result.preserved).toBe(1);
    expect(await noteRepository.get(noteId)).toBeUndefined();
    const copies = await noteRepository.listByVault(created.vault.vaultId);
    expect(copies).toHaveLength(1);
    await expect(
      loadEncryptedNote(
        created.vault.vaultId,
        copies[0]!.noteId,
        created.vaultKey,
      ),
    ).resolves.toMatchObject({
      body: "Concurrent surviving edit",
    });
  });
});
