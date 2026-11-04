-- Personal museum research decisions are independent of catalog publication.
CREATE TABLE IF NOT EXISTS research_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_provider text NOT NULL CHECK (source_provider IN ('met','cleveland')),
  source_object_id text NOT NULL CHECK (source_object_id ~ '^[1-9][0-9]{0,9}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  museum_number text CHECK (length(museum_number)<=200),
  object_type text CHECK (length(object_type)<=200),
  date_label text CHECK (length(date_label)<=200),
  material text CHECK (length(material)<=300),
  license text CHECK (length(license)<=200),
  source_url text NOT NULL CHECK (length(source_url)<=2048),
  retrieved_at timestamptz NOT NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','kept','dismissed')),
  previous_decision text CHECK (previous_decision IN ('pending','kept','dismissed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (octet_length(title||coalesce(museum_number,'')||coalesce(object_type,'')||coalesce(date_label,'')||coalesce(material,'')||coalesce(license,'')||source_url)<=8192),
  UNIQUE(user_id,source_provider,source_object_id)
);
CREATE INDEX IF NOT EXISTS research_discoveries_owner_status ON research_discoveries(user_id,decision,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS research_discoveries_owner_recent ON research_discoveries(user_id,updated_at DESC,id);
INSERT INTO research_migrations(version) VALUES('discovery_decisions_003') ON CONFLICT DO NOTHING;
