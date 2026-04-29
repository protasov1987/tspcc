class SqlConflictError extends Error {
  constructor(details) {
    const message = details?.message || 'Данные были изменены другим пользователем. Обновите данные и повторите действие.';
    super(message);
    this.name = 'SqlConflictError';
    this.statusCode = 409;
    this.code = details?.code || 'REVISION_CONFLICT';
    this.entity = details?.entity || 'entity';
    this.id = details?.id == null ? null : String(details.id);
    this.expectedRev = details?.expectedRev ?? null;
    this.actualRev = details?.actualRev ?? null;
    this.error = details?.error || message;
  }

  toPayload() {
    return {
      code: this.code,
      entity: this.entity,
      id: this.id,
      expectedRev: this.expectedRev,
      actualRev: this.actualRev,
      message: this.message,
      error: this.error
    };
  }
}

function createSqlConflict(details) {
  return new SqlConflictError(details);
}

function isSqlConflict(error) {
  return error instanceof SqlConflictError || Number(error?.statusCode) === 409;
}

function toHttpConflictPayload(error) {
  if (error instanceof SqlConflictError) {
    return error.toPayload();
  }
  return {
    code: error?.code || 'REVISION_CONFLICT',
    entity: error?.entity || 'entity',
    id: error?.id == null ? null : String(error.id),
    expectedRev: error?.expectedRev ?? null,
    actualRev: error?.actualRev ?? null,
    message: error?.message || 'Данные были изменены другим пользователем. Обновите данные и повторите действие.',
    error: error?.error || error?.message || 'Conflict'
  };
}

module.exports = {
  SqlConflictError,
  createSqlConflict,
  isSqlConflict,
  toHttpConflictPayload
};
