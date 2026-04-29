-- @purpose: Create authoritative production execution flow, item, material, drying, delay, defect, repair, dispose, and card-facing projection tables.
-- @domain: production-execution, workspace, production-read-projection
-- @business_impact: No runtime business behavior changes; execution writes remain on the existing domain layer until a later cutover.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

CREATE TABLE production_flow_states (
  id VARCHAR(64) NOT NULL,
  card_id VARCHAR(64) NOT NULL,
  route_operation_id VARCHAR(64) NOT NULL,
  shift_task_id VARCHAR(64) NULL,
  flow_version INT NOT NULL DEFAULT 1,
  flow_status VARCHAR(64) NOT NULL,
  current_area_id VARCHAR(64) NULL,
  current_employee_user_id VARCHAR(64) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_flow_states_route (card_id, route_operation_id),
  KEY idx_production_flow_states_card (card_id, flow_status),
  KEY idx_production_flow_states_route_op (route_operation_id),
  KEY idx_production_flow_states_shift_task (shift_task_id),
  KEY idx_production_flow_states_area_status (current_area_id, flow_status),
  KEY idx_production_flow_states_employee (current_employee_user_id, flow_status),
  CONSTRAINT fk_production_flow_states_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_flow_states_route_op
    FOREIGN KEY (route_operation_id) REFERENCES card_operations (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_flow_states_shift_task
    FOREIGN KEY (shift_task_id) REFERENCES production_shift_tasks (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_flow_states_area
    FOREIGN KEY (current_area_id) REFERENCES production_areas (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_flow_states_employee
    FOREIGN KEY (current_employee_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_flow_events (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  from_status VARCHAR(64) NULL,
  to_status VARCHAR(64) NULL,
  actor_user_id VARCHAR(64) NULL,
  expected_flow_version INT NULL,
  resulting_flow_version INT NOT NULL,
  event_payload_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_production_flow_events_state_time (flow_state_id, created_at),
  KEY idx_production_flow_events_actor (actor_user_id, created_at),
  KEY idx_production_flow_events_type (event_type, created_at),
  CONSTRAINT fk_production_flow_events_state
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_flow_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_flow_item_states (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  serial_no VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  item_status VARCHAR(64) NOT NULL,
  quality_status VARCHAR(64) NULL,
  quantity DECIMAL(18,3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_flow_item_states_serial (flow_state_id, serial_no),
  KEY idx_production_flow_item_states_status (item_status, quality_status),
  CONSTRAINT fk_production_flow_item_states_state
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE personal_operations (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_personal_operations_user_status (user_id, status),
  KEY idx_personal_operations_flow (flow_state_id),
  CONSTRAINT fk_personal_operations_flow
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_personal_operations_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_material_issues (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  material_code VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  material_name_snapshot VARCHAR(500) NULL,
  quantity DECIMAL(18,3) NOT NULL,
  unit VARCHAR(32) NULL,
  issued_by_user_id VARCHAR(64) NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_production_material_issues_flow (flow_state_id, issued_at),
  KEY idx_production_material_issues_user (issued_by_user_id, issued_at),
  CONSTRAINT fk_production_material_issues_flow
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_material_issues_user
    FOREIGN KEY (issued_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_material_returns (
  id VARCHAR(64) NOT NULL,
  material_issue_id VARCHAR(64) NOT NULL,
  quantity DECIMAL(18,3) NOT NULL,
  returned_by_user_id VARCHAR(64) NULL,
  returned_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  note TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_production_material_returns_issue (material_issue_id, returned_at),
  KEY idx_production_material_returns_user (returned_by_user_id, returned_at),
  CONSTRAINT fk_production_material_returns_issue
    FOREIGN KEY (material_issue_id) REFERENCES production_material_issues (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_material_returns_user
    FOREIGN KEY (returned_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_drying_records (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  started_by_user_id VARCHAR(64) NULL,
  completed_by_user_id VARCHAR(64) NULL,
  status VARCHAR(64) NOT NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  target_completed_at DATETIME(3) NULL,
  note TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_production_drying_flow (flow_state_id, status),
  KEY idx_production_drying_target (target_completed_at, status),
  CONSTRAINT fk_production_drying_flow
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_drying_started_by
    FOREIGN KEY (started_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_drying_completed_by
    FOREIGN KEY (completed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_delays (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  item_state_id VARCHAR(64) NULL,
  reason TEXT NOT NULL,
  status VARCHAR(64) NOT NULL,
  created_by_user_id VARCHAR(64) NULL,
  resolved_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  resolved_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_production_delays_status (status, created_at),
  KEY idx_production_delays_flow (flow_state_id, status),
  CONSTRAINT fk_production_delays_flow
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_delays_item
    FOREIGN KEY (item_state_id) REFERENCES production_flow_item_states (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_delays_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_delays_resolved_by
    FOREIGN KEY (resolved_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_defects (
  id VARCHAR(64) NOT NULL,
  flow_state_id VARCHAR(64) NOT NULL,
  item_state_id VARCHAR(64) NULL,
  defect_type VARCHAR(128) NULL,
  description TEXT NOT NULL,
  status VARCHAR(64) NOT NULL,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_production_defects_status (status, created_at),
  KEY idx_production_defects_flow (flow_state_id, status),
  CONSTRAINT fk_production_defects_flow
    FOREIGN KEY (flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_defects_item
    FOREIGN KEY (item_state_id) REFERENCES production_flow_item_states (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_defects_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_repairs (
  id VARCHAR(64) NOT NULL,
  defect_id VARCHAR(64) NOT NULL,
  repair_card_id VARCHAR(64) NULL,
  status VARCHAR(64) NOT NULL,
  created_by_user_id VARCHAR(64) NULL,
  completed_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  completed_at DATETIME(3) NULL,
  note TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_production_repairs_defect (defect_id),
  KEY idx_production_repairs_card (repair_card_id),
  KEY idx_production_repairs_status (status, created_at),
  CONSTRAINT fk_production_repairs_defect
    FOREIGN KEY (defect_id) REFERENCES production_defects (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_repairs_card
    FOREIGN KEY (repair_card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_repairs_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_production_repairs_completed_by
    FOREIGN KEY (completed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_disposals (
  id VARCHAR(64) NOT NULL,
  defect_id VARCHAR(64) NOT NULL,
  quantity DECIMAL(18,3) NULL,
  reason TEXT NOT NULL,
  disposed_by_user_id VARCHAR(64) NULL,
  disposed_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_production_disposals_defect (defect_id, disposed_at),
  KEY idx_production_disposals_user (disposed_by_user_id, disposed_at),
  CONSTRAINT fk_production_disposals_defect
    FOREIGN KEY (defect_id) REFERENCES production_defects (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_production_disposals_user
    FOREIGN KEY (disposed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE card_flow_projection (
  card_id VARCHAR(64) NOT NULL,
  active_flow_state_id VARCHAR(64) NULL,
  flow_version INT NOT NULL DEFAULT 1,
  current_status VARCHAR(64) NULL,
  current_area_id VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (card_id),
  KEY idx_card_flow_projection_status (current_status, updated_at),
  KEY idx_card_flow_projection_area (current_area_id, current_status),
  CONSTRAINT fk_card_flow_projection_card
    FOREIGN KEY (card_id) REFERENCES cards (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_card_flow_projection_active_flow
    FOREIGN KEY (active_flow_state_id) REFERENCES production_flow_states (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_card_flow_projection_area
    FOREIGN KEY (current_area_id) REFERENCES production_areas (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
