import { db } from "../db";
import { noteRepository } from "../repositories/note.repository";
import { vaultRepository } from "../repositories/vault.repository";
import type { EncryptedNoteRecord } from "../types/note";
import type {
  PendingNoteDeletion,
  RemoteNoteChange,
  RemoteVaultChange,
  SyncNoteState,
  SyncOutboxRecord,
  SyncResult,
  SyncVaultOption,
} from "../types/sync";
import type { VaultRecord } from "../types/vault";
import { getSupabaseClient } from "./supabase.client";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVaultRecord(value: unknown, vaultId: string): value is VaultRecord {
  if (!isObject(value)) {
    return false;
  }

  const validBase64 = (candidate: unknown, minimumLength = 1) => {
    if (typeof candidate !== "string") {
      return false;
    }
    try {
      return atob(candidate).length >= minimumLength;
    } catch {
      return false;
    }
  };
  const wrappedSecret = (candidate: unknown) => {
    if (
      !isObject(candidate) ||
      typeof candidate.nonce !== "string" ||
      typeof candidate.ciphertext !== "string" ||
      !validBase64(candidate.nonce, 12) ||
      !validBase64(candidate.ciphertext, 16)
    ) {
      return false;
    }
    try {
      return atob(candidate.nonce).length === 12;
    } catch {
      return false;
    }
  };

  return (
    value.vaultId === vaultId &&
    value.schemaVersion === 1 &&
    value.algorithm === "argon2id13" &&
    validBase64(value.salt, 16) &&
    typeof value.opsLimit === "number" &&
    Number.isSafeInteger(value.opsLimit) &&
    value.opsLimit > 0 &&
    typeof value.memLimit === "number" &&
    Number.isSafeInteger(value.memLimit) &&
    value.memLimit > 0 &&
    wrappedSecret(value.passwordWrappedKey) &&
    wrappedSecret(value.recoveryWrappedKey) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isEncryptedNoteRecord(
  value: unknown,
  vaultId: string,
  noteId: string,
): value is EncryptedNoteRecord {
  if (!(
    isObject(value) &&
    value.vaultId === vaultId &&
    value.noteId === noteId &&
    value.schemaVersion === 1 &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string"
  )) {
    return false;
  }
  try {
    return (
      atob(value.nonce).length === 12 && atob(value.ciphertext).length >= 16
    );
  } catch {
    return false;
  }
}

function validateNoteChanges(
  value: unknown,
  vaultId: string,
): RemoteNoteChange[] {
  if (!Array.isArray(value)) {
    throw new Error("Supabase returned an invalid note-change response.");
  }

  return value.map((candidate): RemoteNoteChange => {
    if (
      !isObject(candidate) ||
      typeof candidate.owner_id !== "string" ||
      candidate.vault_id !== vaultId ||
      typeof candidate.note_id !== "string" ||
      typeof candidate.change_id !== "string" ||
      !(
        candidate.parent_change_id === null ||
        typeof candidate.parent_change_id === "string"
      ) ||
      typeof candidate.is_deleted !== "boolean" ||
      typeof candidate.created_at !== "string" ||
      (candidate.is_deleted
        ? candidate.encrypted_record !== null
        : !isEncryptedNoteRecord(
            candidate.encrypted_record,
            vaultId,
            candidate.note_id,
          ))
    ) {
      throw new Error("Supabase returned a malformed encrypted note change.");
    }

    return candidate as unknown as RemoteNoteChange;
  });
}

function validateVaultChanges(
  value: unknown,
  vaultId?: string,
): RemoteVaultChange[] {
  if (!Array.isArray(value)) {
    throw new Error("Supabase returned an invalid vault-change response.");
  }

  return value.map((candidate): RemoteVaultChange => {
    if (
      !isObject(candidate) ||
      typeof candidate.owner_id !== "string" ||
      typeof candidate.vault_id !== "string" ||
      (vaultId !== undefined && candidate.vault_id !== vaultId) ||
      typeof candidate.change_id !== "string" ||
      !(
        candidate.parent_change_id === null ||
        typeof candidate.parent_change_id === "string"
      ) ||
      typeof candidate.created_at !== "string" ||
      !isVaultRecord(candidate.encrypted_record, candidate.vault_id)
    ) {
      throw new Error("Supabase returned a malformed encrypted vault change.");
    }

    return candidate as unknown as RemoteVaultChange;
  });
}

function findHeads<
  T extends { change_id: string; parent_change_id: string | null },
>(changes: T[]): T[] {
  const parents = new Set(
    changes.flatMap((change) =>
      change.parent_change_id ? [change.parent_change_id] : [],
    ),
  );
  return changes.filter((change) => !parents.has(change.change_id));
}

function isAncestor<
  T extends { change_id: string; parent_change_id: string | null },
>(ancestorId: string, descendant: T, changes: T[]): boolean {
  let parentId = descendant.parent_change_id;
  while (parentId) {
    if (parentId === ancestorId) {
      return true;
    }
    parentId =
      changes.find((change) => change.change_id === parentId)
        ?.parent_change_id ?? null;
  }
  return false;
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function getUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error("Sign in to the sync account before syncing.");
  }
  return data.user.id;
}

async function readVaultChanges(
  ownerId: string,
  vaultId?: string,
): Promise<RemoteVaultChange[]> {
  const pageSize = 500;
  const results: unknown[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = getSupabaseClient()
      .from("journal_vault_changes")
      .select("*")
      .eq("owner_id", ownerId);
    if (vaultId) {
      query = query.eq("vault_id", vaultId);
    }
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("change_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw error;
    }
    if (!Array.isArray(data)) {
      throw new Error("Supabase returned an invalid vault-change response.");
    }
    results.push(...data);
    if (data.length < pageSize) {
      break;
    }
  }
  return validateVaultChanges(results, vaultId);
}

async function readNoteChanges(
  ownerId: string,
  vaultId: string,
): Promise<RemoteNoteChange[]> {
  const pageSize = 500;
  const results: unknown[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from("journal_note_changes")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("vault_id", vaultId)
      .order("created_at", { ascending: true })
      .order("change_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw error;
    }
    if (!Array.isArray(data)) {
      throw new Error("Supabase returned an invalid note-change response.");
    }
    results.push(...data);
    if (data.length < pageSize) {
      break;
    }
  }
  return validateNoteChanges(results, vaultId);
}

function toVaultChange(
  ownerId: string,
  record: VaultRecord,
  parentChangeId: string | null,
): RemoteVaultChange {
  return {
    owner_id: ownerId,
    vault_id: record.vaultId,
    change_id: crypto.randomUUID(),
    parent_change_id: parentChangeId,
    encrypted_record: record,
    created_at: new Date().toISOString(),
  };
}

function toNoteChange(
  ownerId: string,
  record: EncryptedNoteRecord | null,
  vaultId: string,
  noteId: string,
  parentChangeId: string | null,
): RemoteNoteChange {
  return {
    owner_id: ownerId,
    vault_id: vaultId,
    note_id: noteId,
    change_id: crypto.randomUUID(),
    parent_change_id: parentChangeId,
    encrypted_record: record,
    is_deleted: record === null,
    created_at: new Date().toISOString(),
  };
}

async function insertVaultChange(change: RemoteVaultChange): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("journal_vault_changes")
    .insert({
      owner_id: change.owner_id,
      vault_id: change.vault_id,
      change_id: change.change_id,
      parent_change_id: change.parent_change_id,
      encrypted_record: change.encrypted_record,
    });
  if (error) {
    throw error;
  }
}

