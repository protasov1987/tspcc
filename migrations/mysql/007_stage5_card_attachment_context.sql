-- @purpose: Add explicit contextual attachment metadata columns required for Stage 5 cards/files SQL cutover.
-- @domain: cards, approvals, input-control, provision, card-files
-- @business_impact: No runtime business behavior changes; preserves existing attachment context during SQL import and repository reads.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

ALTER TABLE card_attachments
  ADD COLUMN scope VARCHAR(64) NULL AFTER category,
  ADD COLUMN scope_id VARCHAR(190) NULL AFTER scope,
  ADD COLUMN operation_label VARCHAR(500) NULL AFTER scope_id,
  ADD COLUMN items_label VARCHAR(500) NULL AFTER operation_label,
  ADD COLUMN op_id VARCHAR(64) NULL AFTER items_label,
  ADD COLUMN op_code VARCHAR(190) NULL AFTER op_id,
  ADD COLUMN op_name VARCHAR(255) NULL AFTER op_code,
  ADD KEY idx_card_attachments_context (card_id, scope, scope_id, deleted_at),
  ADD KEY idx_card_attachments_operation_context (card_id, op_id, op_code);
