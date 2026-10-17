import type { EncryptedNoteRecord, NotePayload } from '../types/note'
import { SCHEMA_VERSION, type VaultMetadata, type WrappedSecret } from '../types/vault'

export { SCHEMA_VERSION }
export const ARGON2ID_ALGORITHM = 'argon2id13' as const

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
let sodiumPromise: ReturnType<typeof loadSodium> | undefined

async function loadSodium() {
  const { default: sodium } = await import('libsodium-wrappers-sumo')
  await sodium.ready
  return sodium
}

async function getSodium() {
  sodiumPromise ??= loadSodium()
  return sodiumPromise
}

function normalizeBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(bytes.length)
  normalized.set(bytes)
  return normalized
}

export function generateRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  return normalizeBytes(crypto.getRandomValues(new Uint8Array(length)))
}

export function bytesToBase64(bytes: Uint8Array): string {
  const normalized = normalizeBytes(bytes)
  let binary = ''
  for (const byte of normalized) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return normalizeBytes(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

export async function ensureSodiumReady(): Promise<void> {
  await getSodium()
}

export async function generateVaultKey(): Promise<Uint8Array> {
  return generateRandomBytes(32)
}

export async function generateRecoveryKeyBytes(): Promise<Uint8Array> {
  return generateRandomBytes(32)
}

export async function deriveArgon2idKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium()

  const derived = sodium.crypto_pwhash(
    32,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )

  return Uint8Array.from(derived)
}

export async function derivePasswordKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return deriveArgon2idKey(password, salt)
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  if (keyBytes.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key')
  }

  const normalizedKey = normalizeBytes(keyBytes)
  return crypto.subtle.importKey('raw', normalizedKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptWithAesGcm(
  plaintext: Uint8Array,
  keyMaterial: Uint8Array,
  additionalData: Uint8Array,
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const key = await importAesKey(keyMaterial)
  const iv = generateRandomBytes(12)
  const normalizedPlaintext = normalizeBytes(plaintext)
  const normalizedAdditionalData = normalizeBytes(additionalData)

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: normalizedAdditionalData, tagLength: 128 },
    key,
    normalizedPlaintext,
  )

  return {
    iv,
    ciphertext: normalizeBytes(new Uint8Array(ciphertextBuffer)),
  }
}

export async function decryptWithAesGcm(
  ciphertext: Uint8Array,
  keyMaterial: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (nonce.length !== 12) {
    throw new Error('Invalid nonce length: AES-GCM requires a 12-byte nonce')
  }

  const normalizedNonce = normalizeBytes(nonce)
  const normalizedCiphertext = normalizeBytes(ciphertext)
  const normalizedAdditionalData = normalizeBytes(additionalData)
  const key = await importAesKey(keyMaterial)
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: normalizedNonce, additionalData: normalizedAdditionalData, tagLength: 128 },
    key,
    normalizedCiphertext,
  )

  return normalizeBytes(new Uint8Array(plaintextBuffer))
}

export function buildAad(prefix: string, vaultId: string, recordId: string): Uint8Array {
  return textEncoder.encode(`${prefix}:${vaultId}:${recordId}:${SCHEMA_VERSION}`)
}

export function buildVaultAad(vaultId: string): Uint8Array {
  return textEncoder.encode(`${vaultId}:${SCHEMA_VERSION}:vault`)
}

export async function wrapSecret(
  plaintext: Uint8Array,
  keyMaterial: Uint8Array,
  vaultId: string,
): Promise<WrappedSecret> {
  const { iv, ciphertext } = await encryptWithAesGcm(plaintext, keyMaterial, buildVaultAad(vaultId))

  return {
    nonce: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  }
}

export async function unwrapSecret(
  wrapped: WrappedSecret,
  keyMaterial: Uint8Array,
  vaultId: string,
): Promise<Uint8Array> {
  const nonce = base64ToBytes(wrapped.nonce)
  const ciphertext = base64ToBytes(wrapped.ciphertext)

  if (nonce.length !== 12) {
    throw new Error('Invalid wrapped secret nonce length')
  }

  return decryptWithAesGcm(ciphertext, keyMaterial, nonce, buildVaultAad(vaultId))
}

