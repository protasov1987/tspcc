-- @purpose: Create derived read-only views plus messaging, profile, notification, audit, and outbox tables.
-- @domain: derived-read-models, messaging, profile, notifications, audit, outbox
-- @business_impact: No runtime business behavior changes; messaging/profile reads and writes remain on the existing domain layer until a later cutover.
-- @rollback: Forward-only migration; restore the database from the pre-migration dump if this must be undone.

CREATE SQL SECURITY INVOKER VIEW workorders_read_model AS
  SELECT
    c.id AS card_id,
    c.qr_id,
    c.route_card_number,
    c.card_type,
    c.approval_stage,
    c.status,
    c.production_status,
    c.updated_at
  FROM cards c
  WHERE c.deleted_at IS NULL
    AND c.archived = FALSE;

CREATE SQL SECURITY INVOKER VIEW archive_read_model AS
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

CREATE SQL SECURITY INVOKER VIEW production_items_read_model AS
  SELECT
    i.id AS item_state_id,
    s.card_id,
    s.route_operation_id,
    i.serial_no,
    i.item_status,
    i.quality_status,
    i.quantity,
    i.updated_at
  FROM production_flow_item_states i
  INNER JOIN production_flow_states s ON s.id = i.flow_state_id;

CREATE SQL SECURITY INVOKER VIEW production_ok_read_model AS
  SELECT
    i.id AS item_state_id,
    s.card_id,
    s.route_operation_id,
    i.serial_no,
    i.item_status,
    i.quality_status,
    i.quantity,
    i.updated_at
  FROM production_flow_item_states i
  INNER JOIN production_flow_states s ON s.id = i.flow_state_id
  WHERE i.quality_status = 'OK';

CREATE SQL SECURITY INVOKER VIEW production_oc_read_model AS
  SELECT
    d.id AS defect_id,
    s.card_id,
    s.route_operation_id,
    d.defect_type,
    d.status,
    d.created_at,
    d.closed_at
  FROM production_defects d
  INNER JOIN production_flow_states s ON s.id = d.flow_state_id;

CREATE TABLE chat_conversations (
  id VARCHAR(64) NOT NULL,
  conversation_type VARCHAR(64) NOT NULL DEFAULT 'direct',
  direct_key VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  archived_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_conversations_direct_key (direct_key),
  KEY idx_chat_conversations_created_by (created_by_user_id),
  KEY idx_chat_conversations_updated (updated_at),
  CONSTRAINT fk_chat_conversations_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE chat_conversation_participants (
  conversation_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  participant_role VARCHAR(64) NOT NULL DEFAULT 'member',
  joined_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  left_at DATETIME(3) NULL,
  last_read_message_id VARCHAR(64) NULL,
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_chat_participants_user (user_id, left_at),
  KEY idx_chat_participants_last_read (last_read_message_id),
  CONSTRAINT fk_chat_participants_conversation
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_chat_participants_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE chat_messages (
  id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  seq BIGINT NOT NULL,
  client_msg_id VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  sender_user_id VARCHAR(64) NULL,
  sender_kind VARCHAR(32) NOT NULL DEFAULT 'user',
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  edited_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_messages_conversation_seq (conversation_id, seq),
  UNIQUE KEY uq_chat_messages_client (conversation_id, sender_user_id, client_msg_id),
  KEY idx_chat_messages_conversation_time (conversation_id, created_at),
  KEY idx_chat_messages_sender (sender_user_id, created_at),
  CONSTRAINT fk_chat_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_chat_messages_sender
    FOREIGN KEY (sender_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE chat_conversation_participants
  ADD CONSTRAINT fk_chat_participants_last_read
    FOREIGN KEY (last_read_message_id) REFERENCES chat_messages (id)
    ON UPDATE RESTRICT ON DELETE SET NULL;

CREATE TABLE chat_message_states (
  message_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  delivered_at DATETIME(3) NULL,
  read_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (message_id, user_id),
  KEY idx_chat_message_states_user_read (user_id, read_at, delivered_at),
  CONSTRAINT fk_chat_message_states_message
    FOREIGN KEY (message_id) REFERENCES chat_messages (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_states_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_visits (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  route_path VARCHAR(512) NOT NULL,
  visited_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_user_visits_user_time (user_id, visited_at),
  KEY idx_user_visits_route_time (route_path, visited_at),
  CONSTRAINT fk_user_visits_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE web_push_subscriptions (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  endpoint_hash VARBINARY(32) NOT NULL,
  encrypted_payload_json JSON NOT NULL,
  user_agent_hash VARBINARY(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  last_seen_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_web_push_subscriptions_endpoint (endpoint_hash),
  KEY idx_web_push_subscriptions_user (user_id, revoked_at),
  CONSTRAINT fk_web_push_subscriptions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fcm_tokens (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARBINARY(32) NOT NULL,
  token_ciphertext TEXT NOT NULL,
  device_id VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  last_seen_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fcm_tokens_token (token_hash),
  KEY idx_fcm_tokens_user (user_id, revoked_at),
  CONSTRAINT fk_fcm_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_actions (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NULL,
  actor_user_id VARCHAR(64) NULL,
  domain VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NULL,
  entity_id VARCHAR(190) NULL COLLATE utf8mb4_0900_bin,
  action_type VARCHAR(64) NOT NULL,
  message TEXT NULL,
  route_path VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_user_actions_user_time (user_id, created_at),
  KEY idx_user_actions_actor_time (actor_user_id, created_at),
  KEY idx_user_actions_entity (domain, entity_type, entity_id, created_at),
  CONSTRAINT fk_user_actions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_user_actions_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_events (
  id VARCHAR(64) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(190) NOT NULL COLLATE utf8mb4_0900_bin,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  event_payload_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_audit_events_aggregate (domain, aggregate_type, aggregate_id, created_at),
  KEY idx_audit_events_actor (actor_user_id, created_at),
  CONSTRAINT fk_audit_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE outbox_events (
  id VARCHAR(64) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(190) NOT NULL COLLATE utf8mb4_0900_bin,
  event_payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  processed_at DATETIME(3) NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_outbox_events_unprocessed (processed_at, created_at),
  KEY idx_outbox_events_aggregate (aggregate_type, aggregate_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
