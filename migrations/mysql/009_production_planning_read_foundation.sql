-- @purpose: Cover active production planning read fields for SQL repository cutover.
-- @domain: production-planning
-- @business_impact: No runtime business behavior changes; planning reads can preserve existing payload shape before write cutover.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

ALTER TABLE production_shift_masters
  ADD COLUMN rev INT NOT NULL DEFAULT 1 AFTER id;

ALTER TABLE production_shift_tasks
  ADD COLUMN operation_name_snapshot VARCHAR(255) NULL AFTER operation_id,
  ADD COLUMN planned_part_minutes INT NULL AFTER planned_quantity,
  ADD COLUMN planned_total_minutes INT NULL AFTER planned_part_minutes,
  ADD COLUMN planned_part_qty DECIMAL(18,3) NULL AFTER planned_total_minutes,
  ADD COLUMN planned_total_qty DECIMAL(18,3) NULL AFTER planned_part_qty,
  ADD COLUMN minutes_per_unit_snapshot DECIMAL(18,6) NULL AFTER planned_total_qty,
  ADD COLUMN planning_mode VARCHAR(32) NOT NULL DEFAULT 'MANUAL' AFTER subcontract_partner_text,
  ADD COLUMN auto_plan_run_id VARCHAR(64) NULL AFTER planning_mode,
  ADD COLUMN work_segment_key VARCHAR(128) NULL AFTER auto_plan_run_id,
  ADD COLUMN planned_start_at BIGINT NULL AFTER work_segment_key,
  ADD COLUMN planned_end_at BIGINT NULL AFTER planned_start_at,
  ADD COLUMN source_shift_date DATE NULL AFTER planned_end_at,
  ADD COLUMN source_shift_code VARCHAR(64) NULL COLLATE utf8mb4_0900_bin AFTER source_shift_date,
  ADD COLUMN from_shift_close_transfer BOOLEAN NOT NULL DEFAULT FALSE AFTER source_shift_code,
  ADD COLUMN shift_close_source_date DATE NULL AFTER from_shift_close_transfer,
  ADD COLUMN shift_close_source_shift_code VARCHAR(64) NULL COLLATE utf8mb4_0900_bin AFTER shift_close_source_date,
  ADD COLUMN close_page_preview BOOLEAN NOT NULL DEFAULT FALSE AFTER shift_close_source_shift_code,
  ADD COLUMN close_page_record_id VARCHAR(128) NULL AFTER close_page_preview,
  ADD COLUMN close_page_row_key VARCHAR(255) NULL AFTER close_page_record_id,
  ADD COLUMN delay_minutes INT NULL AFTER close_page_row_key,
  ADD COLUMN card_planned_completion_date_snapshot DATE NULL AFTER delay_minutes,
  ADD COLUMN last_partial_batch_applied BOOLEAN NOT NULL DEFAULT FALSE AFTER card_planned_completion_date_snapshot,
  ADD COLUMN last_partial_batch_reason VARCHAR(255) NULL AFTER last_partial_batch_applied,
  ADD COLUMN subcontract_chain_id VARCHAR(128) NULL AFTER last_partial_batch_reason,
  ADD COLUMN subcontract_item_ids_json JSON NULL AFTER subcontract_chain_id,
  ADD COLUMN subcontract_item_kind VARCHAR(64) NULL AFTER subcontract_item_ids_json,
  ADD COLUMN subcontract_extended_chain BOOLEAN NOT NULL DEFAULT FALSE AFTER subcontract_item_kind,
  ADD KEY idx_production_shift_tasks_close_preview (close_page_preview, shift_close_source_date, shift_close_source_shift_code),
  ADD KEY idx_production_shift_tasks_subcontract_chain (subcontract_chain_id),
  ADD KEY idx_production_shift_tasks_work_segment (work_segment_key);
