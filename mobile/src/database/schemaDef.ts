import { sqliteTable, text, integer, real, primaryKey, blob } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 1. Corpora Table
export const corpora = sqliteTable('corpora', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updated_at: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 2. Documents Table
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  corpus_id: text('corpus_id').references(() => corpora.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  author: text('author'),
  source_type: text('source_type').default('pdf').notNull(),
  sha256_hash: text('sha256_hash').notNull(),
  metadata: text('metadata'),
  storage_path: text('storage_path').notNull(),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updated_at: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 3. Sections Table
export const sections = sqliteTable('sections', {
  id: text('id').primaryKey(),
  document_id: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  parent_id: text('parent_id').references((): any => sections.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  depth_level: integer('depth_level').default(1).notNull(),
  sort_order: integer('sort_order').notNull(),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 4. Blocks Table
export const blocks = sqliteTable('blocks', {
  id: text('id').primaryKey(),
  section_id: text('section_id').references(() => sections.id, { onDelete: 'cascade' }),
  document_id: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  block_type: text('block_type').default('paragraph').notNull(),
  content: text('content').notNull(), // Stores JSON AST
  sort_order: integer('sort_order').notNull(),
  token_count: integer('token_count').default(0),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 5. Annotations Table
export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  document_id: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  block_id: text('block_id').references(() => blocks.id, { onDelete: 'cascade' }),
  annotation_type: text('annotation_type').default('highlight').notNull(),
  color_code: text('color_code'),
  highlighted_text: text('highlighted_text'),
  note_body: text('note_body'),
  anchor_metadata: text('anchor_metadata'),
  author_id: text('author_id'),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updated_at: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 6. Tags Table
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').unique().notNull(),
  source: text('source').notNull(),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 7. Block Tags Table
export const block_tags = sqliteTable('block_tags', {
  block_id: text('block_id').references(() => blocks.id, { onDelete: 'cascade' }),
  tag_id: text('tag_id').references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.block_id, t.tag_id] }),
}));

// 8. Processing Jobs Table
export const processing_jobs = sqliteTable('processing_jobs', {
  id: text('id').primaryKey(),
  document_id: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  status: text('status').default('pending').notNull(),
  progress_percentage: integer('progress_percentage').default(0),
  created_at: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
  updated_at: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 9. Job Chunks Table
export const job_chunks = sqliteTable('job_chunks', {
  id: text('id').primaryKey(),
  job_id: text('job_id').references(() => processing_jobs.id, { onDelete: 'cascade' }),
  raw_text: text('raw_text').notNull(),
  chunk_order: integer('chunk_order').notNull(),
  status: text('status').default('pending').notNull(),
  processed_blocks: text('processed_blocks'),
});

// 10. Layout Height Cache Table
export const layout_height_cache = sqliteTable('layout_height_cache', {
  block_id: text('block_id').primaryKey().references(() => blocks.id, { onDelete: 'cascade' }),
  estimated_height: real('estimated_height').notNull(),
});

// 11. Dedicated Vector Cache Table
export const vector_cache = sqliteTable('vector_cache', {
  block_id: text('block_id').primaryKey().references(() => blocks.id, { onDelete: 'cascade' }),
  vector: blob('vector').notNull(),
});
