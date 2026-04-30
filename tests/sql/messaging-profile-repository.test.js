const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MessagingProfileRepository,
  directConversationKey,
  sha256Buffer
} = require('../../server/repositories/messagingProfileRepository');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function createSecurityRepository(users = [
  { id: 'user_a', name: 'User A', accessLevelId: 'level_user' },
  { id: 'user_b', name: 'User B', accessLevelId: 'level_user' },
  { id: 'user_c', name: 'User C', accessLevelId: 'level_user' }
]) {
  return {
    async readSnapshot() {
      return {
        users,
        accessLevels: [{ id: 'level_user', name: 'Users' }]
      };
    }
  };
}

function createPool(handler) {
  const calls = [];
  const execute = async (sql, values = []) => {
    calls.push({ sql, values });
    return handler(sql, values, calls);
  };
  const connection = {
    execute,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {}
  };
  return {
    calls,
    pool: {
      execute,
      async getConnection() {
        return connection;
      }
    }
  };
}

function createRepository(handler, options = {}) {
  const { pool, calls } = createPool(handler);
  const repository = new MessagingProfileRepository({
    pool,
    securityRepository: options.securityRepository || createSecurityRepository(),
    idFactory: options.idFactory || ((prefix) => `${prefix}_fixed`)
  });
  return { repository, calls };
}

test('messaging repository lists current chat user shape from SQL conversation state and Stage 6 users', async () => {
  const { repository, calls } = createRepository(async (sql) => {
    if (/FROM chat_conversations c/i.test(sql)) {
      return [[{
        conversation_id: 'cvt_1',
        peer_user_id: 'user_b',
        message_count: 3,
        unread_count: 2
      }], []];
    }
    return [[], []];
  });

  const result = await repository.listChatUsers('user_a', { onlineUserIds: ['user_b'] });

  const peer = result.users.find((user) => user.id === 'user_b');
  assert.equal(peer.conversationId, 'cvt_1');
  assert.equal(peer.unreadCount, 2);
  assert.equal(peer.messageCount, 3);
  assert.equal(peer.hasHistory, true);
  assert.equal(peer.isOnline, true);
  assert.equal(result.users.some((user) => user.id === 'system'), true);
  assert.deepEqual(calls[0].values, ['user_a', 'user_a', 'user_a']);
  assert.match(calls[0].sql, /chat_message_states/);
});

test('direct conversation create/find is SQL-owned and rejects system user initiation', async () => {
  const { repository, calls } = createRepository(async (sql) => {
    if (/SELECT id\s+FROM chat_conversations/i.test(sql)) return [[], []];
    return [[], []];
  }, { idFactory: (prefix) => `${prefix}_new` });

  assert.equal(directConversationKey('user_b', 'user_a'), 'user_a:user_b');
  const result = await repository.openDirectConversation('user_a', 'user_b');

  assert.deepEqual(result, { conversationId: 'cvt_new', created: true });
  assert.equal(calls.some((call) => /INSERT INTO chat_conversations/i.test(call.sql)), true);
  assert.equal(calls.filter((call) => /INSERT INTO chat_conversation_participants/i.test(call.sql)).length, 2);
  assert.equal(calls.every((call) => !/database\.json|\/api\/data/i.test(call.sql)), true);

  await assert.rejects(
    () => repository.openDirectConversation('user_a', 'system'),
    /System user dialog cannot be initiated/
  );
});

