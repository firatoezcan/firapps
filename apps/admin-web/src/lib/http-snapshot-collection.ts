import { createCollection, type Collection, type SyncConfig } from "@tanstack/react-db";

export type HttpSnapshotCollection<T extends object, TKey extends string | number> = {
  collection: Collection<T, TKey>;
  replaceRows: (rows: T[]) => Promise<void>;
};

export function createHttpSnapshotCollection<T extends object, TKey extends string | number>({
  getKey,
  id,
}: {
  getKey: (row: T) => TKey;
  id: string;
}): HttpSnapshotCollection<T, TKey> {
  type SyncParams = Parameters<SyncConfig<T, TKey>["sync"]>[0];

  let syncParams: SyncParams | null = null;
  const collection = createCollection<T, TKey>({
    getKey,
    id,
    sync: {
      sync: (params) => {
        syncParams = params;
        params.markReady();

        return () => {
          syncParams = null;
        };
      },
    },
  });

  return {
    collection,
    replaceRows: async (rows) => {
      await collection.preload();

      if (!syncParams) {
        throw new Error(`HTTP snapshot collection ${id} is not ready.`);
      }

      syncParams.begin({ immediate: true });
      syncParams.truncate();
      for (const row of rows) {
        syncParams.write({
          type: "insert",
          value: row,
        });
      }
      syncParams.commit();
    },
  };
}
