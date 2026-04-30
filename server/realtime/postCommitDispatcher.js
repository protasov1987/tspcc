function trimToString(value) {
  return value == null ? '' : String(value).trim();
}

function defaultLogger(level, message, details) {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  if (details) {
    console[method](message, details);
    return;
  }
  console[method](message);
}

function resolveTransportEventName(descriptor) {
  return trimToString(
    descriptor?.transportEventName
    || descriptor?.eventName
    || descriptor?.sseEventName
    || descriptor?.eventType
  );
}

async function dispatchCommittedOutboxEvents(events = [], options = {}) {
  const dispatch = options.dispatch;
  if (typeof dispatch !== 'function') {
    throw new Error('Post-commit dispatcher requires dispatch(eventName, payload).');
  }
  const repository = options.repository || null;
  const logger = typeof options.logger === 'function' ? options.logger : defaultLogger;
  const result = { dispatched: 0, failed: 0, skipped: 0 };

  for (const descriptor of Array.isArray(events) ? events : []) {
    const outboxId = trimToString(descriptor?.id);
    const eventName = resolveTransportEventName(descriptor);
    if (!outboxId || !eventName) {
      result.skipped += 1;
      logger('warn', '[LIVE] post-commit dispatch skipped', {
        outboxId: outboxId || null,
        eventName: eventName || null
      });
      continue;
    }

    try {
      dispatch(eventName, descriptor.payload || descriptor);
      if (repository && typeof repository.markOutboxProcessed === 'function') {
        await repository.markOutboxProcessed(outboxId);
      }
      result.dispatched += 1;
      logger('info', '[LIVE] post-commit event dispatched', {
        outboxId,
        eventName,
        domain: descriptor.domain || descriptor.payload?.domain || null,
        entity: descriptor.entity || descriptor.payload?.entity || null
      });
    } catch (error) {
      result.failed += 1;
      if (repository && typeof repository.markOutboxDispatchFailed === 'function') {
        try {
          await repository.markOutboxDispatchFailed(outboxId, error);
        } catch (markError) {
          logger('warn', '[DB] outbox dispatch failure mark failed', {
            outboxId,
            code: markError?.code || markError?.errno || 'UNKNOWN'
          });
        }
      }
      logger('warn', '[LIVE] post-commit dispatch failed', {
        outboxId,
        eventName,
        code: error?.code || error?.errno || 'UNKNOWN'
      });
    }
  }

  return result;
}

function createPostCommitDispatchHook(options = {}) {
  return async function afterCommit(events) {
    return dispatchCommittedOutboxEvents(events, options);
  };
}

module.exports = {
  createPostCommitDispatchHook,
  dispatchCommittedOutboxEvents,
  resolveTransportEventName
};
