-- @purpose: Create target card aggregate, lifecycle, quantity, serial, log, approval, input/provision, and attachment metadata tables.
-- @domain: cards, approvals, input-control, provision, card-files
-- @business_impact: No runtime business behavior changes; card reads and writes remain on the existing domain layer until a later cutover.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

CREATE TABLE cards (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  qr_id VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  barcode VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  route_card_number VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  card_type VARCHAR(32) NOT NULL,
  approval_stage VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'NOT_STARTED',
  production_status VARCHAR(64) NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  title VARCHAR(500) NULL,
  item_name VARCHAR(500) NULL,
  item_designation VARCHAR(255) NULL,
  document_number VARCHAR(255) NULL,
  document_revision VARCHAR(255) NULL,
  quantity DECIMAL(18,3) NULL,
  batch_size DECIMAL(18,3) NULL,
  main_materials_text TEXT NULL,
  descriptive_attrs_json JSON NULL,
  rejection_reason TEXT NULL,
  rejection_read_by_user_id VARCHAR(64) NULL,
  rejection_read_at DATETIME(3) NULL,
  input_control_required BOOLEAN NOT NULL DEFAULT FALSE,
  input_control_done BOOLEAN NOT NULL DEFAULT FALSE,
  input_control_file_attachment_id VARCHAR(64) NULL,
  provision_required BOOLEAN NOT NULL DEFAULT FALSE,
  provision_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  archived_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cards_qr_id (qr_id),
  UNIQUE KEY uq_cards_barcode (barcode),
  UNIQUE KEY uq_cards_route_card_number (route_card_number),
  KEY idx_cards_stage (approval_stage, archived, deleted_at),
  KEY idx_cards_type_stage (card_type, approval_stage, archived),
  KEY idx_cards_created_by (created_by_user_id),
  KEY idx_cards_rejection_reader (rejection_read_by_user_id),
  CONSTRAINT fk_cards_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_cards_rejection_read_by
    FOREIGN KEY (rejection_read_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_operations (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  operation_id VARCHAR(64) NULL,
  work_center_id VARCHAR(64) NULL,
  sequence_no INT NOT NULL,
  operation_name_snapshot VARCHAR(255) NULL,
  work_center_name_snapshot VARCHAR(255) NULL,
  planned_quantity DECIMAL(18,3) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'NOT_STARTED',
  comments TEXT NULL,
  descriptive_attrs_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_card_operations_sequence (card_id, sequence_no),
  KEY idx_card_operations_card (card_id),
  KEY idx_card_operations_operation (operation_id),
  KEY idx_card_operations_center (work_center_id),
  CONSTRAINT fk_card_operations_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_operations_operation
    FOREIGN KEY (operation_id) REFERENCES operations (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_card_operations_center
    FOREIGN KEY (work_center_id) REFERENCES work_centers (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_serials (
  id BIGINT NOT NULL AUTO_INCREMENT,
  card_id VARCHAR(64) NOT NULL,
  serial_no VARCHAR(190) NOT NULL COLLATE utf8mb4_0900_bin,
  quantity DECIMAL(18,3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_card_serials_card_serial (card_id, serial_no),
  KEY idx_card_serials_card (card_id),
  CONSTRAINT fk_card_serials_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_quantities (
  id BIGINT NOT NULL AUTO_INCREMENT,
  card_id VARCHAR(64) NOT NULL,
  card_operation_id VARCHAR(64) NULL,
  quantity_type VARCHAR(64) NOT NULL,
  amount DECIMAL(18,3) NOT NULL,
  unit VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_card_quantities_scope (card_id, card_operation_id, quantity_type),
  KEY idx_card_quantities_operation (card_operation_id),
  CONSTRAINT fk_card_quantities_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_quantities_operation
    FOREIGN KEY (card_operation_id) REFERENCES card_operations (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_lifecycle_events (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  from_stage VARCHAR(64) NULL,
  to_stage VARCHAR(64) NULL,
  actor_user_id VARCHAR(64) NULL,
  reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_card_lifecycle_card_time (card_id, created_at),
  KEY idx_card_lifecycle_actor (actor_user_id, created_at),
  CONSTRAINT fk_card_lifecycle_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_lifecycle_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_approval_events (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  role_context VARCHAR(64) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  actor_name_snapshot VARCHAR(255) NULL,
  comment TEXT NULL,
  event_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_card_approval_card_time (card_id, event_at),
  KEY idx_card_approval_actor (actor_user_id, event_at),
  CONSTRAINT fk_card_approval_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_approval_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_input_control_records (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  result_status VARCHAR(64) NOT NULL,
  attachment_id VARCHAR(64) NULL,
  comment TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_card_input_control_card (card_id, created_at),
  KEY idx_card_input_control_actor (actor_user_id, created_at),
  CONSTRAINT fk_card_input_control_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_input_control_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_provision_records (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  result_status VARCHAR(64) NOT NULL,
  comment TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_card_provision_card (card_id, created_at),
  KEY idx_card_provision_actor (actor_user_id, created_at),
  CONSTRAINT fk_card_provision_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_provision_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_logs (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  message TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_card_logs_card_time (card_id, created_at),
  KEY idx_card_logs_actor (actor_user_id, created_at),
  CONSTRAINT fk_card_logs_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_logs_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_attachments (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  storage_key VARCHAR(190) NOT NULL COLLATE utf8mb4_0900_bin,
  rel_path VARCHAR(512) NOT NULL,
  category VARCHAR(64) NULL,
  original_name VARCHAR(500) NOT NULL,
  mime_type VARCHAR(255) NULL,
  size_bytes BIGINT NULL,
  checksum_sha256 VARBINARY(32) NULL,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_card_attachments_card_path (card_id, rel_path),
  KEY idx_card_attachments_card_category (card_id, category, deleted_at),
  KEY idx_card_attachments_storage (storage_key),
  KEY idx_card_attachments_created_by (created_by_user_id),
  CONSTRAINT fk_card_attachments_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_attachments_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE cards
  ADD CONSTRAINT fk_cards_input_control_file
    FOREIGN KEY (input_control_file_attachment_id) REFERENCES card_attachments (id)
    ON UPDATE RESTRICT ON DELETE SET NULL;

ALTER TABLE card_input_control_records
  ADD CONSTRAINT fk_card_input_control_attachment
    FOREIGN KEY (attachment_id) REFERENCES card_attachments (id)
    ON UPDATE RESTRICT ON DELETE SET NULL;

CREATE TABLE card_initial_snapshots_archive (
  card_id VARCHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (card_id),
  CONSTRAINT fk_card_initial_snapshots_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
