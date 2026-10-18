# Encrypted Journal

A local-first journaling app built with Vue 3 and TypeScript. Journal entries are encrypted in the browser before they are written to IndexedDB. The project is an MVP/prototype and has not had an independent security audit.

## Getting started

Requirements: Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Vite prints the local development URL when it starts. Useful validation commands:

```sh
pnpm test
pnpm build
pnpm test:e2e
```

The build runs `vue-tsc -b` before the Vite production build. Vitest runs specs under `tests/**/*.spec.ts` in jsdom. Playwright end-to-end tests use Chromium and run against a dedicated Vite server on port 4174. Install its browser once with `pnpm exec playwright install chromium`.

## Current functionality

- Create a vault with a master password.
- Display a generated recovery key once during setup and require confirmation to continue.
- Unlock an existing vault using its master password.
- Create, edit, list, autosave, and delete journal entries.
- Toggle a visual privacy mask while editing: completed text is hidden while the unfinished trailing word remains visible.
- Lock manually or after five minutes without activity.
- Store vault metadata and encrypted note records in browser IndexedDB.
- Export a versioned JSON backup containing the vault metadata and encrypted note records; restore it into a browser profile where that vault is not already present.
- Change the master password from the unlocked journal after verifying the current password.
- Recover a vault from its recovery key and set a new master password from the locked screen.
- Show browser-storage and recovery guidance in Settings.

The current interface is designed around one active vault at a time. Imported vaults are added without replacing local vaults; the recovery form lets the user select a local vault. On small screens the note list becomes a compact scrollable panel above the editor.

### Optional cross-browser sync

The optional Supabase email/password account UI is connected. Configure the client by setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the project-root `.env.local` file. These are public client credentials; never use a service-role or secret key in the browser. If either value is missing/invalid, the sync-account UI is hidden and local journaling continues to work.

Account registration/sign-in is separate from the journal master password and is managed in **Settings**. When signed in, journal saves and deletions automatically sync encrypted data; unlocking a vault also checks for remote changes. In a new browser, open **New browser? Restore or sync** from the unlock screen, sign in to the same sync account, download the encrypted vault metadata, and unlock it with the journal master password. **Sync now** remains available in Settings for a manual check or retry. Sync sends only wrapped vault metadata and AES-GCM-encrypted note records; it never sends plaintext, the unwrapped vault key, the master password, or the recovery key. Local-only use remains available.

The migration stores append-only change records, not plaintext journal fields. Note changes contain the existing encrypted note record; deletions are represented by tombstones. Row-level security scopes reads and inserts to the authenticated account, while update/delete permissions are revoked so concurrent device edits can form separate branches rather than silently replacing each other. When separate branches are detected, the sync client re-encrypts the other branch under a new note ID and keeps both versions as distinct, labeled notes on each device. These conflict copies remain local until edited; subsequent edits sync as independent notes.

Before using sync, apply `supabase/migrations/20261018000100_encrypted_sync.sql` in the Supabase SQL Editor. The migration has not been applied or validated against a live Supabase project. The Supabase service can observe account identity, vault/note IDs, change timing, and encrypted record sizes. Do not add the service-role key to the browser app; the client uses only the project URL and public anon key. Test with non-sensitive journal data first.

## Architecture

The app is a Vue single-page application. `src/App.vue` coordinates the vault state, selected note, draft, autosave, and lock timer. Components under `src/components/` render setup, recovery-key confirmation, the entry list, editor, and save status.

Data and cryptography are separated into layers:

- `src/services/crypto.service.ts`: key derivation, AES-GCM encryption/decryption, key wrapping, AAD construction, and schema checks.
- `src/services/vault.service.ts`: vault creation, unlock, recovery, and password rotation.
- `src/services/note.service.ts`: encrypt/decrypt and CRUD operations for notes.
- `src/services/backup.service.ts`: versioned encrypted backup serialization, validation, and atomic restore.
- `src/services/supabase.client.ts`: optional Supabase client configuration and email/password auth.
- `src/services/sync.service.ts`: explicit encrypted change-log sync, remote vault discovery, and branch preservation.
- `src/repositories/`: persistence access through Dexie.
- `src/db.ts`: IndexedDB database named `encrypted-journal-db`, with vault, note, pending-delete, outbox, and sync-state tables.
- `src/stores/vault.store.ts`: in-memory UI state indicating whether a vault is unlocked.
- `src/types/`: persisted vault and encrypted-note shapes.
- `tests/unit/crypto.service.spec.ts`: cryptographic behavior tests.
- `tests/integration/backup-flow.spec.ts`: backup export, validation, collision handling, and restore tests.
- `tests/integration/vault-flow.spec.ts`: vault and persistence integration tests.
- `tests/e2e/journal.e2e.ts`: browser flows for setup, autosave, lock/unlock, password change, recovery, and backup restore.

