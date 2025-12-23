const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hashed = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  return { hash: hashed.toString('hex'), salt: salt.toString('hex') };
}

function verifyPassword(password, user) {
  if (!user) return false;
  if (user.passwordHash && user.passwordSalt) {
    const hashed = crypto.pbkdf2Sync(password, Buffer.from(user.passwordSalt, 'hex'), 310000, 32, 'sha256');
    return crypto.timingSafeEqual(hashed, Buffer.from(user.passwordHash, 'hex'));
  }
  if (typeof user.password === 'string') {
    return user.password === password;
  }
  return false;
}

function createAuthStore(database) {
  return {
    async getUserByPassword(password) {
      const data = await database.getData();
      return (data.users || []).find(u => verifyPassword(password, u)) || null;
    },
    async getUserById(id) {
      const data = await database.getData();
      return (data.users || []).find(u => u.id === id) || null;
    },
    async getAccessLevels() {
      const data = await database.getData();
      return data.accessLevels || [];
    }
  };
}

function createSessionStore({ ttlMs }) {
  const sessions = new Map();
  const ttl = Math.max(1, Number(ttlMs) || 0);

  const isExpired = (session) => session.expiresAt <= Date.now();

  return {
    createSession(userId) {
      const token = crypto.randomBytes(32).toString('hex');
      const csrfToken = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      const session = { token, userId, createdAt: now, lastActivity: now, expiresAt: now + ttl, csrfToken };
      sessions.set(token, session);
      return { ...session };
    },
    getSession(token) {
      if (!token || !sessions.has(token)) return null;
      const session = sessions.get(token);
      if (isExpired(session)) {
        sessions.delete(token);
        return null;
      }
      return session;
    },
    touchSession(token) {
      const session = sessions.get(token);
      if (!session) return null;
      if (isExpired(session)) {
        sessions.delete(token);
        return null;
      }
      const now = Date.now();
      session.lastActivity = now;
      session.expiresAt = now + ttl;
      sessions.set(token, session);
      return { ...session };
    },
    deleteSession(token) {
      sessions.delete(token);
    }
  };
}

module.exports = {
  createAuthStore,
  createSessionStore,
  hashPassword,
  verifyPassword
};