async function insertNoteChange(change: RemoteNoteChange): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("journal_note_changes")
    .insert({
      owner_id: change.owner_id,
      vault_id: change.vault_id,
      note_id: change.note_id,
      change_id: change.change_id,
      parent_change_id: change.parent_change_id,
      encrypted_record: change.encrypted_record,
      is_deleted: change.is_deleted,
    });
  if (error) {
    throw error;
  }
}

async function acknowledgeOutboxItem(item: SyncOutboxRecord): Promise<void> {
  if (item.kind === "vault") {
    await db.transaction("rw", db.syncOutbox, db.syncVaultStates, async () => {
      await db.syncVaultStates.put({
        ownerId: item.change.owner_id,
        vaultId: item.change.vault_id,
        headChangeId: item.change.change_id,
        baselineRecord: item.change.encrypted_record,
      });
      await db.syncOutbox.delete(item.changeId);
    });
    return;
  }

  await db.transaction("rw", db.syncOutbox, db.syncNoteStates, async () => {
    const existing = await db.syncNoteStates.get([
      item.change.owner_id,
      item.change.vault_id,
      item.change.note_id,
    ]);
    await db.syncNoteStates.put({
      ownerId: item.change.owner_id,
      vaultId: item.change.vault_id,
      noteId: item.change.note_id,
      headChangeId: item.change.change_id,
      baselineRecord: item.change.encrypted_record,
      preservedHeadIds: existing?.preservedHeadIds ?? [],
      conflictCopyFromChangeId: existing?.conflictCopyFromChangeId,
    });
    await db.syncOutbox.delete(item.changeId);
  });
}

