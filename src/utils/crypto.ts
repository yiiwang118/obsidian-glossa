/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * Key-management helpers for Glossa.
 *
 * Approach: user-provided passphrase → PBKDF2 → AES-GCM 256.
 * - Salt is generated per-vault on first lock, stored in settings (NOT secret).
 * - A passphrase verifier (encrypted constant) lets us validate the typed passphrase
 *   without storing the passphrase or the key.
 * - The key is held in memory only; on plugin reload the user is prompted.
 *
 * Serialization format for an encrypted blob (base64):
 *   12-byte IV  ||  ciphertext+tag
 *
 * Compatibility note: `ENC_PREFIX` and `VERIFY_PLAIN` are intentionally kept on
 * their pre-rebrand values. Both are wire-level identifiers — changing them
 * would silently invalidate every existing encrypted data.json / chats.json /
 * checkpoints.json on disk (the user would need to re-enter their API keys and
 * would lose access to encrypted history). Brand changes never touch these. */

const ENC_PREFIX = 'NCENC1:';
const VERIFY_PLAIN = 'note-codex-verify-v1';

/** PBKDF2 iteration count.
 *
 *  History:
 *    - v0.1-v0.3: 200_000 (below OWASP 2023 recommendation of 600_000)
 *    - v0.4+: 600_000 (OWASP-current)
 *
 *  Users with v0.1-v0.3 verifier blobs will be auto-upgraded on next
 *  successful unlock: checkVerifierAndMaybeUpgrade reports the upgraded
 *  iterations + a new verifier the caller persists to settings. */
export const PBKDF2_ITERATIONS_CURRENT = 600_000;
export const PBKDF2_ITERATIONS_LEGACY = 200_000;

export interface SubtleKeyHandle {
  key: CryptoKey;
  saltBase64: string;
  /** Iteration count this handle was derived with. Used to detect when a
   *  silent re-derivation at the new count is warranted. */
  iterations: number;
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk) as AnyValue);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Derive a key from passphrase. New deriveKey calls use 600k iterations
 *  (current OWASP). Use `deriveKeyWithIterations` only for verifying legacy
 *  200k blobs during the upgrade migration. */
export async function deriveKey(passphrase: string, saltBase64?: string): Promise<SubtleKeyHandle> {
  return deriveKeyWithIterations(passphrase, saltBase64, PBKDF2_ITERATIONS_CURRENT);
}

/** Lower-level: derive with explicit iteration count. Exposed so the
 *  migration path can probe the 200k legacy count and re-derive at 600k. */
export async function deriveKeyWithIterations(
  passphrase: string,
  saltBase64: string | undefined,
  iterations: number,
): Promise<SubtleKeyHandle> {
  const salt = saltBase64 ? b64decode(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase) as AnyValue, { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as AnyValue, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt'],
  );
  return { key, saltBase64: b64encode(salt), iterations };
}

export async function encryptString(plain: string, handle: SubtleKeyHandle): Promise<string> {
  if (!plain) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as AnyValue },
    handle.key,
    new TextEncoder().encode(plain) as AnyValue,
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
  return ENC_PREFIX + b64encode(out);
}

export async function decryptString(enc: string, handle: SubtleKeyHandle): Promise<string> {
  if (!enc) return '';
  if (!enc.startsWith(ENC_PREFIX)) return enc;        // already plaintext (migration / non-strict mode)
  const raw = b64decode(enc.slice(ENC_PREFIX.length));
  const iv = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as AnyValue }, handle.key, ct as AnyValue);
  return new TextDecoder().decode(pt);
}

/** Strict decryption: when encryption is enabled, refuse to silently pass
 *  through unencrypted values. Used by the plugin's `decryptBlob` to
 *  surface file-level tampering (an attacker who can write to the vault
 *  swapping an encrypted value with a plaintext one to bypass auth would
 *  otherwise succeed without the user noticing). */
export async function decryptStringStrict(enc: string, handle: SubtleKeyHandle): Promise<string> {
  if (!enc) return '';
  if (!enc.startsWith(ENC_PREFIX)) {
    throw new Error('decryptStringStrict: value lacks encryption prefix while encryption is enabled — possible tampering or unmigrated data');
  }
  return decryptString(enc, handle);
}

export function isEncrypted(s: string | undefined): boolean {
  return !!(s && s.startsWith(ENC_PREFIX));
}

/** Produce a verifier blob — encrypt a known constant so we can validate the passphrase
 *  on unlock without keeping the passphrase. */
export async function makeVerifier(handle: SubtleKeyHandle): Promise<string> {
  return encryptString(VERIFY_PLAIN, handle);
}

export async function checkVerifier(verifier: string, handle: SubtleKeyHandle): Promise<boolean> {
  try { return (await decryptString(verifier, handle)) === VERIFY_PLAIN; }
  catch { return false; }
}

/** Try to unlock with the current iteration count; if that fails, try the
 *  legacy 200k count. On legacy-success, the caller MUST persist the
 *  upgraded verifier+handle so the next unlock uses the strong handle.
 *
 *  Returns { ok, handle, upgradedVerifier? }:
 *    - ok=true means passphrase is correct
 *    - upgradedVerifier is set ONLY when we upgraded from legacy → current
 *      iterations; the caller should `await saveData({ encryptionVerifier: upgradedVerifier })`
 */
export async function unlockWithUpgrade(
  passphrase: string,
  saltBase64: string,
  verifier: string,
): Promise<{ ok: boolean; handle?: SubtleKeyHandle; upgradedVerifier?: string }> {
  // Try current iteration count first.
  const cur = await deriveKeyWithIterations(passphrase, saltBase64, PBKDF2_ITERATIONS_CURRENT);
  if (await checkVerifier(verifier, cur)) {
    return { ok: true, handle: cur };
  }
  // Try legacy count.
  const legacy = await deriveKeyWithIterations(passphrase, saltBase64, PBKDF2_ITERATIONS_LEGACY);
  if (await checkVerifier(verifier, legacy)) {
    // Passphrase is correct but verifier was at legacy iterations. Re-derive
    // at current count and produce a fresh verifier the caller should save.
    const upgraded = await deriveKeyWithIterations(passphrase, saltBase64, PBKDF2_ITERATIONS_CURRENT);
    const upgradedVerifier = await makeVerifier(upgraded);
    return { ok: true, handle: upgraded, upgradedVerifier };
  }
  return { ok: false };
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
