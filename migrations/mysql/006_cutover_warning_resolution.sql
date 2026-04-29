-- @purpose: Add explicit cutover models for shift masters and system chat context.
-- @domain: production-planning, messaging
-- @business_impact: No runtime business behavior changes; these tables/columns support MySQL import reconciliation before cutover.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

CREATE TABLE production_shift_masters (
  id VARCHAR(64) NOT NULL,
  shift_date DATE NOT NULL,
  shift_code VARCHAR(64) NOT NULL COLLATE utf8mb4_0900_bin,
  master_user_id VARCHAR(64) NOT NULL,
  source VARCHAR(64) NULL,
  note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_shift_masters_slot (shift_date, shift_code, master_user_id),
  KEY idx_production_shift_masters_user (master_user_id, shift_date),
  CONSTRAINT fk_production_shift_masters_user
    FOREIGN KEY (master_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE chat_conversations
  ADD COLUMN system_context_json JSON NULL AFTER direct_key;
