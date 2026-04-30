-- @purpose: Harden derived route read models for workorders, archive, items, control samples, and witness samples.
-- @domain: derived-read-models
-- @business_impact: No runtime business behavior changes; client route cutover remains scheduled for a later Stage 9 batch.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

ALTER TABLE production_flow_item_states
  ADD COLUMN item_kind VARCHAR(32) NOT NULL DEFAULT 'ITEM' AFTER serial_no,
  ADD COLUMN sample_type VARCHAR(32) NULL AFTER item_kind,
  ADD KEY idx_production_flow_item_states_kind (item_kind, sample_type, item_status);

UPDATE production_flow_item_states i
INNER JOIN production_flow_states fs ON fs.id = i.flow_state_id
INNER JOIN card_operations co ON co.id = fs.route_operation_id
SET
  i.item_kind = CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(co.descriptive_attrs_json, '$.isSamples')) IN ('true', '1')
      THEN 'SAMPLE'
    ELSE 'ITEM'
  END,
  i.sample_type = CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(co.descriptive_attrs_json, '$.isSamples')) IN ('true', '1')
      THEN COALESCE(NULLIF(UPPER(JSON_UNQUOTE(JSON_EXTRACT(co.descriptive_attrs_json, '$.sampleType'))), ''), 'CONTROL')
    ELSE NULL
  END;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW workorders_read_model AS
  SELECT
    c.id AS card_id,
    c.qr_id,
    c.route_card_number,
    c.card_type,
    c.approval_stage,
    c.status,
    c.production_status,
    c.updated_at,
    COUNT(DISTINCT pst.id) AS planning_task_count,
    COUNT(DISTINCT fs.id) AS flow_state_count,
    MAX(fs.flow_version) AS flow_version,
    cfp.current_status AS current_flow_status
  FROM cards c
  LEFT JOIN production_shift_tasks pst
    ON pst.card_id = c.id
   AND pst.deleted_at IS NULL
  LEFT JOIN production_flow_states fs
    ON fs.card_id = c.id
  LEFT JOIN card_flow_projection cfp
    ON cfp.card_id = c.id
  WHERE c.deleted_at IS NULL
    AND c.archived = FALSE
    AND c.card_type = 'MKI'
    AND (
      c.approval_stage IN ('PROVIDED', 'PLANNING', 'PLANNED')
      OR pst.id IS NOT NULL
      OR fs.id IS NOT NULL
      OR cfp.card_id IS NOT NULL
    )
  GROUP BY
    c.id,
    c.qr_id,
    c.route_card_number,
    c.card_type,
    c.approval_stage,
    c.status,
    c.production_status,
    c.updated_at,
    cfp.current_status;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW archive_read_model AS
  SELECT
    c.id AS card_id,
    c.qr_id,
    c.route_card_number,
    c.card_type,
    c.approval_stage,
    c.status,
    c.archived_at,
    c.updated_at
  FROM cards c
  WHERE c.deleted_at IS NULL
    AND c.archived = TRUE;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW production_items_read_model AS
  SELECT
    i.id AS item_state_id,
    fs.card_id,
    c.qr_id,
    fs.route_operation_id,
    co.operation_id,
    co.operation_name_snapshot,
    i.serial_no,
    'ITEM' AS item_kind,
    NULL AS sample_type,
    i.item_status,
    i.quality_status,
    i.quantity,
    i.updated_at
  FROM production_flow_item_states i
  INNER JOIN production_flow_states fs ON fs.id = i.flow_state_id
  INNER JOIN cards c ON c.id = fs.card_id
  INNER JOIN card_operations co ON co.id = fs.route_operation_id
  WHERE c.deleted_at IS NULL
    AND UPPER(COALESCE(NULLIF(i.item_kind, ''), 'ITEM')) = 'ITEM';

CREATE OR REPLACE SQL SECURITY INVOKER VIEW production_ok_read_model AS
  SELECT
    i.id AS item_state_id,
    fs.card_id,
    c.qr_id,
    fs.route_operation_id,
    co.operation_id,
    co.operation_name_snapshot,
    i.serial_no,
    'SAMPLE' AS item_kind,
    'CONTROL' AS sample_type,
    i.item_status,
    i.quality_status,
    i.quantity,
    i.updated_at
  FROM production_flow_item_states i
  INNER JOIN production_flow_states fs ON fs.id = i.flow_state_id
  INNER JOIN cards c ON c.id = fs.card_id
  INNER JOIN card_operations co ON co.id = fs.route_operation_id
  WHERE c.deleted_at IS NULL
    AND UPPER(COALESCE(NULLIF(i.item_kind, ''), 'ITEM')) = 'SAMPLE'
    AND UPPER(COALESCE(NULLIF(i.sample_type, ''), 'CONTROL')) = 'CONTROL';

CREATE OR REPLACE SQL SECURITY INVOKER VIEW production_oc_read_model AS
  SELECT
    i.id AS item_state_id,
    fs.card_id,
    c.qr_id,
    fs.route_operation_id,
    co.operation_id,
    co.operation_name_snapshot,
    i.serial_no,
    'SAMPLE' AS item_kind,
    'WITNESS' AS sample_type,
    i.item_status,
    i.quality_status,
    i.quantity,
    i.updated_at
  FROM production_flow_item_states i
  INNER JOIN production_flow_states fs ON fs.id = i.flow_state_id
  INNER JOIN cards c ON c.id = fs.card_id
  INNER JOIN card_operations co ON co.id = fs.route_operation_id
  WHERE c.deleted_at IS NULL
    AND UPPER(COALESCE(NULLIF(i.item_kind, ''), 'ITEM')) = 'SAMPLE'
    AND UPPER(COALESCE(NULLIF(i.sample_type, ''), 'CONTROL')) = 'WITNESS';
