const { executeQuery } = require('../persistence/mysql/query');
const { withTransaction } = require('../persistence/mysql/transaction');

class BaseRepository {
  constructor(options = {}) {
    if (!options.pool) {
      throw new Error('BaseRepository requires a SQL pool boundary.');
    }
    this.pool = options.pool;
    this.domain = options.domain || 'foundation';
  }

  async query(options) {
    return executeQuery(this.pool, {
      ...options,
      domain: options?.domain || this.domain
    });
  }

  async inTransaction(work, options = {}) {
    return withTransaction(
      async (connection, context) => work(new TransactionRepository(connection, this.domain), context),
      {
        ...options,
        pool: this.pool,
        label: options.label || this.domain
      }
    );
  }
}

class TransactionRepository {
  constructor(connection, domain) {
    this.connection = connection;
    this.domain = domain || 'foundation';
  }

  async query(options) {
    return executeQuery(this.connection, {
      ...options,
      domain: options?.domain || this.domain
    });
  }
}

module.exports = {
  BaseRepository,
  TransactionRepository
};
