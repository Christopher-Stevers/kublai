// @ts-nocheck
import { Replicache } from "replicache";
import { Replicache as PreviousReplicache } from "previous-replicache";
import {
  makeMaterialListMutators,
  MATERIAL_LIST_INDEXES,
} from "../../../src/lib/replicache-material-list";
import { MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION } from "../../../src/lib/replicache-schema";

const instances = new Map();
Object.assign(window, {
  syncFixture: {
    async open(version, name) {
      const Constructor = version === "old" ? PreviousReplicache : Replicache;
      const rep = new Constructor({
        name,
        schemaVersion: MATERIAL_LIST_REPLICACHE_SCHEMA_VERSION,
        indexes: MATERIAL_LIST_INDEXES,
        mutators: makeMaterialListMutators(),
        pullURL: "/pull",
        pushURL: "/push",
        pullInterval: null,
        pushDelay: 50,
        logLevel: "error",
      });
      instances.set(name, rep);
      await rep.query(() => null);
      return { database: rep.idbName, group: await rep.clientGroupID };
    },
    async read(name) {
      return instances.get(name).query((tx) => tx.get("materialListItem/item"));
    },
    async quantity(name, quantity) {
      await instances
        .get(name)
        .mutate.updateItemQuantity({
          materialListId: "list",
          itemId: "item",
          quantity,
        });
    },
    async pull(name) {
      await instances.get(name).pull({ now: true });
    },
    async push(name) {
      await instances.get(name).push({ now: true });
    },
    async pending(name) {
      return instances.get(name).experimentalPendingMutations();
    },
    async close(name) {
      await instances.get(name).close();
      instances.delete(name);
    },
  },
});
