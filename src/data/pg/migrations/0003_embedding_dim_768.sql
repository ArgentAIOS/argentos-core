-- ArgentOS PG migration: normalize embedding schema to vector(768)
-- Preserves existing vectors by taking the first 768 dimensions.
-- Re-embedding is still recommended for best retrieval quality.

CREATE EXTENSION IF NOT EXISTS vector;

-- Drop vector indexes before column type changes.
DROP INDEX IF EXISTS idx_items_embedding;
DROP INDEX IF EXISTS idx_entities_embedding;
DROP INDEX IF EXISTS idx_categories_embedding;
DROP INDEX IF EXISTS idx_lessons_embedding;
DROP INDEX IF EXISTS idx_shared_knowledge_embedding;

ALTER TABLE resources
  ALTER COLUMN embedding TYPE vector(768)
  USING (
    CASE
      WHEN embedding IS NULL THEN NULL
      ELSE subvector(embedding::vector, 1, 768)
    END
  );

ALTER TABLE memory_items
  ALTER COLUMN embedding TYPE vector(768)
  USING (
    CASE
      WHEN embedding IS NULL THEN NULL
      ELSE subvector(embedding::vector, 1, 768)
    END
  );

ALTER TABLE memory_categories
  ALTER COLUMN embedding TYPE vector(768)
  USING (
    CASE
      WHEN embedding IS NULL THEN NULL
      ELSE subvector(embedding::vector, 1, 768)
    END
  );

ALTER TABLE entities
  ALTER COLUMN embedding TYPE vector(768)
  USING (
    CASE
      WHEN embedding IS NULL THEN NULL
      ELSE subvector(embedding::vector, 1, 768)
    END
  );

ALTER TABLE lessons
  ALTER COLUMN embedding TYPE vector(768)
  USING (
    CASE
      WHEN embedding IS NULL THEN NULL
      ELSE subvector(embedding::vector, 1, 768)
    END
  );

ALTER TABLE shared_knowledge
  ALTER COLUMN embedding TYPE vector(768)
  USING (
    CASE
      WHEN embedding IS NULL THEN NULL
      ELSE subvector(embedding::vector, 1, 768)
    END
  );

CREATE INDEX idx_items_embedding ON memory_items
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_entities_embedding ON entities
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_categories_embedding ON memory_categories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_lessons_embedding ON lessons
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_shared_knowledge_embedding ON shared_knowledge
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