async function flushOutbox(ownerId: string, vaultId: string): Promise<void> {
  const outbox = await db.syncOutbox.where("vaultId").equals(vaultId).toArray();
  for (const item of outbox) {
    const itemOwner = item.change.owner_id;
    if (itemOwner !== ownerId) {
      continue;
    }

    const table =
      item.kind === "vault" ? "journal_vault_changes" : "journal_note_changes";
    const { data, error } = await getSupabaseClient()
      .from(table)
      .select("change_id")
      .eq("change_id", item.changeId)
      .limit(1);
    if (error) {
      throw error;
    }
    if (Array.isArray(data) && data.length > 0) {
      await acknowledgeOutboxItem(item);
      continue;
    }

    try {
      if (item.kind === "vault") {
        await insertVaultChange(item.change);
      } else {
        await insertNoteChange(item.change);
      }
      await acknowledgeOutboxItem(item);
    } catch (cause) {
      const { data: confirmed, error: checkError } = await getSupabaseClient()
        .from(table)
        .select("change_id")
        .eq("change_id", item.changeId)
        .limit(1);
      if (checkError) {
        throw checkError;
      }
      if (!Array.isArray(confirmed) || confirmed.length === 0) {
        throw cause;
      }
      await acknowledgeOutboxItem(item);
    }
  }
}

async function enqueueChange(
  change: RemoteVaultChange | RemoteNoteChange,
): Promise<void> {
  const item: SyncOutboxRecord =
    "note_id" in change
      ? {
          changeId: change.change_id,
          vaultId: change.vault_id,
          kind: "note",
          change,
        }
      : {
          changeId: change.change_id,
          vaultId: change.vault_id,
          kind: "vault",
          change,
        };
  await db.syncOutbox.put(item);
}

async function syncVaultRecord(
  ownerId: string,
  vault: VaultRecord,
): Promise<string | undefined> {
  await flushOutbox(ownerId, vault.vaultId);
  let changes = await readVaultChanges(ownerId, vault.vaultId);
  const heads = findHeads(changes);
  let state = await db.syncVaultStates.get([ownerId, vault.vaultId]);
  let warning: string | undefined;
  let untrackedConflict = false;

  if (!heads.length) {
    const change = toVaultChange(ownerId, vault, null);
    await enqueueChange(change);
    await flushOutbox(ownerId, vault.vaultId);
    state = {
      ownerId,
      vaultId: vault.vaultId,
      headChangeId: change.change_id,
      baselineRecord: vault,
    };
    await db.syncVaultStates.put(state);
    return undefined;
  }

  if (!state) {
    const preferred =
      heads.find((head) => sameRecord(head.encrypted_record, vault)) ??
      changes.find((change) => sameRecord(change.encrypted_record, vault)) ??
      heads[0];
    untrackedConflict = !sameRecord(preferred.encrypted_record, vault);
    state = {
      ownerId,
      vaultId: vault.vaultId,
      headChangeId: preferred.change_id,
      baselineRecord: preferred.encrypted_record,
    };
    await db.syncVaultStates.put(state);
  }

  if (!sameRecord(vault, state.baselineRecord)) {
    const change = toVaultChange(
      ownerId,
      vault,
      untrackedConflict ? null : state.headChangeId,
    );
    await enqueueChange(change);
    await flushOutbox(ownerId, vault.vaultId);
    state = { ...state, headChangeId: change.change_id, baselineRecord: vault };
    await db.syncVaultStates.put(state);
    changes = await readVaultChanges(ownerId, vault.vaultId);
    if (findHeads(changes).length > 1) {
      warning =
        "Concurrent vault password changes were detected. This device kept its current vault credentials; use the recovery key if another device changed them.";
    }
  } else {
    const descendants = findHeads(changes).filter((head) =>
      isAncestor(state?.headChangeId ?? "", head, changes),
    );
    if (descendants.length === 1) {
      const newest = descendants[0];
      if (newest) {
        await vaultRepository.put(newest.encrypted_record);
        state = {
          ownerId,
          vaultId: vault.vaultId,
          headChangeId: newest.change_id,
          baselineRecord: newest.encrypted_record,
        };
        await db.syncVaultStates.put(state);
      }
    } else if (findHeads(changes).length > 1) {
      warning =
        "Concurrent vault password changes were detected. This device kept its current vault credentials; use the recovery key if another device changed them.";
    }
  }

  return warning;
}