### Encryption and stored data

- A random 256-bit vault key encrypts note payloads using Web Crypto AES-256-GCM.
- The master password is processed with libsodium Argon2id to derive a wrapping key for the vault key.
- A separate random recovery key also wraps the vault key.
- AES-GCM uses a fresh 12-byte nonce per encryption and a 128-bit authentication tag.
- Additional authenticated data binds wrapped secrets to the vault ID and notes to the vault ID, note ID, and schema version.
- Note payloads are JSON-serialized and encrypted before repository persistence. IndexedDB stores note IDs, vault IDs, schema versions, nonces, and ciphertext; it does not store note title/body in plaintext.
- Vault metadata includes the salt and the password-/recovery-wrapped vault key. It does not contain the master password or the unwrapped vault key.

Encryption protects persisted note contents, not data while the app is unlocked: plaintext is present in application memory for editing. Browser compromise, malicious extensions, and compromised runtime assets are outside this prototype's protection. Users should keep the recovery key safe; browser storage may be cleared or evicted.

The editor's privacy mode is a visual shoulder-surfing aid, not an encryption feature. It masks completed non-whitespace characters in the rendered editor while preserving whitespace and leaves the trailing word visible only when the text ends in a letter, number, or underscore. The underlying input value remains plaintext in memory, and the editor temporarily uses a monospace font in this mode to keep the visual mask aligned with editable text.

### Backups

Use **Settings → Export encrypted backup** while unlocked to save a JSON file containing the vault's wrapped key metadata and encrypted note records. The current unsaved draft is flushed before export. Restore is available in Settings from the unlock screen or the journal; it validates the backup format and record structure, then adds the vault and notes in one IndexedDB transaction. It will not overwrite an existing vault or note ID. After restoring, unlock with the original master password. Keep backup files private and store them separately from the browser profile; they contain encrypted content but are not separately password-encrypted.

Settings reports whether a sync account is connected and displays remote vault records using a generic label and their technical IDs. The current client does not persist a last-successful-sync timestamp or expose a reliable pending-change count, so Settings does not claim either.

## Continuing development

Keep changes aligned with these project constraints:

1. Do not persist plaintext note content, passwords, or unwrapped vault keys.
2. Use fresh nonces for every AES-GCM encryption and preserve authenticated data binding.
3. Do not silently treat crypto or persistence failures as success. Keep user-visible failure states.
4. Preserve schema-version checks and update tests when persisted formats change.
5. Avoid logging passwords, recovery material, vault keys, or decrypted note bodies.

Suggested next work, roughly in priority order:

1. Apply and validate the Supabase migration against a development project, then exercise cross-browser sync and RLS with test data.
2. Obtain an independent security review before treating the app as production-ready.

## Known implementation notes

- The Argon2id implementation uses `libsodium-wrappers-sumo`; the base wrapper does not provide the required password-hashing API.
- Crypto code is loaded on demand instead of in the initial application bundle. Current production output is approximately 199 kB for the initial JavaScript (69 kB gzip) and 534 kB for the separately loaded libsodium chunk (189 kB gzip). Vite still warns about that deferred chunk exceeding its 500 kB threshold; replacing or weakening the Argon2id implementation solely to silence the warning is not recommended without a security review.
- The unused `libsodium-wrappers` base package was removed; Argon2id requires the sumo package.
- `unlockAnyVault` tries stored vaults in turn, which is adequate for the current single-vault UI but should be revisited for multi-vault support and explicit error handling.
- Inactivity lock currently uses a five-minute timeout. Pending autosaves are serialized and flushed before locking, changing notes, creating notes, or deleting a note. Failed writes keep the draft open and show an error rather than discarding it.
- The Supabase sync migration must be applied separately in a development project before automatic sync or the manual **Sync now** action can exchange data.
