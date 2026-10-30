-- research_catalog_001: run only through scripts/migrate-research.cjs with an explicit schema.
CREATE TABLE IF NOT EXISTS research_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE records ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','reviewed','uncertain'));
ALTER TABLE records ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS reviewer_id text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE records ADD COLUMN IF NOT EXISTS date_start integer;
ALTER TABLE records ADD COLUMN IF NOT EXISTS date_end integer;
ALTER TABLE records ADD COLUMN IF NOT EXISTS source_provenance jsonb;
ALTER TABLE records ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS source_object_id text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS source_retrieved_at timestamptz;
ALTER TABLE records ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE records ALTER COLUMN object_type_id DROP NOT NULL, ALTER COLUMN museum_name DROP NOT NULL,
 ALTER COLUMN museum_city DROP NOT NULL, ALTER COLUMN museum_country DROP NOT NULL,
 ALTER COLUMN museum_number DROP NOT NULL, ALTER COLUMN date_culture_period DROP NOT NULL,
 ALTER COLUMN materials DROP NOT NULL, ALTER COLUMN dimensions DROP NOT NULL;
ALTER TABLE records ALTER COLUMN inscribed DROP NOT NULL, ALTER COLUMN imagery DROP NOT NULL;
ALTER TABLE inscriptions ALTER COLUMN language DROP NOT NULL, ALTER COLUMN script DROP NOT NULL, ALTER COLUMN translation DROP NOT NULL;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS user_id text;
CREATE TABLE IF NOT EXISTS research_memberships(collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE, record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE, PRIMARY KEY(collection_id,record_id));
INSERT INTO research_memberships SELECT collection_id,id FROM records WHERE collection_id IN (SELECT id FROM collections) AND NOT EXISTS(SELECT 1 FROM research_migrations WHERE version='research_catalog_001') ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS research_memberships_record ON research_memberships(record_id);
CREATE UNIQUE INDEX IF NOT EXISTS research_source_identity ON records(source_provider,source_object_id) WHERE source_provider IS NOT NULL AND source_object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS research_records_dates ON records(date_start,date_end);
CREATE INDEX IF NOT EXISTS research_records_sort ON records(created_at,id);
CREATE INDEX IF NOT EXISTS research_records_updated ON records(updated_at,id);
CREATE INDEX IF NOT EXISTS research_records_title ON records(item_name,id);
CREATE INDEX IF NOT EXISTS research_records_owner ON records(user_id);
CREATE INDEX IF NOT EXISTS research_records_filters ON records(museum_name,review_status,source_provider);
CREATE OR REPLACE FUNCTION research_metadata(r records) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(r.item_name,'')||' '||coalesce(r.hhw_identifier,'')||' '||coalesce(r.museum_name,'')||' '||coalesce(r.museum_department,'')||' '||coalesce(r.museum_city,'')||' '||coalesce(r.museum_country,'')||' '||coalesce(r.museum_number,'')||' '||coalesce(r.museum_description,'')||' '||coalesce(r.date_culture_period,'')||' '||coalesce(r.dating_basis,'')||' '||coalesce(r.issuing_authority,'')||' '||coalesce(r.production_place,'')||' '||coalesce(r.findspot,'')||' '||coalesce(r.acquisition_date,'')||' '||coalesce(r.excavation_information,'')||' '||coalesce(r.materials,'')||' '||coalesce(r.technique,'')||' '||coalesce(r.dimensions,'')||' '||coalesce(r.thickness,'')||' '||coalesce(r.weight,'')||' '||coalesce(r.scientific_testing,'')||' '||coalesce(r.imagery_description,'')||' '||coalesce(r.bibliography,'')||' '||coalesce(r.image_copyright_details,'')||' '||coalesce(r.source_provider,'')||' '||coalesce(r.source_object_id,'')
$$;
ALTER TABLE records ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE OR REPLACE FUNCTION research_search_vector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple',
    research_metadata(NEW) || ' ' ||
    coalesce((SELECT name FROM object_types WHERE id=NEW.object_type_id), '') || ' ' ||
    coalesce((SELECT string_agg(coalesce(content,'') || ' ' || coalesce(translation,''), ' ')
      FROM inscriptions WHERE record_id=NEW.id), '')
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS research_search_vector ON records;
CREATE TRIGGER research_search_vector BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION research_search_vector();
UPDATE records SET search_vector=to_tsvector('simple',research_metadata(records)) WHERE search_vector IS NULL;
CREATE INDEX IF NOT EXISTS research_metadata_fts ON records USING gin(search_vector);
CREATE INDEX IF NOT EXISTS research_inscription_fts ON inscriptions USING gin(to_tsvector('simple',coalesce(content,'')||' '||coalesce(translation,'')));
CREATE INDEX IF NOT EXISTS research_inscription_record ON inscriptions(record_id);
CREATE TABLE IF NOT EXISTS research_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL,owner_id text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),sequence bigserial,action text NOT NULL,summary text NOT NULL,snapshot jsonb);
CREATE INDEX IF NOT EXISTS research_history_record ON research_history(record_id,created_at DESC,id);
CREATE OR REPLACE FUNCTION research_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec records; rid uuid; snap jsonb; actor text; inscription_changed boolean;
BEGIN
 IF TG_TABLE_NAME='records' THEN
   IF TG_OP='DELETE' THEN rec:=OLD; ELSE rec:=NEW; END IF;
 ELSE
   IF TG_OP='DELETE' THEN rid:=OLD.record_id; ELSE rid:=NEW.record_id; END IF;
   -- Run after the child write, so parent search and snapshots see its final text.
   -- No-op inscription updates still receive history without invalidating review.
   IF TG_OP='UPDATE' THEN
     inscription_changed := (to_jsonb(NEW)-ARRAY['id','record_id','created_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['id','record_id','created_at']);
   ELSE
     inscription_changed := true;
   END IF;
   UPDATE records SET
     review_status=CASE WHEN inscription_changed AND review_status='reviewed' THEN 'draft' ELSE review_status END,
     reviewer_id=CASE WHEN inscription_changed AND review_status='reviewed' THEN NULL ELSE reviewer_id END,
     reviewed_at=CASE WHEN inscription_changed AND review_status='reviewed' THEN NULL ELSE reviewed_at END,
     updated_at=now()
   WHERE id=rid RETURNING * INTO rec;
 END IF;
 IF rec.id IS NULL THEN RETURN NULL; END IF;
 actor:=coalesce(nullif(current_setting('research.actor',true),''),rec.user_id);
 snap:=jsonb_build_object('record',to_jsonb(rec)-'search_vector','inscriptions',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM inscriptions i WHERE record_id=rec.id),'[]'::jsonb));
 INSERT INTO research_history(record_id,owner_id,actor_id,action,summary,snapshot) VALUES(rec.id,rec.user_id,actor,lower(TG_OP),TG_TABLE_NAME||' '||lower(TG_OP),snap);
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION research_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE non_substantive text[] := ARRAY[
  'id','user_id','revision','created_at','updated_at','search_vector',
  'review_status','review_notes','reviewer_id','reviewed_at',
  'collection_id','image_source_url','image_type','image_copyright_details'
];
BEGIN
  -- This BEFORE trigger runs before research_search_vector alphabetically.
  -- Comparing stored fields, excluding the vector, makes that order immaterial.
  IF OLD.review_status='reviewed' AND
    (to_jsonb(NEW)-non_substantive) IS DISTINCT FROM (to_jsonb(OLD)-non_substantive) THEN
    NEW.review_status := 'draft';
    NEW.reviewer_id := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  NEW.revision := OLD.revision+1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS research_revision ON records;
