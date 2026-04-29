-- @purpose: Create directory and security tables used by later target-domain migrations.
-- @domain: directories, security
-- @business_impact: No runtime business behavior changes; this only defines future SQL storage.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

CREATE TABLE work_centers (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_work_centers_name (name),
  KEY idx_work_centers_status (status, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_areas (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  area_type VARCHAR(64) NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_areas_name (name),
  KEY idx_production_areas_type (area_type, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE operations (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  code VARCHAR(64) NULL COLLATE utf8mb4_0900_bin,
  name VARCHAR(255) NOT NULL,
  operation_type VARCHAR(64) NULL,
  rec_time_minutes DECIMAL(12,3) NULL,
  default_work_center_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operations_code (code),
  KEY idx_operations_type (operation_type, deleted_at),
  KEY idx_operations_center (default_work_center_id),
  CONSTRAINT fk_operations_default_center
    FOREIGN KEY (default_work_center_id) REFERENCES work_centers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE operation_allowed_areas (
  operation_id VARCHAR(64) NOT NULL,
  area_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (operation_id, area_id),
  KEY idx_operation_allowed_areas_area (area_id),
  CONSTRAINT fk_operation_allowed_areas_operation
    FOREIGN KEY (operation_id) REFERENCES operations (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_operation_allowed_areas_area
    FOREIGN KEY (area_id) REFERENCES production_areas (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE production_shift_times (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  shift_code VARCHAR(64) NOT NULL COLLATE utf8mb4_0900_bin,
  time_from TIME NOT NULL,
  time_to TIME NOT NULL,
  lunch_from TIME NULL,
  lunch_to TIME NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_shift_times_shift (shift_code),
  KEY idx_production_shift_times_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_levels (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  landing_tab VARCHAR(128) NULL,
  inactivity_timeout_minutes INT NULL,
  special_roles_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_levels_name (name),
  KEY idx_access_levels_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_level_permissions (
  access_level_id VARCHAR(64) NOT NULL,
  permission_key VARCHAR(128) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (access_level_id, permission_key),
  KEY idx_access_level_permissions_key (permission_key, can_view, can_edit),
  CONSTRAINT fk_access_level_permissions_access_level
    FOREIGN KEY (access_level_id) REFERENCES access_levels (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT chk_access_level_permissions_edit_implies_view
    CHECK (can_edit = FALSE OR can_view = TRUE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id VARCHAR(64) NOT NULL,
  rev INT NOT NULL DEFAULT 1,
  login VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  department_id VARCHAR(64) NULL,
  access_level_id VARCHAR(64) NOT NULL,
  password_hash VARBINARY(255) NULL,
  password_salt VARBINARY(255) NULL,
  print_settings_json JSON NULL,
  production_settings_json JSON NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_login (login),
  KEY idx_users_access_level (access_level_id),
  KEY idx_users_department (department_id),
  KEY idx_users_status (status, deleted_at),
  CONSTRAINT fk_users_access_level
    FOREIGN KEY (access_level_id) REFERENCES access_levels (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_users_department
    FOREIGN KEY (department_id) REFERENCES work_centers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_sessions (
  id VARCHAR(128) NOT NULL COLLATE utf8mb4_0900_bin,
  user_id VARCHAR(64) NOT NULL,
  session_hash VARBINARY(255) NOT NULL,
  csrf_token_hash VARBINARY(255) NULL,
  user_agent_hash VARBINARY(32) NULL,
  ip_hash VARBINARY(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  last_seen_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_user_sessions_user (user_id, revoked_at, expires_at),
  KEY idx_user_sessions_expiry (expires_at),
  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
