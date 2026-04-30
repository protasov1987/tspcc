const test = require('node:test');
const assert = require('node:assert/strict');

const { withTransaction } = require('../../server/persistence/mysql/transaction');
const { AuditOutboxRepository, createEventEnvelope } = require('../../server/repositories/auditOutboxRepository');
const { dispatchCommittedOutboxEvents } = require('../../server/realtime/postCommitDispatcher');

function createConnectionRecorder(calls) {
  return {
    async execute(sql, values) {
      calls.push(['execute', sql, values]);
      return [{ affectedRows: 1 }, []];
    },
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); }
  };
}

function createPool(connection) {
  return {
    async getConnection() {
      return connection;
    }
  };
}

test('event envelope keeps the Stage 11 contract shape', () => {
  const envelope = createEventEnvelope({
    domain: 'cards',
    entity: 'card',
    id: 'card-1',
    rev: 7,
    eventType: 'card.updated',
    timestamp: '2026-05-01T10:00:00.000Z',
    scope: 'cards-basic',
    route: '/cards/card-1',
    hints: { ids: ['card-1'] }
  });

  assert.deepEqual(envelope, {
    domain: 'cards',
    entity: 'card',
    id: 'card-1',
    eventType: 'card.updated',
    timestamp: '2026-05-01T10:00:00.000Z',
    rev: 7,
    scope: 'cards-basic',
    route: '/cards/card-1',
    hints: { ids: ['card-1'] }
  });
});

test('audit/outbox helper writes both rows inside one SQL transaction and returns descriptors after commit', async () => {
  const calls = [];
  const connection = createConnectionRecorder(calls);
  const repository = new AuditOutboxRepository({
    pool: createPool(connection),
    idFactory(prefix) {
      return `${prefix}_unit`;
    }
  });

  const committed = await repository.inTransaction(async (tx) => {
    const result = await repository.appendAuditAndOutbox(tx, {
      domain: 'cards',
      entity: 'card',
      id: 'card-1',
      rev: 2,
      eventType: 'card.updated',
      transportEventName: 'card.updated',
      actorUserId: 'user-1',
      timestamp: '2026-05-01T10:00:00.000Z'
    });
    assert.equal(tx.getPostCommitEvents().length, 1);
    return result;
  }, { label: 'audit-outbox:unit', returnPostCommitEvents: true });

  assert.equal(committed.result.auditId, 'audit_unit');
  assert.equal(committed.result.outboxId, 'outbox_unit');
  assert.equal(committed.postCommitEvents.length, 1);
  assert.equal(committed.postCommitEvents[0].transportEventName, 'card.updated');

  const auditInsert = calls.find((entry) => Array.isArray(entry) && /\bINSERT INTO audit_events\b/.test(entry[1]));
  const outboxInsert = calls.find((entry) => Array.isArray(entry) && /\bINSERT INTO outbox_events\b/.test(entry[1]));
  assert.ok(auditInsert, 'audit_events INSERT is required');
  assert.ok(outboxInsert, 'outbox_events INSERT is required');
  assert.deepEqual(
    calls.filter((entry) => entry === 'begin' || entry === 'commit' || entry === 'rollback'),
    ['begin', 'commit']
  );
});

test('rolled back transaction does not run post-commit dispatch hook', async () => {
  const calls = [];
  const dispatched = [];
  const connection = createConnectionRecorder(calls);
  const repository = new AuditOutboxRepository({
    pool: createPool(connection),
    idFactory(prefix) {
      return `${prefix}_rollback`;
    }
  });

  await assert.rejects(
    () => repository.inTransaction(async (tx) => {
      await repository.appendAuditAndOutbox(tx, {
        domain: 'cards',
        entity: 'card',
        id: 'card-rollback',
        eventType: 'card.updated'
      });
      throw new Error('rollback requested');
    }, {
      label: 'audit-outbox:rollback',
      afterCommit(events) {
        dispatched.push(...events);
      }
    }),
    /rollback requested/
  );

  assert.deepEqual(dispatched, []);
  assert.deepEqual(
    calls.filter((entry) => entry === 'begin' || entry === 'commit' || entry === 'rollback'),
    ['begin', 'rollback']
  );
});

test('post-commit dispatcher emits only after commit and updates outbox state without write rollback', async () => {
  const calls = [];
  const dispatchCalls = [];
  const repositoryMarks = [];
  const connection = createConnectionRecorder(calls);

  const result = await withTransaction(async (tx) => {
    tx.addPostCommitEvent({
      id: 'outbox-1',
      domain: 'cards',
      entity: 'card',
      eventType: 'card.updated',
      transportEventName: 'card.updated',
      payload: {
        domain: 'cards',
        entity: 'card',
        id: 'card-1',
        rev: 2,
        eventType: 'card.updated',
        timestamp: '2026-05-01T10:00:00.000Z'
      }
    });
    return { ok: true };
  }, {
    connection,
    label: 'audit-outbox:dispatch-after-commit',
    afterCommit(events) {
      calls.push('afterCommit');
      return dispatchCommittedOutboxEvents(events, {
        dispatch(eventName, payload) {
          dispatchCalls.push({ eventName, payload });
        },
        repository: {
          async markOutboxProcessed(id) {
            repositoryMarks.push(['processed', id]);
          },
          async markOutboxDispatchFailed(id, error) {
            repositoryMarks.push(['failed', id, error.message]);
          }
        },
        logger() {}
      });
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.indexOf('commit') < calls.indexOf('afterCommit'), true);
  assert.deepEqual(dispatchCalls.map((item) => item.eventName), ['card.updated']);
  assert.deepEqual(repositoryMarks, [['processed', 'outbox-1']]);

  const failureMarks = [];
  const summary = await dispatchCommittedOutboxEvents([{
    id: 'outbox-2',
    eventType: 'card.updated',
    payload: { domain: 'cards', entity: 'card', id: 'card-2', eventType: 'card.updated', timestamp: '2026-05-01T10:00:00.000Z' }
  }], {
    dispatch() {
      throw new Error('SSE unavailable');
    },
    repository: {
      async markOutboxProcessed(id) {
        failureMarks.push(['processed', id]);
      },
      async markOutboxDispatchFailed(id, error) {
        failureMarks.push(['failed', id, error.message]);
      }
    },
    logger() {}
  });

  assert.deepEqual(summary, { dispatched: 0, failed: 1, skipped: 0 });
  assert.deepEqual(failureMarks, [['failed', 'outbox-2', 'SSE unavailable']]);
});
