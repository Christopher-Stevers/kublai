CREATE TABLE IF NOT EXISTS kublai_material_sort_preference (
  organization_id uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
  scope varchar(255) NOT NULL,
  settings jsonb NOT NULL,
  custom boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, scope)
);
