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
  prefix = "",
): Promise<{
  state: { creds: AuthenticationCreds; keys: SignalKeyStore };
  saveCreds: () => Promise<void>;
}> {
  const stored = await storage.get<string>(credsKey(prefix));
  const creds: AuthenticationCreds = stored
    ? (JSON.parse(stored, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  async function getKeys<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    const out: { [id: string]: SignalDataTypeMap[T] } = {};
    await Promise.all(
      ids.map(async (id) => {
        const raw = await storage.get<string>(keyName(type, id, prefix));
        if (raw !== undefined) {
          out[id] = JSON.parse(raw, BufferJSON.reviver) as SignalDataTypeMap[T];
        }
      }),
    );
    return out;
  }

  async function setKeys(data: SignalDataSet): Promise<void> {
    const ops: Promise<unknown>[] = [];
    for (const type of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
      const bucket = data[type];
      if (!bucket) continue;
      for (const [id, value] of Object.entries(bucket)) {
        const key = keyName(type, id, prefix);
        ops.push(
          value
            ? storage.put(key, JSON.stringify(value, BufferJSON.replacer))
            : storage.delete(key),
        );
      }
    }
    await Promise.all(ops);
  }

  return {
    saveCreds: async () => {
      await storage.put(
        credsKey(prefix),
        JSON.stringify(creds, BufferJSON.replacer),
      );
    },
    state: {
      creds,
      keys: makeCacheableSignalKeyStore({ get: getKeys, set: setKeys }),
    },
  };
}
