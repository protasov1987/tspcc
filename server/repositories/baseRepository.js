const { executeQuery } = require('../persistence/mysql/query');
const { withTransaction } = require('../persistence/mysql/transaction');

class BaseRepository {
  constructor(options = {}) {
    if (!options.pool) {
      throw new Error('BaseRepository requires a SQL pool boundary.');
    }
    this.pool = options.pool;
    this.domain = options.domain || 'foundation';
    this.auditOutboxRepository = options.auditOutboxRepository || null;
    this.afterCommit = typeof options.afterCommit === 'function' ? options.afterCommit : null;
  }

  async query(options) {
    return executeQuery(this.pool, {
      ...options,
      domain: options?.domain || this.domain
    });
  }

  async inTransaction(work, options = {}) {
    const txOptions = {
      ...options,
      pool: this.pool,
      label: options.label || this.domain
    };
    if (!txOptions.afterCommit && this.afterCommit) {
      txOptions.afterCommit = this.afterCommit;
    }
    return withTransaction(
      async (connection, context) => work(new TransactionRepository(connection, this.domain, context), context),
      txOptions
    );
  }

  async appendDomainEvent(tx, input = {}) {
    if (!this.auditOutboxRepository || typeof this.auditOutboxRepository.appendAuditAndOutbox !== 'function') {
      return null;
    }
    return this.auditOutboxRepository.appendAuditAndOutbox(tx, input);
  }
}

class TransactionRepository {
  constructor(connection, domain, context = null) {
    this.connection = connection;
    this.domain = domain || 'foundation';
    this.context = context;
  }

  async query(options) {
    return executeQuery(this.connection, {
      ...options,
      domain: options?.domain || this.domain
    });
  }

  addPostCommitEvent(event) {
    if (!this.context || typeof this.context.addPostCommitEvent !== 'function') {
      throw new Error('Post-commit events require an active SQL transaction context.');
    }
    this.context.addPostCommitEvent(event);
  }

  getPostCommitEvents() {
    if (!this.context || typeof this.context.getPostCommitEvents !== 'function') {
      return [];
    }
    return this.context.getPostCommitEvents();
  }
}

module.exports = {
  BaseRepository,
  TransactionRepository
};