async function createConflictCopy(
  ownerId: string,
  vaultId: string,
  source: RemoteNoteChange,
  vaultKey: Uint8Array,
): Promise<boolean> {
  if (!source.encrypted_record) {
    throw new Error("Cannot preserve an empty note branch.");
  }

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${vaultId}:${source.change_id}`),
    ),
  );
  const hex = Array.from(digest.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const copyNoteId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16] ?? "8", 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  if (await db.syncNoteStates.get([ownerId, vaultId, copyNoteId])) {
    return false;
  }

  let copyRecord = await noteRepository.get(copyNoteId);
  if (!copyRecord) {
    const { decryptNotePayload, encryptNotePayload } =
      await import("./crypto.service");
    const payload = await decryptNotePayload(source.encrypted_record, vaultKey);
    copyRecord = await encryptNotePayload(
      payload,
      vaultKey,
      vaultId,
      copyNoteId,
    );
    await noteRepository.put(copyRecord);
  }
  await db.syncNoteStates.put({
    ownerId,
    vaultId,
    noteId: copyNoteId,
    headChangeId: source.change_id,
    baselineRecord: copyRecord,
    preservedHeadIds: [],
    localOnlyFromChangeId: source.change_id,
    conflictCopyFromChangeId: source.change_id,
  });
  return true;
}

function selectHead(
  heads: RemoteNoteChange[],
  state: SyncNoteState | undefined,
  allChanges: RemoteNoteChange[],
): RemoteNoteChange | undefined {
  if (!heads.length) {
    return undefined;
  }
  if (state) {
    const matching = heads.find(
      (head) => head.change_id === state.headChangeId,
    );
    if (matching) {
      return matching;
    }
    const descendants = heads
      .filter((head) => isAncestor(state.headChangeId, head, allChanges))
      .sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) ||
          left.change_id.localeCompare(right.change_id),
      );
    if (descendants.length) {
      return descendants[0];
    }
  }
  return [...heads].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.change_id.localeCompare(right.change_id),
  )[0];
}

async function syncNoteChanges(
  ownerId: string,
  vaultId: string,
  vaultKey: Uint8Array,
): Promise<
  Pick<SyncResult, "downloaded" | "uploaded" | "preserved" | "deleted">
> {
  await flushOutbox(ownerId, vaultId);
  let remoteChanges = await readNoteChanges(ownerId, vaultId);
  const remoteByNote = new Map<string, RemoteNoteChange[]>();
  for (const change of remoteChanges) {
    const list = remoteByNote.get(change.note_id) ?? [];
    list.push(change);
    remoteByNote.set(change.note_id, list);
  }

  const localNotes = await noteRepository.listByVault(vaultId);
  const pendingDeletes = await db.pendingNoteDeletions
    .where("vaultId")
    .equals(vaultId)
    .toArray();
  const noteIds = new Set([
    ...localNotes.map((note) => note.noteId),
    ...pendingDeletes.map((item: PendingNoteDeletion) => item.noteId),
    ...remoteChanges.map((change) => change.note_id),
  ]);
  let uploaded = 0;

  for (const noteId of noteIds) {
    const currentRecord =
      localNotes.find((note) => note.noteId === noteId) ?? null;
    const pendingDelete = pendingDeletes.find((item) => item.noteId === noteId);
    let state = await db.syncNoteStates.get([ownerId, vaultId, noteId]);
    const noteChanges = remoteByNote.get(noteId) ?? [];
    const heads = findHeads(noteChanges);

    if (!state && heads.length) {
      const preferred = currentRecord
        ? heads.find((head) => sameRecord(head.encrypted_record, currentRecord))
        : undefined;
      if (preferred) {
        state = {
          ownerId,
          vaultId,
          noteId,
          headChangeId: preferred.change_id,
          baselineRecord: preferred.encrypted_record,
          preservedHeadIds: [],
        };
        await db.syncNoteStates.put(state);
      }
    }

    if (pendingDelete) {
      const parentChangeId = state?.localOnlyFromChangeId
        ? null
        : (state?.headChangeId ?? null);
      const change = toNoteChange(
        ownerId,
        null,
        vaultId,
        noteId,
        parentChangeId,
      );
      await enqueueChange(change);
      await flushOutbox(ownerId, vaultId);
      uploaded += 1;
      await db.pendingNoteDeletions.delete([vaultId, noteId]);
      state = {
        ownerId,
        vaultId,
        noteId,
        headChangeId: change.change_id,
        baselineRecord: null,
        preservedHeadIds: state?.preservedHeadIds ?? [],
        conflictCopyFromChangeId: state?.conflictCopyFromChangeId,
      };
      await db.syncNoteStates.put(state);
    } else if (
      currentRecord &&
      (!state || !sameRecord(currentRecord, state.baselineRecord))
    ) {
      const parentChangeId = state?.localOnlyFromChangeId
        ? null
        : (state?.headChangeId ?? null);
      const change = toNoteChange(
        ownerId,
        currentRecord,
        vaultId,
        noteId,
        parentChangeId,
      );
      await enqueueChange(change);
      await flushOutbox(ownerId, vaultId);
      uploaded += 1;
      state = {
        ownerId,
        vaultId,
        noteId,
        headChangeId: change.change_id,
        baselineRecord: currentRecord,
        preservedHeadIds: state?.preservedHeadIds ?? [],
        conflictCopyFromChangeId: state?.conflictCopyFromChangeId,
      };
      await db.syncNoteStates.put(state);
    }
  }

  remoteChanges = await readNoteChanges(ownerId, vaultId);
  remoteByNote.clear();
  for (const change of remoteChanges) {
    const list = remoteByNote.get(change.note_id) ?? [];
    list.push(change);
    remoteByNote.set(change.note_id, list);
  }

  let downloaded = 0;
  let preserved = 0;
  let deleted = 0;
  for (const [noteId, noteChanges] of remoteByNote) {
    const heads = findHeads(noteChanges);
    let state = await db.syncNoteStates.get([ownerId, vaultId, noteId]);
    const selected = selectHead(heads, state, noteChanges);
    if (!selected) {
      continue;
    }

    const record = selected.encrypted_record;
    if (!state || selected.change_id !== state.headChangeId) {
      if (record) {
        await noteRepository.put(record);
        downloaded += 1;
      } else {
        await noteRepository.delete(noteId);
        deleted += 1;
      }
      state = {
        ownerId,
        vaultId,
        noteId,
        headChangeId: selected.change_id,
        baselineRecord: record,
        preservedHeadIds: state?.preservedHeadIds ?? [],
      };
    }

    const preservedHeadIds = new Set(state.preservedHeadIds);
    preservedHeadIds.add(selected.change_id);
    for (const branch of heads) {
      if (
        branch.change_id === selected.change_id ||
        preservedHeadIds.has(branch.change_id)
      ) {
        continue;
      }
      if (branch.encrypted_record) {
        if (await createConflictCopy(ownerId, vaultId, branch, vaultKey)) {
          preserved += 1;
        }
      }
      preservedHeadIds.add(branch.change_id);
    }

    await db.syncNoteStates.put({
      ...state,
      preservedHeadIds: [...preservedHeadIds],
    });
  }

  return { downloaded, uploaded, preserved, deleted };
}

export async function listRemoteVaults(): Promise<SyncVaultOption[]> {
  const ownerId = await getUserId();
  const changes = await readVaultChanges(ownerId);
  const grouped = new Map<string, RemoteVaultChange[]>();
  for (const change of changes) {
    const list = grouped.get(change.vault_id) ?? [];
    list.push(change);
    grouped.set(change.vault_id, list);
  }

  return [...grouped.entries()].flatMap(([vaultId, vaultChanges]) => {
    const latest = findHeads(vaultChanges).sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        left.change_id.localeCompare(right.change_id),
    )[0];
    return latest
      ? [
          {
            vaultId,
            encryptedRecord: latest.encrypted_record,
            changeId: latest.change_id,
            updatedAt: latest.created_at,
          },
        ]
      : [];
  });
}

export async function downloadRemoteVault(vaultId: string): Promise<void> {
  const ownerId = await getUserId();
  const changes = await readVaultChanges(ownerId, vaultId);
  const latest = findHeads(changes).sort(
    (left, right) =>
      right.created_at.localeCompare(left.created_at) ||
      left.change_id.localeCompare(right.change_id),
  )[0];
  if (!latest) {
    throw new Error("No synchronized vault was found for this account.");
  }
  if (await vaultRepository.get(vaultId)) {
    throw new Error("This vault already exists in this browser.");
  }

  await vaultRepository.put(latest.encrypted_record);
}

export async function syncVault(
  vaultId: string,
  vaultKey: Uint8Array,
): Promise<SyncResult> {
  const ownerId = await getUserId();
  const vault = await vaultRepository.get(vaultId);
  if (!vault) {
    throw new Error("Vault not found on this device.");
  }

  const warning = await syncVaultRecord(ownerId, vault);
  const noteResult = await syncNoteChanges(ownerId, vaultId, vaultKey);
  return { ...noteResult, warning };
}