CREATE TRIGGER research_revision BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION research_revision();
DROP TRIGGER IF EXISTS research_record_audit ON records;
CREATE TRIGGER research_record_audit AFTER INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION research_audit();
DROP TRIGGER IF EXISTS research_inscription_audit ON inscriptions;
CREATE TRIGGER research_inscription_audit AFTER INSERT OR UPDATE OR DELETE ON inscriptions FOR EACH ROW EXECUTE FUNCTION research_audit();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='inscriptions'::regclass AND conname='research_inscription_parent') THEN
 ALTER TABLE inscriptions ADD CONSTRAINT research_inscription_parent FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='records'::regclass AND conname='research_date_range') THEN
 ALTER TABLE records ADD CONSTRAINT research_date_range CHECK(date_start IS NULL OR date_end IS NULL OR date_start<=date_end);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS research_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text NOT NULL,source_type text NOT NULL,source_provider text,status text NOT NULL DEFAULT 'preview',payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS research_imports_owner ON research_imports(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS research_storage(id integer PRIMARY KEY CHECK(id=1),used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0));
INSERT INTO research_storage(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS research_blobs(id uuid PRIMARY KEY,owner_id text NOT NULL,driver text NOT NULL,original_key text NOT NULL,thumbnail_key text NOT NULL,byte_size bigint NOT NULL CHECK(byte_size>0),mime text NOT NULL,state text NOT NULL CHECK(state IN ('reserved','ready','deleting')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS research_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,blob_id uuid REFERENCES research_blobs(id),source_url text,caption text,credit text,license text,is_primary boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS research_images_record ON research_images(record_id);
CREATE UNIQUE INDEX IF NOT EXISTS research_images_primary ON research_images(record_id) WHERE is_primary;
INSERT INTO research_migrations(version) VALUES('research_catalog_001') ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS research_facets_material ON records(materials);
CREATE INDEX IF NOT EXISTS research_facets_place ON records(production_place);
CREATE INDEX IF NOT EXISTS research_facets_language ON inscriptions(language);
CREATE INDEX IF NOT EXISTS research_facets_script ON inscriptions(script);
