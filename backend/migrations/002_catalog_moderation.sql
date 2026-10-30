-- Publication approval is separate from scholarly review. Existing rows remain pending.
ALTER TABLE records ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'pending'
  CHECK (moderation_status IN ('pending','approved','changes_requested'));
ALTER TABLE records ADD COLUMN IF NOT EXISTS moderation_notes text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS moderated_by text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS moderated_at timestamptz;
ALTER TABLE inscriptions ALTER COLUMN serifs_present DROP NOT NULL,
  ALTER COLUMN stopmarks_present DROP NOT NULL;
CREATE INDEX IF NOT EXISTS research_records_moderation ON records(moderation_status,created_at,id);
CREATE TABLE IF NOT EXISTS research_roles (
  user_id text PRIMARY KEY REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('contributor','reviewer')),
  assigned_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS research_role_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  target_id text NOT NULL,
  old_role text NOT NULL,
  new_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION research_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE non_substantive text[] := ARRAY[
  'id','user_id','revision','created_at','updated_at','search_vector',
  'review_status','review_notes','reviewer_id','reviewed_at',
  'moderation_status','moderation_notes','moderated_by','moderated_at',
  'collection_id','image_source_url','image_type','image_copyright_details'
];
BEGIN
  IF (to_jsonb(NEW)-non_substantive) IS DISTINCT FROM (to_jsonb(OLD)-non_substantive) THEN
    IF OLD.review_status='reviewed' THEN
      NEW.review_status := 'draft';
      NEW.reviewer_id := NULL;
      NEW.reviewed_at := NULL;
    END IF;
    NEW.moderation_status := 'pending';
    NEW.moderation_notes := NULL;
    NEW.moderated_by := NULL;
    NEW.moderated_at := NULL;
  END IF;
  -- Image-only edits invalidate editorial approval, not scholarly assessment.
  IF ROW(NEW.image_source_url,NEW.image_type,NEW.image_copyright_details)
    IS DISTINCT FROM ROW(OLD.image_source_url,OLD.image_type,OLD.image_copyright_details) THEN
    NEW.moderation_status := 'pending';
    NEW.moderation_notes := NULL;
    NEW.moderated_by := NULL;
    NEW.moderated_at := NULL;
  END IF;
  NEW.revision := OLD.revision+1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- A separate BEFORE INSERT trigger prevents even legacy inserts from supplying approval.
CREATE OR REPLACE FUNCTION research_pending_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.moderation_status := 'pending';
  NEW.moderation_notes := NULL;
  NEW.moderated_by := NULL;
  NEW.moderated_at := NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS research_pending_insert ON records;
CREATE TRIGGER research_pending_insert BEFORE INSERT ON records FOR EACH ROW EXECUTE FUNCTION research_pending_insert();

CREATE OR REPLACE FUNCTION research_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec records; rid uuid; snap jsonb; actor text; inscription_changed boolean;
BEGIN
  IF TG_TABLE_NAME='records' THEN
    IF TG_OP='DELETE' THEN rec:=OLD; ELSE rec:=NEW; END IF;
  ELSE
    IF TG_OP='DELETE' THEN rid:=OLD.record_id; ELSE rid:=NEW.record_id; END IF;
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
      moderation_status=CASE WHEN inscription_changed THEN 'pending' ELSE moderation_status END,
      moderation_notes=CASE WHEN inscription_changed THEN NULL ELSE moderation_notes END,
      moderated_by=CASE WHEN inscription_changed THEN NULL ELSE moderated_by END,
      moderated_at=CASE WHEN inscription_changed THEN NULL ELSE moderated_at END,
      updated_at=now()
    WHERE id=rid RETURNING * INTO rec;
  END IF;
  IF rec.id IS NULL THEN RETURN NULL; END IF;
  actor:=coalesce(nullif(current_setting('research.actor',true),''),rec.user_id);
  snap:=jsonb_build_object('record',to_jsonb(rec)-'search_vector','inscriptions',
    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM inscriptions i WHERE record_id=rec.id),'[]'::jsonb));
  INSERT INTO research_history(record_id,owner_id,actor_id,action,summary,snapshot)
    VALUES(rec.id,rec.user_id,actor,lower(TG_OP),TG_TABLE_NAME||' '||lower(TG_OP),snap);
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION research_image_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec records; rid uuid; actor text; changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN rid:=OLD.record_id; ELSE rid:=NEW.record_id; END IF;
  IF TG_OP='UPDATE' THEN
    changed := to_jsonb(NEW)-ARRAY['id','created_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['id','created_at'];
  ELSE
    changed := true;
  END IF;
  IF NOT changed THEN RETURN NULL; END IF;
  UPDATE records SET moderation_status='pending',moderation_notes=NULL,
    moderated_by=NULL,moderated_at=NULL,updated_at=now() WHERE id=rid RETURNING * INTO rec;
  IF TG_OP='UPDATE' THEN
    IF OLD.record_id IS DISTINCT FROM NEW.record_id THEN
      UPDATE records SET moderation_status='pending',moderation_notes=NULL,
        moderated_by=NULL,moderated_at=NULL,updated_at=now() WHERE id=OLD.record_id;
    END IF;
  END IF;
  IF rec.id IS NULL THEN RETURN NULL; END IF;
  actor:=coalesce(nullif(current_setting('research.actor',true),''),rec.user_id);
  INSERT INTO research_history(record_id,owner_id,actor_id,action,summary)
    VALUES(rec.id,rec.user_id,actor,'image_'||lower(TG_OP),'research_images '||lower(TG_OP));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS research_image_audit ON research_images;
CREATE TRIGGER research_image_audit AFTER INSERT OR UPDATE OR DELETE ON research_images
  FOR EACH ROW EXECUTE FUNCTION research_image_audit();
INSERT INTO research_migrations(version) VALUES('catalog_moderation_002') ON CONFLICT DO NOTHING;
