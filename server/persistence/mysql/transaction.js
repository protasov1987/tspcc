const { getMysqlPool } = require('./pool');

const TRANSIENT_ERROR_CODES = new Set([
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'PROTOCOL_SEQUENCE_TIMEOUT'
]);
const TRANSIENT_ERRNO = new Set([1205, 1213]);

function logDb(message, details) {
  if (details) {
    console.info(`[DB] ${message}`, details);
    return;
  }
  console.info(`[DB] ${message}`);
}

function classifyDbError(error) {
  const code = error?.code || '';
  const errno = Number(error?.errno);
  if (code === 'ER_LOCK_DEADLOCK' || errno === 1213) {
    return { type: 'deadlock', retryable: true };
  }
  if (code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1205) {
    return { type: 'lock-timeout', retryable: true };
  }
  if (TRANSIENT_ERROR_CODES.has(code) || TRANSIENT_ERRNO.has(errno)) {
    return { type: 'transient', retryable: true };
  }
  return { type: 'other', retryable: false };
}

async function beginTransaction(connection) {
  await connection.beginTransaction();
  logDb('transaction begin');
}

async function commitTransaction(connection) {
  await connection.commit();
  logDb('transaction commit');
}

async function rollbackTransaction(connection, error) {
  await connection.rollback();
  const classification = classifyDbError(error);
  logDb('transaction rollback', {
    classification: classification.type,
    retryable: classification.retryable
  });
}

function createTransactionContext(attempt) {
  const postCommitEvents = [];
  return {
    attempt,
    addPostCommitEvent(event) {
      if (!event || typeof event !== 'object') {
        throw new Error('Post-commit event descriptor must be an object.');
      }
      postCommitEvents.push(Object.freeze({ ...event }));
    },
    getPostCommitEvents() {
      return postCommitEvents.slice();
    }
  };
}

function createTransactionClient(connection, context) {
  return Object.freeze({
    async execute(sql, values) {
      return connection.execute(sql, values);
    },
    addPostCommitEvent(event) {
      context.addPostCommitEvent(event);
    },
    getPostCommitEvents() {
      return context.getPostCommitEvents();
    }
  });
}

async function withTransaction(work, options = {}) {
  if (typeof work !== 'function') {
    throw new Error('Transaction work must be a function.');
  }
  const retries = Number.isSafeInteger(options.retries) && options.retries > 0 ? options.retries : 0;
  const idempotent = options.idempotent === true;
  const label = options.label || 'transaction';
  let attempt = 0;

  while (true) {
    attempt += 1;
    const pool = options.connection ? null : (options.pool || getMysqlPool(options));
    const connection = options.connection || await pool.getConnection();
    const shouldRelease = !options.connection && typeof connection.release === 'function';
    let result;
    let postCommitEvents = [];
    let committed = false;
    try {
      await beginTransaction(connection);
      const context = createTransactionContext(attempt);
      result = await work(createTransactionClient(connection, context), context);
      await commitTransaction(connection);
      committed = true;
      postCommitEvents = context.getPostCommitEvents();
    } catch (error) {
      if (!committed) {
        try {
          await rollbackTransaction(connection, error);
        } catch (rollbackError) {
          logDb('transaction rollback failed', {
            label,
            code: rollbackError?.code || rollbackError?.errno || 'UNKNOWN'
          });
        }
      }
      const classification = classifyDbError(error);
      if (!committed && idempotent && classification.retryable && attempt <= retries) {
        logDb('transaction retry', {
          label,
          attempt,
          classification: classification.type
        });
        continue;
      }
      logDb(committed ? 'transaction post-commit failed' : 'transaction failed', {
        label,
        attempt,
        classification: classification.type
      });
      throw error;
    } finally {
      if (shouldRelease) {
        connection.release();
      }
    }

    if (typeof options.afterCommit === 'function') {
      try {
        await options.afterCommit(postCommitEvents, result, { attempt, label });
      } catch (error) {
        logDb('transaction afterCommit failed', {
          label,
          attempt,
          code: error?.code || error?.errno || 'UNKNOWN'
        });
      }
    }
    if (options.returnPostCommitEvents === true) {
      return { result, postCommitEvents };
    }
    return result;
  }
}

module.exports = {
  classifyDbError,
  withTransaction
};
