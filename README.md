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
- Show storage durability and recovery guidance on both locked and unlocked screens.

The current interface is designed around one active vault at a time. Imported vaults are added without replacing local vaults; the recovery form lets the user select a local vault. On small screens the note list becomes a compact scrollable panel above the editor.

## Architecture

The app is a Vue single-page application. `src/App.vue` coordinates the vault state, selected note, draft, autosave, and lock timer. Components under `src/components/` render setup, recovery-key confirmation, the entry list, editor, and save status.

Data and cryptography are separated into layers:

- `src/services/crypto.service.ts`: key derivation, AES-GCM encryption/decryption, key wrapping, AAD construction, and schema checks.
- `src/services/vault.service.ts`: vault creation, unlock, recovery, and password rotation.
- `src/services/note.service.ts`: encrypt/decrypt and CRUD operations for notes.
- `src/services/backup.service.ts`: versioned encrypted backup serialization, validation, and atomic restore.
- `src/repositories/`: persistence access through Dexie.
- `src/db.ts`: IndexedDB database named `encrypted-journal-db`, with `vaults` and `notes` tables.
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

Use **Export backup** while unlocked to save a JSON file containing the vault's wrapped key metadata and encrypted note records. The current unsaved draft is flushed before export. Restore is available on the locked screen; it validates the backup format and record structure, then adds the vault and notes in one IndexedDB transaction. It will not overwrite an existing vault or note ID. After restoring, unlock with the original master password. Keep backup files private and store them separately from the browser profile; they contain encrypted content but are not separately password-encrypted.

## Continuing development

Keep changes aligned with these project constraints:

1. Do not persist plaintext note content, passwords, or unwrapped vault keys.
2. Use fresh nonces for every AES-GCM encryption and preserve authenticated data binding.
3. Do not silently treat crypto or persistence failures as success. Keep user-visible failure states.
4. Preserve schema-version checks and update tests when persisted formats change.
5. Avoid logging passwords, recovery material, vault keys, or decrypted note bodies.

Suggested next work, roughly in priority order:

1. Review dependency/bundle size and obtain an independent security review before treating the app as production-ready.

## Known implementation notes

- The Argon2id implementation uses `libsodium-wrappers-sumo`; the base wrapper does not provide the required password-hashing API.
- Crypto code is loaded on demand instead of in the initial application bundle. Current production output is approximately 199 kB for the initial JavaScript (69 kB gzip) and 534 kB for the separately loaded libsodium chunk (189 kB gzip). Vite still warns about that deferred chunk exceeding its 500 kB threshold; replacing or weakening the Argon2id implementation solely to silence the warning is not recommended without a security review.
- The unused `libsodium-wrappers` base package was removed; Argon2id requires the sumo package.
- `unlockAnyVault` tries stored vaults in turn, which is adequate for the current single-vault UI but should be revisited for multi-vault support and explicit error handling.
- Inactivity lock currently uses a five-minute timeout. Pending autosaves are serialized and flushed before locking, changing notes, creating notes, or deleting a note. Failed writes keep the draft open and show an error rather than discarding it.
- There is no backend or account synchronization; data is local to the browser profile.
