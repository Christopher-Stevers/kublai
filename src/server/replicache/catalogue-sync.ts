import { and, asc, eq } from "drizzle-orm";
import type {
  PatchOperation,
  PullRequestV1,
  PullResponseV1,
} from "replicache";

import { CATALOGUE_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";
import { formatSize } from "~/lib/size-utils";
import { pullSnapshot } from "./pull";
import {
  catalogs,
  categories,
  materials,
  partDefinitions,
  sizes,
  units,
} from "~/server/db/schema";

type ReplicacheUser = {
  id: string;
  organizationId: string | null;
};

export async function handleCatalogueReplicachePull(
  request: PullRequestV1,
  user: ReplicacheUser,
): Promise<PullResponseV1> {
  const organizationId = user.organizationId;
  if (!organizationId) throw new Error("User must belong to an organization");

  if (request.schemaVersion !== CATALOGUE_REPLICACHE_SCHEMA_VERSION) {
    return {
      error: "VersionNotSupported",
      versionType: "schema",
    };
  }
  if (request.pullVersion !== 1) {
    return { error: "VersionNotSupported", versionType: "pull" };
  }

  return pullSnapshot("catalogue", request, user, async (tx) => {
      const [catalogRows, materialRows, categoryRows, unitRows, partRows] =
        await Promise.all([
          tx
            .select({
              id: catalogs.id,
              name: catalogs.name,
              sortOrder: catalogs.sortOrder,
              organizationId: catalogs.organizationId,
            })
            .from(catalogs)
            .where(eq(catalogs.organizationId, organizationId))
            .orderBy(asc(catalogs.sortOrder), asc(catalogs.name)),
          tx
            .select({
              id: materials.id,
              name: materials.name,
              groupPath: materials.groupPath,
            })
            .from(materials)
            .where(eq(materials.organizationId, organizationId))
            .orderBy(asc(materials.name)),
          tx
            .select({
              id: categories.id,
              name: categories.name,
              sortOrder: categories.sortOrder,
              organizationId: categories.organizationId,
            })
            .from(categories)
            .where(eq(categories.organizationId, organizationId))
            .orderBy(asc(categories.sortOrder), asc(categories.name)),
          tx
            .select({
              id: units.id,
              code: units.code,
              displayName: units.displayName,
              kind: units.kind,
            })
            .from(units)
            .orderBy(asc(units.code)),
          tx
            .select({
              id: partDefinitions.id,
              displayName: partDefinitions.displayName,
              description: partDefinitions.description,
              imageUrl: partDefinitions.imageUrl,
              sizeLabel: partDefinitions.sizeLabel,
              materialId: partDefinitions.materialId,
              materialName: materials.name,
              sizeNominal: sizes.nominal,
              sizeUnitCode: units.code,
              catalogId: partDefinitions.catalogId,
              categoryId: partDefinitions.categoryId,
              sortOrder: partDefinitions.sortOrder,
              organizationId: partDefinitions.organizationId,
            })
            .from(partDefinitions)
            .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
            .leftJoin(units, eq(sizes.unitId, units.id))
            .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
            .where(
              and(
                eq(partDefinitions.isActive, true),
                eq(partDefinitions.organizationId, organizationId),
              ),
            )
            .orderBy(
              asc(partDefinitions.sortOrder),
              asc(partDefinitions.displayName),
              asc(partDefinitions.id),
            ),
        ]);

      const patch: PatchOperation[] = [{ op: "clear" }];

      for (const catalog of catalogRows) {
        patch.push({
          op: "put",
          key: `catalog/${catalog.id}`,
          value: catalog,
        });
      }

      for (const material of materialRows) {
        patch.push({
          op: "put",
          key: `catalogueMaterial/${material.id}`,
          value: material,
        });
      }

      for (const category of categoryRows) {
        patch.push({
          op: "put",
          key: `category/${category.id}`,
          value: category,
        });
      }

      for (const unit of unitRows) {
        patch.push({
          op: "put",
          key: `unit/${unit.id}`,
          value: unit,
        });
      }

      for (const part of partRows) {
        patch.push({
          op: "put",
          key: `cataloguePart/${part.id}`,
          value: {
            id: part.id,
            displayName: part.displayName,
            description: part.description,
            imageUrl: part.imageUrl,
            material: part.materialName,
            materialId: part.materialId,
            size:
              part.sizeLabel ??
              (part.sizeNominal && part.sizeUnitCode
                ? formatSize(Number(part.sizeNominal), part.sizeUnitCode)
                : null),
            sizeLabel: part.sizeLabel,
            sizeNominal: part.sizeNominal,
            sizeUnit: part.sizeUnitCode,
            catalogId: part.catalogId,
            categoryId: part.categoryId,
            sortOrder: part.sortOrder,
            isOrgSpecific: part.organizationId === organizationId,
          },
        });
      }

      return patch;
  });
}
