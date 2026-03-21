-- ArgentOS Knowledge Collection ACL
-- Adds collection-level bucket permissions for RAG ingest/search/recall.

CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY,
  collection_name TEXT NOT NULL,
  collection_tag TEXT NOT NULL UNIQUE,
  owner_agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_collections_owner
  ON knowledge_collections (owner_agent_id);

CREATE TABLE IF NOT EXISTS knowledge_collection_grants (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  can_read BOOLEAN NOT NULL DEFAULT TRUE,
  can_write BOOLEAN NOT NULL DEFAULT FALSE,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(collection_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_collection_grants_agent
  ON knowledge_collection_grants (agent_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_collection_grants_collection
  ON knowledge_collection_grants (collection_id);

-- Backfill: register existing ingested collections discovered in memory_items.extra.
WITH discovered AS (
  SELECT DISTINCT ON (collection_tag)
    COALESCE(NULLIF(TRIM(extra->>'collection'), ''), 'default') AS collection_name,
    COALESCE(
      NULLIF(TRIM(extra->>'collectionTag'), ''),
      TRIM(BOTH '-' FROM regexp_replace(
        LOWER(COALESCE(NULLIF(TRIM(extra->>'collection'), ''), 'default')),
        '[^a-z0-9._-]+', '-', 'g'
      ))
    ) AS collection_tag,
    agent_id AS owner_agent_id,
    created_at
  FROM memory_items
  WHERE memory_type = 'knowledge'
    AND COALESCE(extra->>'source', '') = 'knowledge_ingest'
  ORDER BY collection_tag, created_at ASC
)
INSERT INTO knowledge_collections (
  id,
  collection_name,
  collection_tag,
  owner_agent_id,
  created_at,
  updated_at
)
SELECT
  'kc_' || md5(discovered.collection_tag),
  discovered.collection_name,
  discovered.collection_tag,
  discovered.owner_agent_id,
  NOW(),
  NOW()
FROM discovered
WHERE discovered.collection_tag IS NOT NULL
  AND discovered.collection_tag <> ''
ON CONFLICT (collection_tag) DO NOTHING;

-- Backfill: grant read access to agents that historically wrote to each collection.
-- Owner gets read+write+owner grants.
WITH collection_writers AS (
  SELECT DISTINCT
    COALESCE(
      NULLIF(TRIM(extra->>'collectionTag'), ''),
      TRIM(BOTH '-' FROM regexp_replace(
        LOWER(COALESCE(NULLIF(TRIM(extra->>'collection'), ''), 'default')),
        '[^a-z0-9._-]+', '-', 'g'
      ))
    ) AS collection_tag,
    agent_id
  FROM memory_items
  WHERE memory_type = 'knowledge'
    AND COALESCE(extra->>'source', '') = 'knowledge_ingest'
)
INSERT INTO knowledge_collection_grants (
  id,
  collection_id,
  agent_id,
  can_read,
  can_write,
  is_owner,
  created_at,
  updated_at
)
SELECT
  'kcg_' || md5(c.id || ':' || cw.agent_id),
  c.id,
  cw.agent_id,
  TRUE,
  CASE WHEN cw.agent_id = c.owner_agent_id THEN TRUE ELSE FALSE END,
  CASE WHEN cw.agent_id = c.owner_agent_id THEN TRUE ELSE FALSE END,
  NOW(),
  NOW()
FROM collection_writers cw
JOIN knowledge_collections c ON c.collection_tag = cw.collection_tag
WHERE cw.collection_tag IS NOT NULL
  AND cw.collection_tag <> ''
ON CONFLICT (collection_id, agent_id) DO NOTHING;
