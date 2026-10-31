import {
  type AuthenticationCreds,
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "baileys";

export interface KeyValueStorage {
  delete: (key: string) => Promise<boolean>;
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  put: <T>(key: string, value: T) => Promise<void>;
}

function keyName(type: string, id: string, prefix: string): string {
  return prefix ? `${prefix}:key:${type}:${id}` : `key:${type}:${id}`;
}

function credsKey(prefix: string): string {
  return prefix ? `${prefix}:creds` : "creds";
}

/** Baileys auth state kept in key-value storage. `prefix` may be `""` for legacy keys. */
export async function useKeyValueAuthState(
  storage: KeyValueStorage,
  prefix = ""
): Promise<{
  state: { creds: AuthenticationCreds; keys: SignalKeyStore };
  saveCreds: () => Promise<void>;
}> {
  const stored = await storage.get<string>(credsKey(prefix));
  const creds = stored ? readCreds(stored) : initAuthCreds();

  async function getKeys<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[]
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    const out: { [id: string]: SignalDataTypeMap[T] } = {};
    await Promise.all(
      ids.map(async (id) => {
        const raw = await storage.get<string>(keyName(type, id, prefix));
        if (raw === undefined) {
          return;
        }
        const parsed: unknown = JSON.parse(raw, BufferJSON.reviver);
        const check = signalValueCheck(type);
        if (check(parsed)) {
          out[id] = parsed;
        } else {
          // One bad row should not stop message handling. Baileys treats the key as missing.
          console.warn(
            `[whatsapp] stored ${type} key ${id} is malformed; skipping it`
          );
        }
      })
    );
    return out;
  }

  async function setKeys(data: SignalDataSet): Promise<void> {
    const ops: Promise<unknown>[] = [];
    for (const type of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
      const bucket = data[type];
      for (const [id, value] of Object.entries(bucket ?? {})) {
        const key = keyName(type, id, prefix);
        ops.push(
          value
            ? storage.put(key, JSON.stringify(value, BufferJSON.replacer))
            : storage.delete(key)
        );
      }
    }
    await Promise.all(ops);
  }

  return {
    saveCreds: async () => {
      await storage.put(
        credsKey(prefix),
        JSON.stringify(creds, BufferJSON.replacer)
      );
    },
    state: {
      creds,
      keys: makeCacheableSignalKeyStore({ get: getKeys, set: setKeys }),
    },
  };
}

function isAuthenticationCreds(value: unknown): value is AuthenticationCreds {
  return (
    typeof value === "object" &&
    value !== null &&
    "noiseKey" in value &&
    "signedIdentityKey" in value &&
    "signedPreKey" in value &&
    "registrationId" in value &&
    typeof value.registrationId === "number"
  );
}

/**
 * Reads stored credentials. A malformed entry throws rather than starting fresh,
 * because fresh credentials would force the device to be linked again.
 */
function readCreds(stored: string): AuthenticationCreds {
  const parsed: unknown = JSON.parse(stored, BufferJSON.reviver);
  if (!isAuthenticationCreds(parsed)) {
    throw new Error(
      "Stored WhatsApp credentials are malformed. Re-link the device."
    );
  }
  return parsed;
}

type SignalCheck<T extends keyof SignalDataTypeMap> = (
  value: unknown
) => value is SignalDataTypeMap[T];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array;

/**
 * One check per Baileys key type. Byte and string types are checked exactly.
 * Protobuf-backed types only get an object check, since Baileys owns their shape.
 */
const signalChecks: { [K in keyof SignalDataTypeMap]-?: SignalCheck<K> } = {
  "app-state-sync-key": (
    value
  ): value is SignalDataTypeMap["app-state-sync-key"] => isObject(value),
  "app-state-sync-version": (
    value
  ): value is SignalDataTypeMap["app-state-sync-version"] =>
    isObject(value) &&
    typeof value.version === "number" &&
    isBytes(value.hash) &&
    isObject(value.indexValueMap),
  "device-list": (value): value is SignalDataTypeMap["device-list"] =>
    Array.isArray(value) && value.every((v) => typeof v === "string"),
  "identity-key": isBytes,
  "lid-mapping": (value): value is SignalDataTypeMap["lid-mapping"] =>
    typeof value === "string",
  "pre-key": (value): value is SignalDataTypeMap["pre-key"] =>
    isObject(value) && isBytes(value.public) && isBytes(value.private),
  "sender-key": isBytes,
  "sender-key-memory": (
    value
  ): value is SignalDataTypeMap["sender-key-memory"] =>
    isObject(value) &&
    Object.values(value).every((v) => typeof v === "boolean"),
  session: isBytes,
  tctoken: (value): value is SignalDataTypeMap["tctoken"] =>
    isObject(value) && isBytes(value.token),
};

/**
 * The check for one key type. `signalChecks` has one entry per key type, typed
 * against the same map, so the entry for `type` is the check for `SignalDataTypeMap[T]`.
 * TypeScript cannot see that through a generic index, which is the only assertion here.
 */
function signalValueCheck<T extends keyof SignalDataTypeMap>(
  type: T
): SignalCheck<T> {
  return signalChecks[type] as SignalCheck<T>;
}
