<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { User } from "@supabase/supabase-js";

import {
  getSupabaseClient,
  isSupabaseConfigured,
  signInToSync,
  signOutFromSync,
  signUpForSync,
} from "../services/supabase.client";
import {
  downloadRemoteVault,
  listRemoteVaults,
} from "../services/sync.service";
import type { SyncVaultOption } from "../types/sync";

const emit = defineEmits<{
  downloaded: [vaultId: string];
  authenticated: [value: boolean];
}>();
const props = withDefaults(defineProps<{ compact?: boolean }>(), {
  compact: false,
});
const configured = isSupabaseConfigured();
const email = ref("");
const password = ref("");
const user = ref<User | null>(null);
const busy = ref(false);
const mode = ref<"signin" | "signup">("signin");
const message = ref("");
const errorMessage = ref("");
const remoteVaults = ref<SyncVaultOption[]>([]);
const loadingVaults = ref(false);
const downloadingVaultId = ref("");
const copiedVaultId = ref("");
const copyError = ref("");
let authSubscription: { unsubscribe: () => void } | undefined;

async function refreshRemoteVaults() {
  if (!user.value) {
    remoteVaults.value = [];
    return;
  }

  loadingVaults.value = true;
  errorMessage.value = "";
  try {
    remoteVaults.value = await listRemoteVaults();
  } catch (cause) {
    errorMessage.value =
      cause instanceof Error
        ? cause.message
        : "Unable to list synchronized vaults.";
  } finally {
    loadingVaults.value = false;
  }
}

onMounted(async () => {
  if (!configured) {
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw error;
    }
    user.value = data.session?.user ?? null;
    emit("authenticated", !!user.value);
    if (user.value) {
      await refreshRemoteVaults();
    }
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        user.value = session?.user ?? null;
        emit("authenticated", !!user.value);
        window.setTimeout(() => void refreshRemoteVaults(), 0);
      },
    );
    authSubscription = listener.subscription;
  } catch {
    errorMessage.value = "Could not check the optional sync-account session.";
  }
});

onBeforeUnmount(() => {
  authSubscription?.unsubscribe();
});

async function submit() {
  busy.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    if (mode.value === "signin") {
      const signedInUser = await signInToSync(email.value, password.value);
      user.value = signedInUser;
      emit("authenticated", true);
      message.value =
        "Sync account connected. Changes sync automatically after they are saved.";
      await refreshRemoteVaults();
    } else {
      const result = await signUpForSync(email.value, password.value);
      user.value = result.needsEmailConfirmation ? null : result.user;
      emit("authenticated", !!user.value);
      message.value = result.needsEmailConfirmation
        ? "Check your email to confirm the sync account. Your journal remains local until sync is enabled."
        : "Sync account created. Changes sync automatically after they are saved.";
      if (user.value) {
        await refreshRemoteVaults();
      }
    }
    password.value = "";
  } catch (cause) {
    errorMessage.value =
      cause instanceof Error
        ? cause.message
        : "Unable to connect the sync account.";
  } finally {
    busy.value = false;
  }
}

async function signOut() {
  busy.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    await signOutFromSync();
    user.value = null;
    emit("authenticated", false);
    message.value =
      "Sync account disconnected. Local journal data remains on this device.";
  } catch (cause) {
    errorMessage.value =
      cause instanceof Error
        ? cause.message
        : "Unable to disconnect the sync account.";
  } finally {
    busy.value = false;
  }
}

async function downloadVault(vaultId: string) {
  downloadingVaultId.value = vaultId;
  errorMessage.value = "";
  message.value = "";
  try {
    await downloadRemoteVault(vaultId);
    message.value =
      "Encrypted vault metadata downloaded. Unlock it with the vault password to sync its notes automatically.";
    emit("downloaded", vaultId);
  } catch (cause) {
    errorMessage.value =
      cause instanceof Error ? cause.message : "Unable to download this vault.";
  } finally {
    downloadingVaultId.value = "";
  }
}

