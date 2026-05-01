const crypto = require('node:crypto');

const { BaseRepository } = require('./baseRepository');
const { sqlLimit } = require('../persistence/mysql/identifiers');

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

function buildFcmDevicePayload(entry = {}) {
  const platform = trimToString(entry.platform);
  const device = trimToString(entry.device || entry.deviceName);
  const deviceId = trimToString(entry.deviceId || entry.device_id);
  if (platform) {
    return JSON.stringify({
      platform,
      device: device || deviceId || null,
      deviceId: deviceId || device || null
    });
  }
  return deviceId || device || null;
}

function parseFcmDevicePayload(value) {
  const text = trimToString(value);
  if (!text) return { platform: '', device: '', deviceId: '' };
  const parsed = parseJson(text, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const deviceId = trimToString(parsed.deviceId || parsed.device_id || parsed.device);
    const device = trimToString(parsed.device || parsed.deviceId || parsed.device_id);
    return {
      platform: trimToString(parsed.platform),
      device,
      deviceId
    };
  }
  return {
    platform: '',
    device: text,
    deviceId: text
  };
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

function rowToConversation(row, participants = []) {
  const systemContext = parseJson(row?.system_context_json, null);
  const contextParticipants = Array.isArray(systemContext?.participantIds)
    ? systemContext.participantIds.map(trimToString).filter(Boolean)
    : [];
  const participantIds = contextParticipants.length
    ? contextParticipants
    : participants.map(trimToString).filter(Boolean);
  const lastMessagePreview = trimToString(row?.last_message_preview || systemContext?.lastMessagePreview || '');
  return {
    id: trimToString(row.id),
    type: trimToString(systemContext?.originalType || row.conversation_type || 'direct') || 'direct',
    participantIds,
    createdAt: toIso(row.created_at),
    lastMessageId: trimToString(row.last_message_id) || null,
    lastMessageAt: toIso(row.last_message_at || row.updated_at),
    lastMessagePreview: lastMessagePreview || null
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

function rowToFcmToken(row) {
  const device = parseFcmDevicePayload(row?.device_id);
  return {
    id: trimToString(row.id),
    userId: trimToString(row.user_id),
    token: trimToString(row.token_ciphertext),
    platform: device.platform,
    device: device.device,
    deviceId: device.deviceId,
    lastSeenAt: toIso(row.last_seen_at)
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

  async appendMessagingEvent(tx, input = {}) {
    return this.appendDomainEvent(tx, {
      domain: 'messaging-profile',
      route: input.route || '/profile',
      ...input
    });
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
    const systemResult = await this.query({
      sql: `
        SELECT
          c.id AS conversation_id,
          COUNT(m.id) AS message_count,
          SUM(CASE WHEN m.sender_kind = 'system' AND s.read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
        FROM chat_conversations c
        INNER JOIN chat_conversation_participants mine
          ON mine.conversation_id = c.id
         AND mine.user_id = ?
         AND mine.left_at IS NULL
        LEFT JOIN chat_messages m
          ON m.conversation_id = c.id
         AND m.deleted_at IS NULL
        LEFT JOIN chat_message_states s
          ON s.message_id = m.id
         AND s.user_id = ?
        WHERE c.conversation_type = 'system-direct'
          AND c.archived_at IS NULL
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT 1
      `,
      values: [me.id, me.id],
      label: 'messaging:users:system-summary'
    });
    const systemSummary = systemResult.rows?.[0] || null;
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
      name: 'Система',
      isOnline: null,
      unreadCount: Number(systemSummary?.unread_count || 0),
      messageCount: Number(systemSummary?.message_count || 0),
      hasHistory: Number(systemSummary?.message_count || 0) > 0,
      conversationId: trimToString(systemSummary?.conversation_id) || null
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
      await this.appendMessagingEvent(tx, {
        entity: 'chat.conversation',
        id: conversationId,
        version: 1,
        eventType: 'chat.conversation.opened',
        transportEventName: 'unread_count',
        actorUserId: me.id,
        hints: {
          conversationId,
          peerId: peer.id,
          recipientUserIds: [me.id, peer.id],
          count: null,
          needsUsers: true
        }
      });
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

  async getDirectConversationPeerId(tx, conversationId, userId) {
    const result = await tx.query({
      sql: `
        SELECT peer.user_id AS peer_user_id
        FROM chat_conversation_participants mine
        INNER JOIN chat_conversation_participants peer
          ON peer.conversation_id = mine.conversation_id
         AND peer.user_id <> mine.user_id
         AND peer.left_at IS NULL
        INNER JOIN chat_conversations c
          ON c.id = mine.conversation_id
         AND c.conversation_type = 'direct'
         AND c.archived_at IS NULL
        WHERE mine.conversation_id = ?
          AND mine.user_id = ?
          AND mine.left_at IS NULL
        LIMIT 1
      `,
      values: [trimToString(conversationId), trimToString(userId)],
      label: 'messaging:conversation:direct-peer'
    });
    const peerUserId = trimToString(result.rows?.[0]?.peer_user_id);
    if (peerUserId) return peerUserId;

    const systemResult = await tx.query({
      sql: `
        SELECT c.id
        FROM chat_conversations c
        INNER JOIN chat_conversation_participants p
          ON p.conversation_id = c.id
         AND p.user_id = ?
         AND p.left_at IS NULL
        WHERE c.id = ?
          AND c.conversation_type = 'system-direct'
          AND c.archived_at IS NULL
        LIMIT 1
      `,
      values: [trimToString(userId), trimToString(conversationId)],
      label: 'messaging:conversation:system-peer'
    });
    return systemResult.rows?.[0] ? SYSTEM_USER_ID : '';
  }

  async assertDirectConversationPeer(tx, conversationId, userId, peerUserId) {
    const expectedPeerId = trimToString(peerUserId);
    if (!expectedPeerId) return true;
    const peerId = await this.getDirectConversationPeerId(tx, conversationId, userId);
    if (peerId !== expectedPeerId) {
      throw repositoryError(403, 'CONVERSATION_PEER_MISMATCH', 'Conversation does not match requested peer.', {
        conversationId: trimToString(conversationId),
        userId: trimToString(userId),
        peerUserId: expectedPeerId,
        actualPeerUserId: peerId || null
      });
    }
    return true;
  }

  async getConversationMessages(currentUserId, conversationId, options = {}) {
    const user = await this.requireSqlUser(currentUserId);
    const id = trimToString(conversationId);
    await this.assertConversationParticipant(this, id, user.id);
    await this.assertDirectConversationPeer(this, id, user.id, options.peerUserId);
    const limit = normalizeLimit(options.limit, 50, 200);
    const sqlRowsLimit = sqlLimit(limit + 1, { min: 1, max: 201 });
    const beforeSeq = normalizeSeq(options.beforeSeq);
    const filterSql = beforeSeq > 0 ? 'AND seq < ?' : '';
    const values = beforeSeq > 0 ? [id, beforeSeq] : [id];
    const messagesResult = await this.query({
      sql: `
        SELECT id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at
        FROM chat_messages
        WHERE conversation_id = ?
          AND deleted_at IS NULL
          ${filterSql}
        ORDER BY seq DESC
        LIMIT ${sqlRowsLimit}
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
      const peerId = await this.getDirectConversationPeerId(tx, conversationId, user.id);
      if (peerId === SYSTEM_USER_ID) {
        throw repositoryError(403, 'SYSTEM_DIALOG_FORBIDDEN', 'System user dialog cannot be initiated.');
      }
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
      const createdAt = new Date().toISOString();
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
      const message = {
        id: messageId,
        conversationId: trimToString(conversationId),
        seq,
        senderId: user.id,
        text,
        createdAt,
        clientMsgId
      };
      await this.appendMessagingEvent(tx, {
        entity: 'chat.message',
        id: messageId,
        version: seq,
        eventType: 'chat.message.created',
        transportEventName: 'message_new',
        actorUserId: user.id,
        hints: {
          conversationId: trimToString(conversationId),
          message,
          recipientUserIds: [user.id, peerId].filter(Boolean),
          needsUsers: true,
          needsActive: true
        }
      });
      return {
        message,
        idempotent: false
      };
    }, { label: 'messaging:message:insert', idempotent: true, retries: 1 });
  }

  async appendSystemMessage(userId, text) {
    const user = await this.requireSqlUser(userId);
    const body = trimToString(text);
    if (!body) throw repositoryError(400, 'MESSAGE_TEXT_REQUIRED', 'Message text is required.');
    return this.inTransaction(async (tx) => {
      const directKey = directConversationKey(SYSTEM_USER_ID, user.id);
      const existing = await tx.query({
        sql: `
          SELECT id
          FROM chat_conversations
          WHERE conversation_type = 'system-direct'
            AND direct_key = ?
            AND archived_at IS NULL
          LIMIT 1
          FOR UPDATE
        `,
        values: [directKey],
        label: 'messaging:system-conversation:find'
      });
      let conversationId = trimToString(existing.rows?.[0]?.id);
      if (!conversationId) {
        conversationId = this.idFactory('cvt');
        await tx.query({
          sql: `
            INSERT INTO chat_conversations (
              id, conversation_type, direct_key, system_context_json, created_by_user_id, created_at, updated_at
            ) VALUES (?, 'system-direct', ?, ?, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
          `,
          values: [
            conversationId,
            directKey,
            JSON.stringify({
              participantIds: [SYSTEM_USER_ID, user.id],
              originalType: 'direct',
              source: 'system-notification'
            })
          ],
          label: 'messaging:system-conversation:create'
        });
        await tx.query({
          sql: `
            INSERT INTO chat_conversation_participants (
              conversation_id, user_id, participant_role, joined_at
            ) VALUES (?, ?, 'member', UTC_TIMESTAMP(3))
          `,
          values: [conversationId, user.id],
          label: 'messaging:system-conversation:add-participant'
        });
      }

      const maxSeq = await tx.query({
        sql: 'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM chat_messages WHERE conversation_id = ?',
        values: [conversationId],
        label: 'messaging:system-message:max-seq'
      });
      const seq = normalizeSeq(maxSeq.rows?.[0]?.max_seq) + 1;
      const messageId = this.idFactory('cmsg');
      const createdAt = new Date().toISOString();
      await tx.query({
        sql: `
          INSERT INTO chat_messages (
            id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at
          ) VALUES (?, ?, ?, NULL, NULL, 'system', ?, UTC_TIMESTAMP(3))
        `,
        values: [messageId, conversationId, seq, body],
        label: 'messaging:system-message:insert'
      });
      await tx.query({
        sql: 'UPDATE chat_conversations SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
        values: [conversationId],
        label: 'messaging:system-conversation:touch'
      });
      const message = {
        id: messageId,
        conversationId,
        seq,
        senderId: SYSTEM_USER_ID,
        text: body,
        createdAt,
        clientMsgId: ''
      };
      await this.appendMessagingEvent(tx, {
        entity: 'chat.message',
        id: messageId,
        version: seq,
        eventType: 'chat.message.created',
        transportEventName: 'message_new',
        actorUserId: SYSTEM_USER_ID,
        hints: {
          conversationId,
          message,
          recipientUserIds: [user.id],
          needsUsers: true,
          needsActive: true
        }
      });
      return {
        conversationId,
        message
      };
    }, { label: 'messaging:system-message:append', idempotent: false });
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
      const peerId = await this.getDirectConversationPeerId(tx, id, user.id);
      const eventName = options.read ? 'read_update' : 'delivered_update';
      const seqKey = options.read ? 'lastReadSeq' : 'lastDeliveredSeq';
      await this.appendMessagingEvent(tx, {
        entity: options.read ? 'chat.read-state' : 'chat.delivered-state',
        id: `${id}:${user.id}`,
        version: nextSeq,
        eventType: options.read ? 'chat.message.read' : 'chat.message.delivered',
        transportEventName: eventName,
        actorUserId: user.id,
        hints: {
          conversationId: id,
          userId: user.id,
          [seqKey]: nextSeq,
          recipientUserIds: [user.id, peerId].filter(Boolean),
          needsUsers: true,
          needsActive: true
        }
      });
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
    return this.inTransaction(async (tx) => {
      await tx.query({
        sql: 'INSERT INTO user_visits (id, user_id, route_path, visited_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))',
        values: [id, user.id, trimToString(routePath) || '/'],
        label: 'profile:user-visit:append'
      });
      await this.appendMessagingEvent(tx, {
        entity: 'profile.user-visit',
        id,
        eventType: 'profile.user-visit.created',
        transportEventName: 'profile.user-visit.created',
        actorUserId: user.id,
        route: trimToString(routePath) || '/',
        hints: { userId: user.id }
      });
      return { id, userId: user.id };
    }, { label: 'profile:user-visit:append' });
  }

  async appendUserAction(input = {}) {
    const user = input.userId ? await this.requireSqlUser(input.userId) : null;
    const actor = input.actorUserId ? await this.requireSqlUser(input.actorUserId) : null;
    const id = trimToString(input.id) || this.idFactory('act');
    return this.inTransaction(async (tx) => {
      await tx.query({
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
      await this.appendMessagingEvent(tx, {
        entity: 'profile.user-action',
        id,
        eventType: 'profile.user-action.created',
        transportEventName: 'profile.user-action.created',
        actorUserId: actor?.id || user?.id || null,
        route: trimToString(input.routePath) || '/profile',
        hints: {
          userId: user?.id || null,
          entityId: trimToString(input.entityId) || null
        }
      });
      return { id, userId: user?.id || null };
    }, { label: 'profile:user-action:append' });
  }

  async listOwnUserActions(requesterUserId, targetUserId, options = {}) {
    await this.assertOwnProfile(requesterUserId, targetUserId || requesterUserId);
    const limit = normalizeLimit(options.limit, 200, 500);
    const sqlRowsLimit = sqlLimit(limit, { min: 1, max: 500 });
    const result = await this.query({
      sql: `
        SELECT id, user_id, actor_user_id, domain, entity_type, entity_id, action_type, message, route_path, created_at
        FROM user_actions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ${sqlRowsLimit}
      `,
      values: [trimToString(requesterUserId)],
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
    return this.inTransaction(async (tx) => {
      await tx.query({
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
      await this.appendMessagingEvent(tx, {
        entity: 'notification.webpush-subscription',
        id,
        eventType: 'notification.webpush.owned',
        transportEventName: 'notification.webpush.owned',
        actorUserId: user.id,
        hints: { userId: user.id }
      });
      return { id, userId: user.id, endpointHash: sha256Buffer(endpoint).toString('hex') };
    }, { label: 'notifications:webpush:upsert' });
  }

  async unsubscribeWebPush(userId, endpoint) {
    const user = await this.requireSqlUser(userId);
    return this.inTransaction(async (tx) => {
      await tx.query({
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
      await this.appendMessagingEvent(tx, {
        entity: 'notification.webpush-subscription',
        id: sha256Buffer(endpoint).toString('hex'),
        eventType: 'notification.webpush.revoked',
        transportEventName: 'notification.webpush.revoked',
        actorUserId: user.id,
        hints: { userId: user.id }
      });
      return { ok: true };
    }, { label: 'notifications:webpush:revoke' });
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
    return this.inTransaction(async (tx) => {
      await tx.query({
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
        values: [id, user.id, sha256Buffer(token), token, buildFcmDevicePayload(tokenEntry)],
        label: 'notifications:fcm:upsert'
      });
      await this.appendMessagingEvent(tx, {
        entity: 'notification.fcm-token',
        id,
        eventType: 'notification.fcm.owned',
        transportEventName: 'notification.fcm.owned',
        actorUserId: user.id,
        hints: { userId: user.id }
      });
      return { id, userId: user.id, tokenHash: sha256Buffer(token).toString('hex') };
    }, { label: 'notifications:fcm:upsert' });
  }

  async revokeFcmToken(userId, token) {
    const user = await this.requireSqlUser(userId);
    return this.inTransaction(async (tx) => {
      await tx.query({
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
      await this.appendMessagingEvent(tx, {
        entity: 'notification.fcm-token',
        id: sha256Buffer(token).toString('hex'),
        eventType: 'notification.fcm.revoked',
        transportEventName: 'notification.fcm.revoked',
        actorUserId: user.id,
        hints: { userId: user.id }
      });
      return { ok: true };
    }, { label: 'notifications:fcm:revoke' });
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
    return (result.rows || []).map(rowToFcmToken);
  }

  async readCompatibilitySnapshot() {
    const conversationsResult = await this.query({
      sql: `
        SELECT
          c.id,
          c.conversation_type,
          c.system_context_json,
          c.created_at,
          c.updated_at,
          last_msg.id AS last_message_id,
          last_msg.created_at AS last_message_at,
          last_msg.body AS last_message_preview
        FROM chat_conversations c
        LEFT JOIN chat_messages last_msg
          ON last_msg.id = (
            SELECT m.id
            FROM chat_messages m
            WHERE m.conversation_id = c.id
              AND m.deleted_at IS NULL
            ORDER BY m.seq DESC
            LIMIT 1
          )
        WHERE c.archived_at IS NULL
        ORDER BY c.updated_at DESC, c.created_at DESC
      `,
      values: [],
      label: 'messaging:compat:conversations'
    });
    const participantsResult = await this.query({
      sql: `
        SELECT conversation_id, user_id
        FROM chat_conversation_participants
        WHERE left_at IS NULL
        ORDER BY conversation_id, user_id
      `,
      values: [],
      label: 'messaging:compat:participants'
    });
    const participantsByConversation = new Map();
    for (const row of participantsResult.rows || []) {
      const conversationId = trimToString(row.conversation_id);
      if (!participantsByConversation.has(conversationId)) participantsByConversation.set(conversationId, []);
      participantsByConversation.get(conversationId).push(trimToString(row.user_id));
    }

    const messagesResult = await this.query({
      sql: `
        SELECT id, conversation_id, seq, client_msg_id, sender_user_id, sender_kind, body, created_at
        FROM chat_messages
        WHERE deleted_at IS NULL
        ORDER BY conversation_id, seq
      `,
      values: [],
      label: 'messaging:compat:messages'
    });
    const statesResult = await this.query({
      sql: `
        SELECT
          m.conversation_id,
          s.user_id,
          MAX(CASE WHEN s.delivered_at IS NOT NULL THEN m.seq ELSE 0 END) AS last_delivered_seq,
          MAX(CASE WHEN s.read_at IS NOT NULL THEN m.seq ELSE 0 END) AS last_read_seq,
          MAX(s.updated_at) AS updated_at
        FROM chat_message_states s
        INNER JOIN chat_messages m ON m.id = s.message_id
        WHERE m.deleted_at IS NULL
        GROUP BY m.conversation_id, s.user_id
        ORDER BY m.conversation_id, s.user_id
      `,
      values: [],
      label: 'messaging:compat:states'
    });
    const visitsResult = await this.query({
      sql: `
        SELECT id, user_id, route_path, visited_at
        FROM user_visits
        ORDER BY visited_at DESC
      `,
      values: [],
      label: 'profile:compat:visits'
    });
    const actionsResult = await this.query({
      sql: `
        SELECT id, user_id, actor_user_id, domain, entity_type, entity_id, action_type, message, route_path, created_at
        FROM user_actions
        ORDER BY created_at DESC
      `,
      values: [],
      label: 'profile:compat:actions'
    });
    const webPushResult = await this.query({
      sql: `
        SELECT id, user_id, encrypted_payload_json, last_seen_at
        FROM web_push_subscriptions
        WHERE revoked_at IS NULL
        ORDER BY last_seen_at DESC, created_at DESC
      `,
      values: [],
      label: 'notifications:compat:webpush'
    });
    const fcmResult = await this.query({
      sql: `
        SELECT id, user_id, token_ciphertext, device_id, last_seen_at
        FROM fcm_tokens
        WHERE revoked_at IS NULL
        ORDER BY last_seen_at DESC, created_at DESC
      `,
      values: [],
      label: 'notifications:compat:fcm'
    });

    return {
      messages: [],
      chatConversations: (conversationsResult.rows || []).map((row) => rowToConversation(
        row,
        participantsByConversation.get(trimToString(row.id)) || []
      )),
      chatMessages: (messagesResult.rows || []).map(rowToMessage),
      chatStates: (statesResult.rows || []).map((row) => ({
        conversationId: trimToString(row.conversation_id),
        userId: trimToString(row.user_id),
        lastDeliveredSeq: normalizeSeq(row.last_delivered_seq),
        lastReadSeq: normalizeSeq(row.last_read_seq),
        updatedAt: toIso(row.updated_at)
      })),
      userVisits: (visitsResult.rows || []).map((row) => ({
        id: trimToString(row.id),
        userId: trimToString(row.user_id),
        routePath: trimToString(row.route_path),
        at: toIso(row.visited_at)
      })),
      userActions: (actionsResult.rows || []).map(rowToAction),
      webPushSubscriptions: (webPushResult.rows || []).map((row) => ({
        id: trimToString(row.id),
        userId: trimToString(row.user_id),
        ...(parseJson(row.encrypted_payload_json, {}) || {}),
        lastSeenAt: toIso(row.last_seen_at)
      })),
      fcmTokens: (fcmResult.rows || []).map(rowToFcmToken)
    };
  }
}

module.exports = {
  MessagingProfileRepository,
  directConversationKey,
  sha256Buffer
};
