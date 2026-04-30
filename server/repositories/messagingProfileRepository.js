const crypto = require('node:crypto');

const { BaseRepository } = require('./baseRepository');

const SYSTEM_USER_ID = 'system';

function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeLimit(value, fallback = 50, max = 200) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, number));
}

function normalizeSeq(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
  } catch (_error) {
    return fallback;
  }
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function directConversationKey(userA, userB) {
  return [trimToString(userA), trimToString(userB)].sort().join(':');
}

function repositoryError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, details);
  return error;
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: trimToString(row.id),
    conversationId: trimToString(row.conversation_id),
    seq: normalizeSeq(row.seq),
    senderId: trimToString(row.sender_user_id || row.sender_kind || ''),
    text: trimToString(row.body),
    createdAt: toIso(row.created_at),
    clientMsgId: trimToString(row.client_msg_id)
  };
}

function rowToAction(row) {
  return {
    id: trimToString(row.id),
    userId: trimToString(row.user_id),
    actorUserId: trimToString(row.actor_user_id),
    domain: trimToString(row.domain),
    entityType: trimToString(row.entity_type),
    entityId: trimToString(row.entity_id),
    actionType: trimToString(row.action_type),
    text: trimToString(row.message),
    routePath: trimToString(row.route_path),
    at: toIso(row.created_at)
  };
}

class MessagingProfileRepository extends BaseRepository {
  constructor(options = {}) {
    super({ ...options, domain: 'messaging-profile' });
    if (!options.securityRepository) {
      throw new Error('MessagingProfileRepository requires Stage 6 SecurityRepository.');
    }
    this.securityRepository = options.securityRepository;
    this.idFactory = options.idFactory || createId;
  }

  async readSecuritySnapshot() {
    const snapshot = await this.securityRepository.readSnapshot();
    return {
      users: Array.isArray(snapshot?.users) ? snapshot.users : [],
      accessLevels: Array.isArray(snapshot?.accessLevels) ? snapshot.accessLevels : []
    };
  }

  async requireSqlUser(userId) {
    const id = trimToString(userId);
    const snapshot = await this.readSecuritySnapshot();
    const user = snapshot.users.find((item) => item && trimToString(item.id) === id);
    if (!user) {
      throw repositoryError(404, 'USER_NOT_FOUND', 'SQL security user was not found.', { userId: id });
    }
    return user;
  }

  async assertOwnProfile(requesterUserId, profileUserId) {
    const requesterId = trimToString(requesterUserId);
    const targetId = trimToString(profileUserId || requesterId);
    await this.requireSqlUser(requesterId);
    if (requesterId !== targetId) {
      throw repositoryError(403, 'PROFILE_FORBIDDEN', 'Profile can be opened only by its owner.', {
        requesterUserId: requesterId,
        profileUserId: targetId
      });
    }
    return true;
  }

  async listChatUsers(currentUserId, options = {}) {
    const me = await this.requireSqlUser(currentUserId);
    const snapshot = await this.readSecuritySnapshot();
    const onlineUsers = new Set((options.onlineUserIds || []).map(String));
    const result = await this.query({
      sql: `
        SELECT
          c.id AS conversation_id,
          peer.user_id AS peer_user_id,
          COUNT(m.id) AS message_count,
          SUM(CASE WHEN m.sender_user_id = peer.user_id AND ms.read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
        FROM chat_conversations c
        INNER JOIN chat_conversation_participants mine
          ON mine.conversation_id = c.id
         AND mine.user_id = ?
         AND mine.left_at IS NULL
        INNER JOIN chat_conversation_participants peer
          ON peer.conversation_id = c.id
         AND peer.user_id <> ?
         AND peer.left_at IS NULL
        LEFT JOIN chat_messages m
          ON m.conversation_id = c.id
         AND m.deleted_at IS NULL
        LEFT JOIN chat_message_states ms
          ON ms.message_id = m.id
         AND ms.user_id = ?
        WHERE c.conversation_type = 'direct'
          AND c.archived_at IS NULL
        GROUP BY c.id, peer.user_id
      `,
      values: [me.id, me.id, me.id],
      label: 'messaging:users:conversation-summary'
    });
    const byPeer = new Map((result.rows || []).map((row) => [trimToString(row.peer_user_id), row]));
    const users = snapshot.users
      .filter((user) => user && trimToString(user.id) && trimToString(user.id) !== trimToString(me.id))
      .map((user) => {
        const summary = byPeer.get(trimToString(user.id));
        const messageCount = Number(summary?.message_count || 0);
        return {
          id: user.id,
          name: user.name || user.username || user.login || 'User',
          isOnline: onlineUsers.has(String(user.id)),
          unreadCount: Number(summary?.unread_count || 0),
          messageCount,
          hasHistory: messageCount > 0,
          conversationId: trimToString(summary?.conversation_id) || null
        };
      });
    users.push({
      id: SYSTEM_USER_ID,
      name: 'System',
      isOnline: null,
      unreadCount: 0,
      messageCount: 0,
      hasHistory: false,
      conversationId: null
    });
    return { users };
  }

