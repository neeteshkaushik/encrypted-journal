export const SCHEMA_VERSION = 1 as const

export type VaultSchemaVersion = typeof SCHEMA_VERSION

export interface WrappedSecret {
  nonce: string
  ciphertext: string
}

export interface VaultRecord extends VaultMetadata {
  createdAt: string
  updatedAt: string
}

export interface VaultMetadata {
  vaultId: string
  schemaVersion: VaultSchemaVersion
  algorithm: 'argon2id13'
  salt: string
  opsLimit: number
  memLimit: number
  passwordWrappedKey: WrappedSecret
  recoveryWrappedKey: WrappedSecret
}
