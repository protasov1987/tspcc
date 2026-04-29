-- @purpose: Create production planning, shift, and close-page archive compatibility tables.
-- @domain: production-planning, production-shifts, shift-close-archive
-- @business_impact: No runtime business behavior changes; planning and shift writes remain on the existing domain layer until a later cutover.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

CREATE TABLE production_planning_revisions (
  slice_key VARCHAR(128) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  description VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (slice_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_schedule (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  schedule_date DATE NOT NULL,
  shift_code VARCHAR(64) NOT NULL COLLATE utf8mb4_0900_bin,
  employee_user_id VARCHAR(64) NOT NULL,
  area_id VARCHAR(64) NOT NULL,
  time_from TIME NULL,
  time_to TIME NULL,
  assignment_type VARCHAR(64) NULL,
  source VARCHAR(64) NULL,
  note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_schedule_slot (schedule_date, shift_code, employee_user_id, area_id),
  KEY idx_production_schedule_area_date (area_id, schedule_date, shift_code),
  KEY idx_production_schedule_employee_date (employee_user_id, schedule_date),
  CONSTRAINT fk_production_schedule_employee
    FOREIGN KEY (employee_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_production_schedule_area
    FOREIGN KEY (area_id) REFERENCES production_areas (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_tasks (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  card_id VARCHAR(64) NOT NULL,
  route_operation_id VARCHAR(64) NOT NULL,
  operation_id VARCHAR(64) NULL,
  area_id VARCHAR(64) NOT NULL,
  shift_date DATE NOT NULL,
  shift_code VARCHAR(64) NOT NULL COLLATE utf8mb4_0900_bin,
  planned_quantity DECIMAL(18,3) NULL,
  remaining_quantity_snapshot DECIMAL(18,3) NULL,
  effective_deadline_snapshot DATETIME(3) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'PLANNED',
  subcontract_status VARCHAR(64) NULL,
  subcontract_partner_text VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_shift_tasks_route_slot (card_id, route_operation_id, shift_date, shift_code, area_id),
  KEY idx_production_shift_tasks_card (card_id),
  KEY idx_production_shift_tasks_route_op (route_operation_id),
  KEY idx_production_shift_tasks_area_date (area_id, shift_date, shift_code),
  KEY idx_production_shift_tasks_operation (operation_id),
  CONSTRAINT fk_production_shift_tasks_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_shift_tasks_route_op
    FOREIGN KEY (route_operation_id) REFERENCES card_operations (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_shift_tasks_operation
    FOREIGN KEY (operation_id) REFERENCES operations (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_shift_tasks_area
    FOREIGN KEY (area_id) REFERENCES production_areas (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shifts (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  shift_date DATE NOT NULL,
  shift_code VARCHAR(64) NOT NULL COLLATE utf8mb4_0900_bin,
  status VARCHAR(64) NOT NULL,
  opened_by_user_id VARCHAR(64) NULL,
  opened_at DATETIME(3) NULL,
  closed_by_user_id VARCHAR(64) NULL,
  closed_at DATETIME(3) NULL,
  locked_by_user_id VARCHAR(64) NULL,
  locked_at DATETIME(3) NULL,
  fixed_by_user_id VARCHAR(64) NULL,
  fixed_at DATETIME(3) NULL,
  note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_shifts_date_shift (shift_date, shift_code),
  KEY idx_production_shifts_status (status, shift_date),
  KEY idx_production_shifts_opened_by (opened_by_user_id),
  KEY idx_production_shifts_closed_by (closed_by_user_id),
  CONSTRAINT fk_production_shifts_opened_by
    FOREIGN KEY (opened_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_shifts_closed_by
    FOREIGN KEY (closed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_shifts_locked_by
    FOREIGN KEY (locked_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_shifts_fixed_by
    FOREIGN KEY (fixed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_logs (
  id VARCHAR(64) NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  action_type VARCHAR(64) NOT NULL,
  message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_production_shift_logs_shift_time (shift_id, created_at),
  KEY idx_production_shift_logs_actor (actor_user_id, created_at),
  CONSTRAINT fk_production_shift_logs_shift
    FOREIGN KEY (shift_id) REFERENCES production_shifts (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_shift_logs_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_initial_snapshot_archive (
  shift_id VARCHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (shift_id),
  CONSTRAINT fk_production_shift_initial_snapshot_shift
    FOREIGN KEY (shift_id) REFERENCES production_shifts (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_close_draft_archive (
  shift_id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  draft_json JSON NOT NULL,
  updated_by_user_id VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (shift_id),
  KEY idx_production_shift_close_draft_user (updated_by_user_id),
  CONSTRAINT fk_production_shift_close_draft_shift
    FOREIGN KEY (shift_id) REFERENCES production_shifts (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_shift_close_draft_user
    FOREIGN KEY (updated_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_close_snapshots (
  id VARCHAR(64) NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_production_shift_close_snapshots_shift (shift_id, created_at),
  CONSTRAINT fk_production_shift_close_snapshots_shift
    FOREIGN KEY (shift_id) REFERENCES production_shifts (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_shift_close_snapshots_user
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_close_snapshot_history (
  id VARCHAR(64) NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  snapshot_id VARCHAR(64) NULL,
  history_event VARCHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_production_shift_close_history_shift (shift_id, created_at),
  KEY idx_production_shift_close_history_snapshot (snapshot_id),
  CONSTRAINT fk_production_shift_close_history_shift
    FOREIGN KEY (shift_id) REFERENCES production_shifts (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_shift_close_history_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES production_shift_close_snapshots (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_shift_close_history_user
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