  async openDirectConversation(currentUserId, peerUserId) {
    const me = await this.requireSqlUser(currentUserId);
    const peerId = trimToString(peerUserId);
    if (!peerId || peerId === trimToString(me.id)) {
      throw repositoryError(400, 'INVALID_PEER', 'Direct conversation peer is invalid.');
    }
    if (peerId === SYSTEM_USER_ID) {
      throw repositoryError(403, 'SYSTEM_DIALOG_FORBIDDEN', 'System user dialog cannot be initiated.');
    }
    const peer = await this.requireSqlUser(peerId);
    const directKey = directConversationKey(me.id, peer.id);
    return this.inTransaction(async (tx) => {
      const existing = await tx.query({
        sql: `
          SELECT id
          FROM chat_conversations
          WHERE conversation_type = 'direct'
            AND direct_key = ?
            AND archived_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        values: [directKey],
        label: 'messaging:conversation:find-direct'
      });
      const found = existing.rows?.[0];
      if (found) return { conversationId: trimToString(found.id), created: false };

      const conversationId = this.idFactory('cvt');
      await tx.query({
        sql: `
          INSERT INTO chat_conversations (
            id, conversation_type, direct_key, created_by_user_id, created_at, updated_at
          ) VALUES (?, 'direct', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
        `,
        values: [conversationId, directKey, me.id],
        label: 'messaging:conversation:create'
      });
      for (const participantId of [me.id, peer.id]) {
        await tx.query({
          sql: `
            INSERT INTO chat_conversation_participants (
              conversation_id, user_id, participant_role, joined_at
            ) VALUES (?, ?, 'member', UTC_TIMESTAMP(3))
          `,
          values: [conversationId, participantId],
          label: 'messaging:conversation:add-participant'
        });
      }
      return { conversationId, created: true };
    }, { label: 'messaging:conversation:open-direct' });
  }

  async assertConversationParticipant(tx, conversationId, userId) {
    const result = await tx.query({
      sql: `
        SELECT c.id
        FROM chat_conversations c
        INNER JOIN chat_conversation_participants p
          ON p.conversation_id = c.id
         AND p.user_id = ?
         AND p.left_at IS NULL
        WHERE c.id = ?
          AND c.archived_at IS NULL
        LIMIT 1
      `,
      values: [trimToString(userId), trimToString(conversationId)],
      label: 'messaging:conversation:participant'
    });
    if (!result.rows?.[0]) {
      throw repositoryError(403, 'CONVERSATION_FORBIDDEN', 'User is not a conversation participant.');
    }
  }

  async getConversationMessages(currentUserId, conversationId, options = {}) {
    const user = await this.requireSqlUser(currentUserId);
    const id = trimToString(conversationId);
    await this.assertConversationParticipant(this, id, user.id);
    const limit = normalizeLimit(options.limit, 50, 200);
    const beforeSeq = normalizeSeq(options.beforeSeq);
    const filterSql = beforeSeq > 0 ? 'AND seq < ?' : '';
    const values = beforeSeq > 0 ? [id, beforeSeq, limit + 1] : [id, limit + 1];
    const messagesResult = await this.query({
      sql: `
        SELECT id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at
        FROM chat_messages
        WHERE conversation_id = ?
          AND deleted_at IS NULL
          ${filterSql}
        ORDER BY seq DESC
        LIMIT ?
      `,
      values,
      label: 'messaging:messages:list'
    });
    const rows = messagesResult.rows || [];
    const messages = rows.slice(0, limit).reverse().map(rowToMessage);
    const statesResult = await this.query({
      sql: `
        SELECT
          s.user_id,
          MAX(CASE WHEN s.delivered_at IS NOT NULL THEN m.seq ELSE 0 END) AS last_delivered_seq,
          MAX(CASE WHEN s.read_at IS NOT NULL THEN m.seq ELSE 0 END) AS last_read_seq
        FROM chat_message_states s
        INNER JOIN chat_messages m ON m.id = s.message_id
        WHERE m.conversation_id = ?
          AND m.deleted_at IS NULL
        GROUP BY s.user_id
      `,
      values: [id],
      label: 'messaging:states:conversation'
    });
    const states = {};
    for (const row of statesResult.rows || []) {
      states[trimToString(row.user_id)] = {
        lastDeliveredSeq: normalizeSeq(row.last_delivered_seq),
        lastReadSeq: normalizeSeq(row.last_read_seq)
      };
    }
    return { messages, states, hasMore: rows.length > limit };
  }

  async insertMessage(currentUserId, conversationId, input = {}) {
    const user = await this.requireSqlUser(currentUserId);
    const text = trimToString(input.text);
    const clientMsgId = trimToString(input.clientMsgId);
    if (!text) throw repositoryError(400, 'MESSAGE_TEXT_REQUIRED', 'Message text is required.');
    if (!clientMsgId) throw repositoryError(400, 'CLIENT_MSG_ID_REQUIRED', 'clientMsgId is required.');
    return this.inTransaction(async (tx) => {
      await this.assertConversationParticipant(tx, conversationId, user.id);
      const existing = await tx.query({
        sql: `
          SELECT id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at
          FROM chat_messages
          WHERE conversation_id = ?
            AND sender_user_id = ?
            AND client_msg_id = ?
            AND deleted_at IS NULL
          LIMIT 1
        `,
        values: [trimToString(conversationId), user.id, clientMsgId],
        label: 'messaging:message:idempotent-find'
      });
      if (existing.rows?.[0]) return { message: rowToMessage(existing.rows[0]), idempotent: true };

      await tx.query({
        sql: 'SELECT id FROM chat_conversations WHERE id = ? AND archived_at IS NULL LIMIT 1 FOR UPDATE',
        values: [trimToString(conversationId)],
        label: 'messaging:conversation:lock'
      });
      const maxSeq = await tx.query({
        sql: 'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM chat_messages WHERE conversation_id = ?',
        values: [trimToString(conversationId)],
        label: 'messaging:message:max-seq'
      });
      const seq = normalizeSeq(maxSeq.rows?.[0]?.max_seq) + 1;
      const messageId = this.idFactory('cmsg');
      await tx.query({
        sql: `
          INSERT INTO chat_messages (
            id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at
          ) VALUES (?, ?, ?, ?, ?, 'user', ?, UTC_TIMESTAMP(3))
        `,
        values: [messageId, trimToString(conversationId), seq, clientMsgId, user.id, text],
        label: 'messaging:message:insert'
      });
      await tx.query({
        sql: 'UPDATE chat_conversations SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
        values: [trimToString(conversationId)],
        label: 'messaging:conversation:touch'
      });
      return {
        message: {
          id: messageId,
          conversationId: trimToString(conversationId),
          seq,
          senderId: user.id,
          text,
          createdAt: null,
          clientMsgId
        },
        idempotent: false
      };
    }, { label: 'messaging:message:insert', idempotent: true, retries: 1 });
  }

  async markDelivered(currentUserId, conversationId, lastDeliveredSeq) {
    return this.markState(currentUserId, conversationId, lastDeliveredSeq, { read: false });
  }

  async markRead(currentUserId, conversationId, lastReadSeq) {
    return this.markState(currentUserId, conversationId, lastReadSeq, { read: true });
  }

  async markState(currentUserId, conversationId, requestedSeq, options = {}) {
    const user = await this.requireSqlUser(currentUserId);
    const id = trimToString(conversationId);
    return this.inTransaction(async (tx) => {
      await this.assertConversationParticipant(tx, id, user.id);
      const maxSeqResult = await tx.query({
        sql: 'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM chat_messages WHERE conversation_id = ? AND deleted_at IS NULL',
        values: [id],
        label: 'messaging:state:max-seq'
      });
      const maxSeq = normalizeSeq(maxSeqResult.rows?.[0]?.max_seq);
      const nextSeq = Math.min(maxSeq, normalizeSeq(requestedSeq));
      const messages = await tx.query({
        sql: `
          SELECT id, seq
          FROM chat_messages
          WHERE conversation_id = ?
            AND seq <= ?
            AND deleted_at IS NULL
          ORDER BY seq
        `,
        values: [id, nextSeq],
        label: 'messaging:state:messages'
      });
      for (const message of messages.rows || []) {
        if (options.read) {
          await tx.query({
            sql: `
              INSERT INTO chat_message_states (message_id, user_id, delivered_at, read_at, updated_at)
              VALUES (?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
              ON DUPLICATE KEY UPDATE
                delivered_at = COALESCE(delivered_at, VALUES(delivered_at)),
                read_at = COALESCE(read_at, VALUES(read_at)),
                updated_at = UTC_TIMESTAMP(3)
            `,
            values: [message.id, user.id],
            label: 'messaging:state:read-upsert'
          });
        } else {
          await tx.query({
            sql: `
              INSERT INTO chat_message_states (message_id, user_id, delivered_at, read_at, updated_at)
              VALUES (?, ?, UTC_TIMESTAMP(3), NULL, UTC_TIMESTAMP(3))
              ON DUPLICATE KEY UPDATE
                delivered_at = COALESCE(delivered_at, VALUES(delivered_at)),
                updated_at = UTC_TIMESTAMP(3)
            `,
            values: [message.id, user.id],
            label: 'messaging:state:delivered-upsert'
          });
        }
      }
      if (options.read) {
        const lastMessage = [...(messages.rows || [])].reverse().find((message) => normalizeSeq(message.seq) === nextSeq);
        await tx.query({
          sql: 'UPDATE chat_conversation_participants SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?',
          values: [lastMessage?.id || null, id, user.id],
          label: 'messaging:participant:last-read'
        });
      }
      return options.read
        ? { ok: true, lastReadSeq: nextSeq }
        : { ok: true, lastDeliveredSeq: nextSeq };
    }, { label: options.read ? 'messaging:state:read' : 'messaging:state:delivered', idempotent: true, retries: 1 });
  }

  async getUnreadCount(currentUserId) {
    const user = await this.requireSqlUser(currentUserId);
    const result = await this.query({
      sql: `
        SELECT COUNT(*) AS count
        FROM chat_messages m
        INNER JOIN chat_conversation_participants p
          ON p.conversation_id = m.conversation_id
         AND p.user_id = ?
         AND p.left_at IS NULL
        LEFT JOIN chat_message_states s
          ON s.message_id = m.id
         AND s.user_id = ?
        WHERE m.sender_user_id <> ?
          AND m.deleted_at IS NULL
          AND s.read_at IS NULL
      `,
      values: [user.id, user.id, user.id],
      label: 'messaging:unread-count'
    });
    return Number(result.rows?.[0]?.count || 0);
  }

  async appendUserVisit(userId, routePath = '/') {
    const user = await this.requireSqlUser(userId);
    const id = this.idFactory('visit');
    await this.query({
      sql: 'INSERT INTO user_visits (id, user_id, route_path, visited_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))',
      values: [id, user.id, trimToString(routePath) || '/'],
      label: 'profile:user-visit:append'
    });
    return { id, userId: user.id };
  }

  async appendUserAction(input = {}) {
    const user = input.userId ? await this.requireSqlUser(input.userId) : null;
    const actor = input.actorUserId ? await this.requireSqlUser(input.actorUserId) : null;
    const id = trimToString(input.id) || this.idFactory('act');
    await this.query({
      sql: `
        INSERT INTO user_actions (
          id, user_id, actor_user_id, domain, entity_type, entity_id, action_type, message, route_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
      `,
      values: [
        id,
        user?.id || null,
        actor?.id || null,
        trimToString(input.domain) || 'profile',
        trimToString(input.entityType) || null,
        trimToString(input.entityId) || null,
        trimToString(input.actionType) || 'user-action',
        trimToString(input.message || input.text) || null,
        trimToString(input.routePath) || null
      ],
      label: 'profile:user-action:append'
    });
    return { id, userId: user?.id || null };
  }

  async listOwnUserActions(requesterUserId, targetUserId, options = {}) {
    await this.assertOwnProfile(requesterUserId, targetUserId || requesterUserId);
    const limit = normalizeLimit(options.limit, 200, 500);
    const result = await this.query({
      sql: `
        SELECT id, user_id, actor_user_id, domain, entity_type, entity_id, action_type, message, route_path, created_at
        FROM user_actions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      values: [trimToString(requesterUserId), limit],
      label: 'profile:user-actions:list-own'
    });
    return { actions: (result.rows || []).map(rowToAction) };
  }

  async upsertWebPushSubscription(userId, subscription, userAgent = '') {
    const user = await this.requireSqlUser(userId);
    const endpoint = trimToString(subscription?.endpoint);
    const keys = subscription?.keys || {};
    if (!endpoint || !trimToString(keys.p256dh) || !trimToString(keys.auth)) {
      throw repositoryError(400, 'INVALID_WEB_PUSH_SUBSCRIPTION', 'WebPush subscription is invalid.');
    }
    const id = this.idFactory('wps');
    const encryptedPayload = JSON.stringify({
      endpoint,
      keys: { p256dh: trimToString(keys.p256dh), auth: trimToString(keys.auth) },
      subscription,
      userAgent: trimToString(userAgent)
    });
    await this.query({
      sql: `
        INSERT INTO web_push_subscriptions (
          id, user_id, endpoint_hash, encrypted_payload_json, user_agent_hash, created_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)
        ON DUPLICATE KEY UPDATE
          user_id = VALUES(user_id),
          encrypted_payload_json = VALUES(encrypted_payload_json),
          user_agent_hash = VALUES(user_agent_hash),
          last_seen_at = UTC_TIMESTAMP(3),
          revoked_at = NULL
      `,
      values: [id, user.id, sha256Buffer(endpoint), encryptedPayload, userAgent ? sha256Buffer(userAgent) : null],
      label: 'notifications:webpush:upsert'
    });
    return { id, userId: user.id, endpointHash: sha256Buffer(endpoint).toString('hex') };
  }

  async unsubscribeWebPush(userId, endpoint) {
    const user = await this.requireSqlUser(userId);
    await this.query({
      sql: `
        UPDATE web_push_subscriptions
        SET revoked_at = UTC_TIMESTAMP(3), last_seen_at = UTC_TIMESTAMP(3)
        WHERE user_id = ?
          AND endpoint_hash = ?
          AND revoked_at IS NULL
      `,
      values: [user.id, sha256Buffer(endpoint)],
      label: 'notifications:webpush:revoke'
    });
    return { ok: true };
  }

  async listActiveWebPushSubscriptionsByUser(userId) {
    const user = await this.requireSqlUser(userId);
    const result = await this.query({
      sql: `
        SELECT id, encrypted_payload_json, last_seen_at
        FROM web_push_subscriptions
        WHERE user_id = ?
          AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, created_at DESC
      `,
      values: [user.id],
      label: 'notifications:webpush:list-active'
    });
    return (result.rows || []).map((row) => ({
      id: trimToString(row.id),
      ...(parseJson(row.encrypted_payload_json, {}) || {}),
      lastSeenAt: toIso(row.last_seen_at)
    }));
  }

  async upsertFcmToken(userId, tokenEntry = {}) {
    const user = await this.requireSqlUser(userId);
    const token = trimToString(tokenEntry.token);
    if (!token) throw repositoryError(400, 'INVALID_FCM_TOKEN', 'FCM token is invalid.');
    const id = this.idFactory('fcm');
    await this.query({
      sql: `
        INSERT INTO fcm_tokens (
          id, user_id, token_hash, token_ciphertext, device_id, created_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)
        ON DUPLICATE KEY UPDATE
          user_id = VALUES(user_id),
          token_ciphertext = VALUES(token_ciphertext),
          device_id = VALUES(device_id),
          last_seen_at = UTC_TIMESTAMP(3),
          revoked_at = NULL
      `,
      values: [id, user.id, sha256Buffer(token), token, trimToString(tokenEntry.deviceId || tokenEntry.device) || null],
      label: 'notifications:fcm:upsert'
    });
    return { id, userId: user.id, tokenHash: sha256Buffer(token).toString('hex') };
  }

  async revokeFcmToken(userId, token) {
    const user = await this.requireSqlUser(userId);
    await this.query({
      sql: `
        UPDATE fcm_tokens
        SET revoked_at = UTC_TIMESTAMP(3), last_seen_at = UTC_TIMESTAMP(3)
        WHERE user_id = ?
          AND token_hash = ?
          AND revoked_at IS NULL
      `,
      values: [user.id, sha256Buffer(token)],
      label: 'notifications:fcm:revoke'
    });
    return { ok: true };
  }

  async listActiveFcmTokensByUser(userId) {
    const user = await this.requireSqlUser(userId);
    const result = await this.query({
      sql: `
        SELECT id, token_ciphertext, device_id, last_seen_at
        FROM fcm_tokens
        WHERE user_id = ?
          AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, created_at DESC
      `,
      values: [user.id],
      label: 'notifications:fcm:list-active'
    });
    return (result.rows || []).map((row) => ({
      id: trimToString(row.id),
      token: trimToString(row.token_ciphertext),
      deviceId: trimToString(row.device_id),
      lastSeenAt: toIso(row.last_seen_at)
    }));
  }
}

module.exports = {
  MessagingProfileRepository,
  directConversationKey,
  sha256Buffer
};