test('message insert uses idempotent clientMsgId and parameterized SQL', async () => {
  const { repository, calls } = createRepository(async (sql) => {
    if (/INNER JOIN chat_conversation_participants p/i.test(sql)) return [[{ id: 'cvt_1' }], []];
    if (/messaging:message:idempotent-find/.test(sql)) return [[], []];
    if (/SELECT id FROM chat_conversations/i.test(sql)) return [[{ id: 'cvt_1' }], []];
    if (/COALESCE\(MAX\(seq\)/i.test(sql)) return [[{ max_seq: 4 }], []];
    return [[], []];
  }, { idFactory: (prefix) => `${prefix}_new` });

  const result = await repository.insertMessage('user_a', 'cvt_1', {
    text: 'Hello',
    clientMsgId: 'client-1'
  });

  assert.equal(result.message.id, 'cmsg_new');
  assert.equal(result.message.seq, 5);
  const insert = calls.find((call) => /INSERT INTO chat_messages/i.test(call.sql));
  assert.deepEqual(insert.values, ['cmsg_new', 'cvt_1', 5, 'client-1', 'user_a', 'Hello']);
  assert.equal(calls.every((call) => Array.isArray(call.values)), true);
  assert.equal(calls.some((call) => /\$\{/.test(call.sql)), false);
});

test('delivered/read state update writes per-message SQL state and unread count is SQL-derived', async () => {
  const { repository, calls } = createRepository(async (sql) => {
    if (/COUNT\(\*\) AS count/i.test(sql)) return [[{ count: 7 }], []];
    if (/INNER JOIN chat_conversation_participants p/i.test(sql)) return [[{ id: 'cvt_1' }], []];
    if (/COALESCE\(MAX\(seq\)/i.test(sql)) return [[{ max_seq: 3 }], []];
    if (/SELECT id, seq\s+FROM chat_messages/i.test(sql)) {
      return [[
        { id: 'm1', seq: 1 },
        { id: 'm2', seq: 2 },
        { id: 'm3', seq: 3 }
      ], []];
    }
    return [[], []];
  });

  assert.deepEqual(await repository.markDelivered('user_a', 'cvt_1', 2), { ok: true, lastDeliveredSeq: 2 });
  assert.deepEqual(await repository.markRead('user_a', 'cvt_1', 99), { ok: true, lastReadSeq: 3 });
  assert.equal(await repository.getUnreadCount('user_a'), 7);

  assert.equal(calls.some((call) => /chat_message_states/i.test(call.sql) && /delivered_at/i.test(call.sql)), true);
  assert.equal(calls.some((call) => /chat_message_states/i.test(call.sql) && /read_at/i.test(call.sql)), true);
  assert.equal(calls.some((call) => /last_read_message_id/i.test(call.sql)), true);
});

test('own user actions read denies foreign profile and appends through profile/audit boundary', async () => {
  const { repository, calls } = createRepository(async (sql) => {
    if (/FROM user_actions/i.test(sql)) {
      return [[{
        id: 'act_1',
        user_id: 'user_a',
        actor_user_id: 'user_a',
        domain: 'profile',
        action_type: 'user-action',
        message: 'Opened profile',
        created_at: '2026-04-30 10:00:00.000'
      }], []];
    }
    return [[], []];
  }, { idFactory: (prefix) => `${prefix}_new` });

  const own = await repository.listOwnUserActions('user_a', 'user_a', { limit: 10 });
  assert.equal(own.actions[0].id, 'act_1');
  await assert.rejects(
    () => repository.listOwnUserActions('user_a', 'user_b'),
    /Profile can be opened only by its owner/
  );

  await repository.appendUserAction({
    userId: 'user_a',
    actorUserId: 'user_b',
    domain: 'cards',
    entityType: 'card',
    entityId: 'card_1',
    actionType: 'card-delete',
    message: 'Deleted card'
  });
  const insert = calls.find((call) => /INSERT INTO user_actions/i.test(call.sql));
  assert.equal(insert.values[1], 'user_a');
  assert.equal(insert.values[2], 'user_b');
  assert.equal(insert.values[3], 'cards');
});

test('WebPush and FCM methods keep ownership on current SQL user and hash token identifiers', async () => {
  const { repository, calls } = createRepository(async (sql) => {
    if (/FROM web_push_subscriptions/i.test(sql)) {
      return [[{
        id: 'wps_1',
        encrypted_payload_json: JSON.stringify({
          endpoint: 'https://push.example.test/a',
          keys: { p256dh: 'p256dh', auth: 'auth' }
        }),
        last_seen_at: '2026-04-30 10:00:00.000'
      }], []];
    }
    if (/FROM fcm_tokens/i.test(sql)) {
      return [[{
        id: 'fcm_1',
        token_ciphertext: 'token-1',
        device_id: 'device-1',
        last_seen_at: '2026-04-30 10:00:00.000'
      }], []];
    }
    return [[], []];
  }, { idFactory: (prefix) => `${prefix}_new` });

  const endpoint = 'https://push.example.test/a';
  const token = 'fcm-token';
  const webpush = await repository.upsertWebPushSubscription('user_a', {
    endpoint,
    keys: { p256dh: 'p256dh', auth: 'auth' }
  }, 'unit-test-agent');
  await repository.unsubscribeWebPush('user_a', endpoint);
  assert.equal((await repository.listActiveWebPushSubscriptionsByUser('user_a'))[0].endpoint, endpoint);

  const fcm = await repository.upsertFcmToken('user_a', { token, device: 'desktop' });
  await repository.revokeFcmToken('user_a', token);
  assert.equal((await repository.listActiveFcmTokensByUser('user_a'))[0].token, 'token-1');

  assert.equal(webpush.userId, 'user_a');
  assert.equal(fcm.userId, 'user_a');
  assert.equal(webpush.endpointHash, sha256Buffer(endpoint).toString('hex'));
  assert.equal(fcm.tokenHash, sha256Buffer(token).toString('hex'));
  assert.equal(calls.some((call) => /endpoint_hash/i.test(call.sql)), true);
  assert.equal(calls.some((call) => /token_hash/i.test(call.sql)), true);
  assert.equal(calls.some((call) => /revoked_at/i.test(call.sql)), true);
});

test('Stage 10 source scan keeps repository foundation separate from runtime chat cutover', () => {
  const repositorySource = readRepoFile('server/repositories/messagingProfileRepository.js');
  const serverSource = readRepoFile('server.js');
  const importerSource = readRepoFile('scripts/mysql/import-json-dry-run.js');

  assert.match(repositorySource, /SecurityRepository|securityRepository|readSecuritySnapshot/);
  assert.equal(/database\.getData|database\.update|database\.json|\/api\/data/i.test(repositorySource), false);
  assert.equal(/console\.(log|info|warn|error)[\s\S]{0,80}(token|endpoint|auth|p256dh)/i.test(repositorySource), false);
  assert.match(serverSource, /pathname === '\/api\/chat\/users'/);
  assert.match(serverSource, /pathname === '\/api\/chat\/direct'/);
  assert.equal(serverSource.includes('/api/messages'), false);
  assert.equal(/new MessagingProfileRepository|getMessagingProfileRepository/.test(serverSource), false);
  assert.match(importerSource, /chat_message_states/);
  assert.match(importerSource, /web_push_subscriptions/);
  assert.match(importerSource, /fcm_tokens/);
  assert.match(importerSource, /legacy_messages/);
});
