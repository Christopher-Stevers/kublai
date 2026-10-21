CREATE TABLE IF NOT EXISTS kublai_diagnostic_count (
  organization_id uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT CURRENT_DATE,
  kind varchar(32) NOT NULL,
  feature varchar(24) NOT NULL,
  device varchar(12) NOT NULL,
  release varchar(40) NOT NULL,
  code varchar(24) NOT NULL,
  duration varchar(16) NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id,day,kind,feature,device,release,code,duration)
);
CREATE INDEX IF NOT EXISTS diagnostic_count_day_idx ON kublai_diagnostic_count(day);