export async function encryptNotePayload(
  payload: NotePayload,
  vaultKey: Uint8Array,
  vaultId: string,
  noteId: string,
): Promise<EncryptedNoteRecord> {
  const plaintext = textEncoder.encode(JSON.stringify(payload))
  const aad = buildAad('note', vaultId, noteId)
  const { iv, ciphertext } = await encryptWithAesGcm(plaintext, vaultKey, aad)

  return {
    noteId,
    vaultId,
    schemaVersion: SCHEMA_VERSION,
    nonce: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  }
}

export async function decryptNotePayload(
  record: EncryptedNoteRecord,
  vaultKey: Uint8Array,
): Promise<NotePayload> {
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Unsupported note schema version')
  }

  const nonce = base64ToBytes(record.nonce)
  const ciphertext = base64ToBytes(record.ciphertext)

  if (nonce.length !== 12) {
    throw new Error('Invalid note nonce length')
  }

  const plaintext = await decryptWithAesGcm(
    ciphertext,
    vaultKey,
    nonce,
    buildAad('note', record.vaultId, record.noteId),
  )

  const parsed = JSON.parse(textDecoder.decode(plaintext)) as NotePayload

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Malformed note payload')
  }

  return parsed
}

export async function createVaultMetadata(
  vaultId: string,
  masterPassword: string,
  recoveryKeyOverride?: Uint8Array,
): Promise<VaultMetadata> {
  const sodium = await getSodium()
  const salt = generateRandomBytes(sodium.crypto_pwhash_SALTBYTES)
  const vaultKey = await generateVaultKey()
  const passwordKey = await deriveArgon2idKey(masterPassword, salt)
  const passwordWrappedKey = await wrapSecret(vaultKey, passwordKey, vaultId)
  const recoveryKey = recoveryKeyOverride ?? (await generateRecoveryKeyBytes())
  const recoveryWrappedKey = await wrapSecret(vaultKey, recoveryKey, vaultId)

  return {
    vaultId,
    schemaVersion: SCHEMA_VERSION,
    algorithm: ARGON2ID_ALGORITHM,
    salt: bytesToBase64(salt),
    opsLimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    memLimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    passwordWrappedKey,
    recoveryWrappedKey,
  }
}

export async function unlockVault(
  vaultMetadata: VaultMetadata,
  password: string,
): Promise<Uint8Array> {
  const salt = base64ToBytes(vaultMetadata.salt)
  const passwordKey = await deriveArgon2idKey(password, salt)
  return unwrapSecret(vaultMetadata.passwordWrappedKey, passwordKey, vaultMetadata.vaultId)
}

export async function unlockWithRecoveryKey(
  vaultMetadata: VaultMetadata,
  recoveryKey: Uint8Array,
): Promise<Uint8Array> {
  return unwrapSecret(vaultMetadata.recoveryWrappedKey, recoveryKey, vaultMetadata.vaultId)
}

export async function rewrapVaultKey(
  vaultKey: Uint8Array,
  vaultId: string,
  nextPassword: string,
  nextSalt: Uint8Array,
): Promise<WrappedSecret> {
  const nextPasswordKey = await deriveArgon2idKey(nextPassword, nextSalt)
  return wrapSecret(vaultKey, nextPasswordKey, vaultId)
}

export function isSupportedVaultVersion(version: number): boolean {
  return version === SCHEMA_VERSION
}

export function assertValidWrappedSecret(wrapped: WrappedSecret): void {
  if (!wrapped?.nonce || !wrapped?.ciphertext) {
    throw new Error('Malformed wrapped secret')
  }

  if (base64ToBytes(wrapped.nonce).length !== 12) {
    throw new Error('Invalid wrapped secret nonce length')
  }
}