async function copyVaultId(vaultId: string) {
  copyError.value = "";
  try {
    await navigator.clipboard.writeText(vaultId);
    copiedVaultId.value = vaultId;
  } catch {
    copyError.value = "Could not access the clipboard. Select and copy the journal ID manually.";
  }
}
</script>

<template>
  <details
    v-if="configured"
    class="sync-account"
    aria-labelledby="sync-account-title"
    :open="!props.compact"
  >
    <summary class="sync-account-heading">
      <div>
        <p class="eyebrow">Optional</p>
        <h2 id="sync-account-title">Sync across browsers</h2>
      </div>
      <span class="sync-account-status">{{
        user ? "Connected" : "Not connected"
      }}</span>
    </summary>

    <template v-if="user">
      <p class="muted sync-account-copy">
        Signed in as {{ user.email }}. Changes sync automatically after they
        are saved. You can also use Sync now to check for changes from another
        browser.
      </p>
      <button
        class="secondary-btn"
        type="button"
        :disabled="busy"
        @click="signOut"
      >
        Sign out of sync account
      </button>
      <div class="sync-account-vaults">
        <div class="sync-account-vaults-heading">
          <strong>Encrypted vaults in this account</strong>
          <button
            class="text-button"
            type="button"
            :disabled="loadingVaults"
            @click="refreshRemoteVaults"
          >
            {{ loadingVaults ? "Refreshing…" : "Refresh" }}
          </button>
        </div>
        <p v-if="!remoteVaults.length && !loadingVaults" class="muted">
          No synced vaults found.
        </p>
        <div
          v-for="vault in remoteVaults"
          :key="vault.vaultId"
          class="sync-account-vault"
        >
          <div class="sync-account-vault-details">
            <strong>Encrypted journal</strong>
            <span>{{ vault.updatedAt ? `Updated ${new Date(vault.updatedAt).toLocaleDateString()}` : "Available in this account" }}</span>
            <code>{{ vault.vaultId }}</code>
          </div>
          <button
            class="secondary-btn"
            type="button"
            :disabled="busy || !!downloadingVaultId"
            @click="downloadVault(vault.vaultId)"
          >
            {{
              downloadingVaultId === vault.vaultId
                ? "Downloading…"
                : "Use on this browser"
            }}
          </button>
          <button class="quiet-btn" type="button" @click="copyVaultId(vault.vaultId)">
            {{ copiedVaultId === vault.vaultId ? "Copied" : "Copy ID" }}
          </button>
        </div>
        <p v-if="copyError" class="error-message" role="alert">{{ copyError }}</p>
      </div>
    </template>

    <template v-else>
      <p class="muted sync-account-copy">
        Sign in to sync encrypted notes across browsers. This password is
        separate from your journal master password. Signing in does not unlock
        the journal; an unlocked vault syncs automatically after saves and when
        you sign in or unlock it.
      </p>
      <form class="sync-account-form" @submit.prevent="submit">
        <label>
          Email
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            required
            :disabled="busy"
          />
        </label>
        <label>
          Sync account password
          <input
            v-model="password"
            type="password"
            :autocomplete="
              mode === 'signin' ? 'current-password' : 'new-password'
            "
            minlength="8"
            required
            :disabled="busy"
          />
        </label>
        <div class="sync-account-actions">
          <button class="primary-btn" type="submit" :disabled="busy">
            {{
              busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create sync account"
            }}
          </button>
          <button
            class="text-button"
            type="button"
            :disabled="busy"
            @click="
              mode = mode === 'signin' ? 'signup' : 'signin';
              message = '';
              errorMessage = '';
            "
          >
            {{
              mode === "signin"
                ? "Create an account"
                : "I already have an account"
            }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="message" class="success-message" role="status">{{ message }}</p>
    <p v-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </p>
  </details>
</template>
