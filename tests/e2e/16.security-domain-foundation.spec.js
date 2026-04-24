const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');

async function loginApi(baseURL) {
  const api = await playwrightRequest.newContext({ baseURL });
  const loginResponse = await api.post('/api/login', {
    data: { password: 'ssyba' }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginBody = await loginResponse.json();
  expect(loginBody.csrfToken).toBeTruthy();
  return {
    api,
    csrfToken: loginBody.csrfToken
  };
}

function buildLevelPermissions({
  landingTab = 'production',
  inactivityTimeoutMinutes = 17
} = {}) {
  return {
    tabs: {
      users: { view: false, edit: false },
      accessLevels: { view: false, edit: true }
    },
    attachments: {
      upload: true,
      remove: false
    },
    landingTab,
    inactivityTimeoutMinutes,
    worker: false,
    headProduction: false,
    headSKK: false,
    skkWorker: false,
    labWorker: false,
    warehouseWorker: false,
    deputyTechDirector: false
  };
}

test.describe('security domain foundation api', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('returns unified security payloads and enforces revision-safe access-level updates', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);

    try {
      const listResponse = await api.get('/api/security/access-levels');
      expect(listResponse.ok()).toBeTruthy();
      const listBody = await listResponse.json();
      expect(listBody.slice).toBe('access-levels');
      expect(Array.isArray(listBody.accessLevels)).toBeTruthy();
      expect(Array.isArray(listBody.users)).toBeTruthy();
      expect(listBody.accessLevels.every(level => Number.isFinite(Number(level?.rev)))).toBeTruthy();

      const createResponse = await api.post('/api/security/access-levels', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 security level ${suffix}`,
          description: 'security foundation level',
          permissions: buildLevelPermissions()
        }
      });
      expect(createResponse.ok()).toBeTruthy();
      const createBody = await createResponse.json();
      expect(createBody.slice).toBe('access-levels');
      expect(Array.isArray(createBody.accessLevels)).toBeTruthy();
      const createdLevel = (createBody.accessLevels || []).find(level => level && level.name === `Stage7 security level ${suffix}`);
      expect(createdLevel).toBeTruthy();
      expect(createdLevel.rev).toBe(1);

      const updateResponse = await api.post('/api/security/access-levels', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          id: createdLevel.id,
          expectedRev: createdLevel.rev,
          name: `${createdLevel.name} updated`,
          description: 'normalized permissions',
          permissions: buildLevelPermissions({
            landingTab: 'production',
            inactivityTimeoutMinutes: 23
          })
        }
      });
      expect(updateResponse.ok()).toBeTruthy();
      const updateBody = await updateResponse.json();
      expect(updateBody.command).toBe('security.access-level.update');
      expect(updateBody.accessLevel).toBeTruthy();
      expect(updateBody.accessLevel.id).toBe(createdLevel.id);
      expect(updateBody.accessLevel.rev).toBeGreaterThan(createdLevel.rev);
      expect(updateBody.accessLevel.permissions.tabs.accessLevels.edit).toBe(true);
      expect(updateBody.accessLevel.permissions.tabs.accessLevels.view).toBe(true);
      expect(updateBody.accessLevel.permissions.landingTab).toBe('production-schedule');
      expect(updateBody.accessLevel.permissions.inactivityTimeoutMinutes).toBe(23);

      const staleResponse = await api.post('/api/security/access-levels', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          id: createdLevel.id,
          expectedRev: createdLevel.rev,
          name: `${createdLevel.name} stale`,
          permissions: buildLevelPermissions({
            landingTab: 'users'
          })
        }
      });
      expect(staleResponse.status()).toBe(409);
      const staleBody = await staleResponse.json();
      expect(staleBody.code).toBe('STALE_REVISION');
      expect(staleBody.entity).toBe('security.access-level');
      expect(staleBody.id).toBe(createdLevel.id);
      expect(staleBody.expectedRev).toBe(createdLevel.rev);
      expect(staleBody.actualRev).toBe(updateBody.accessLevel.rev);
      expect(Array.isArray(staleBody.accessLevels)).toBe(true);
      expect(Array.isArray(staleBody.users)).toBe(true);
      expect(staleBody.accessLevel.id).toBe(createdLevel.id);
    } finally {
      await api.dispose();
    }
  });

  test('enforces user revision contract and protects Abyss invariants on the server', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);

    try {
      const createLevelResponse = await api.post('/api/security/access-levels', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 user level ${suffix}`,
          description: 'user contract level',
          permissions: buildLevelPermissions({
            landingTab: 'dashboard',
            inactivityTimeoutMinutes: 31
          })
        }
      });
      expect(createLevelResponse.ok()).toBeTruthy();
      const createLevelBody = await createLevelResponse.json();
      const createdLevel = (createLevelBody.accessLevels || []).find(level => level && level.name === `Stage7 user level ${suffix}`);
      expect(createdLevel).toBeTruthy();

      const listUsersResponse = await api.get('/api/security/users');
      expect(listUsersResponse.ok()).toBeTruthy();
      const listUsersBody = await listUsersResponse.json();
      expect(listUsersBody.slice).toBe('users');
      expect(Array.isArray(listUsersBody.users)).toBeTruthy();
      expect(Array.isArray(listUsersBody.accessLevels)).toBeTruthy();
      const abyssUser = (listUsersBody.users || []).find(user => String(user?.name || '').trim() === 'Abyss');
      expect(abyssUser).toBeTruthy();
      expect(Number.isFinite(Number(abyssUser.rev))).toBe(true);

      const createUserResponse = await api.post('/api/security/users', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 User ${suffix}`,
          password: `User${suffix}99`,
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(createUserResponse.ok()).toBeTruthy();
      const createUserBody = await createUserResponse.json();
      expect(createUserBody.command).toBe('security.user.create');
      expect(createUserBody.user).toBeTruthy();
      expect(createUserBody.user.rev).toBe(1);
      const createdUserId = createUserBody.user.id;

      const duplicatePasswordResponse = await api.post('/api/security/users', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 Duplicate Password ${suffix}`,
          password: `User${suffix}99`,
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(duplicatePasswordResponse.status()).toBe(400);
      const duplicatePasswordBody = await duplicatePasswordResponse.json();
      expect(String(duplicatePasswordBody.error || '')).toMatch(/пароль уже используется/i);

      const invalidPasswordResponse = await api.post('/api/security/users', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 Invalid Password ${suffix}`,
          password: '12345',
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(invalidPasswordResponse.status()).toBe(400);
      const invalidPasswordBody = await invalidPasswordResponse.json();
      expect(String(invalidPasswordBody.error || '')).toMatch(/не короче 6 символов/i);

      const abyssCreateResponse = await api.post('/api/security/users', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: 'Abyss',
          password: `Abyss${suffix}99`,
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(abyssCreateResponse.status()).toBe(409);
      const abyssCreateBody = await abyssCreateResponse.json();
      expect(abyssCreateBody.code).toBe('INVALID_STATE');
      expect(String(abyssCreateBody.message || abyssCreateBody.error || '')).toMatch(/зарезервировано/i);

      const updateUserResponse = await api.put(`/api/security/users/${encodeURIComponent(createdUserId)}`, {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          expectedRev: createUserBody.user.rev,
          name: `Stage7 User ${suffix} updated`,
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(updateUserResponse.ok()).toBeTruthy();
      const updateUserBody = await updateUserResponse.json();
      expect(updateUserBody.command).toBe('security.user.update');
      expect(updateUserBody.user.id).toBe(createdUserId);
      expect(updateUserBody.user.rev).toBeGreaterThan(createUserBody.user.rev);

      const renameToAbyssResponse = await api.put(`/api/security/users/${encodeURIComponent(createdUserId)}`, {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          expectedRev: updateUserBody.user.rev,
          name: 'Abyss',
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(renameToAbyssResponse.status()).toBe(409);
      const renameToAbyssBody = await renameToAbyssResponse.json();
      expect(renameToAbyssBody.code).toBe('INVALID_STATE');
      expect(String(renameToAbyssBody.message || renameToAbyssBody.error || '')).toMatch(/зарезервировано/i);

      const staleDeleteResponse = await api.delete(`/api/security/users/${encodeURIComponent(createdUserId)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          expectedRev: createUserBody.user.rev
        }
      });
      expect(staleDeleteResponse.status()).toBe(409);
      const staleDeleteBody = await staleDeleteResponse.json();
      expect(staleDeleteBody.code).toBe('STALE_REVISION');
      expect(staleDeleteBody.entity).toBe('security.user');
      expect(staleDeleteBody.id).toBe(createdUserId);
      expect(staleDeleteBody.expectedRev).toBe(createUserBody.user.rev);
      expect(staleDeleteBody.actualRev).toBe(updateUserBody.user.rev);
      expect(Array.isArray(staleDeleteBody.users)).toBe(true);
      expect(Array.isArray(staleDeleteBody.accessLevels)).toBe(true);

      const abyssUpdateResponse = await api.put(`/api/security/users/${encodeURIComponent(abyssUser.id)}`, {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          expectedRev: abyssUser.rev,
          name: 'Abyss',
          accessLevelId: createdLevel.id,
          status: 'inactive'
        }
      });
      expect(abyssUpdateResponse.status()).toBe(409);
      const abyssUpdateBody = await abyssUpdateResponse.json();
      expect(abyssUpdateBody.code).toBe('INVALID_STATE');
      expect(abyssUpdateBody.entity).toBe('security.user');
      expect(abyssUpdateBody.id).toBe(abyssUser.id);
      expect(String(abyssUpdateBody.message || abyssUpdateBody.error || '')).toMatch(/системного администратора/i);
      expect(abyssUpdateBody.user.id).toBe(abyssUser.id);

      const abyssRenameResponse = await api.put(`/api/security/users/${encodeURIComponent(abyssUser.id)}`, {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          expectedRev: abyssUser.rev,
          name: 'Abyss Renamed',
          accessLevelId: 'level_admin',
          status: 'active'
        }
      });
      expect(abyssRenameResponse.status()).toBe(409);
      const abyssRenameBody = await abyssRenameResponse.json();
      expect(abyssRenameBody.code).toBe('INVALID_STATE');
      expect(String(abyssRenameBody.message || abyssRenameBody.error || '')).toMatch(/переименовать системного администратора/i);

      const abyssDeleteResponse = await api.delete(`/api/security/users/${encodeURIComponent(abyssUser.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          expectedRev: abyssUser.rev
        }
      });
      expect(abyssDeleteResponse.status()).toBe(409);
      const abyssDeleteBody = await abyssDeleteResponse.json();
      expect(abyssDeleteBody.code).toBe('INVALID_STATE');
      expect(abyssDeleteBody.entity).toBe('security.user');
      expect(abyssDeleteBody.id).toBe(abyssUser.id);

      const deleteUserResponse = await api.delete(`/api/security/users/${encodeURIComponent(createdUserId)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          expectedRev: updateUserBody.user.rev
        }
      });
      expect(deleteUserResponse.ok()).toBeTruthy();
      const deleteUserBody = await deleteUserResponse.json();
      expect(deleteUserBody.command).toBe('security.user.delete');
      expect(deleteUserBody.deletedId).toBe(createdUserId);
      expect((deleteUserBody.users || []).some(user => user && user.id === createdUserId)).toBe(false);
    } finally {
      await api.dispose();
    }
  });

  test('deletes access levels only when no users are attached', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);

    try {
      const createLevelResponse = await api.post('/api/security/access-levels', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 delete level ${suffix}`,
          description: 'delete guard level',
          permissions: buildLevelPermissions({
            landingTab: 'dashboard',
            inactivityTimeoutMinutes: 19
          })
        }
      });
      expect(createLevelResponse.ok()).toBeTruthy();
      const createLevelBody = await createLevelResponse.json();
      const createdLevel = (createLevelBody.accessLevels || []).find(level => level && level.name === `Stage7 delete level ${suffix}`);
      expect(createdLevel).toBeTruthy();

      const createUserResponse = await api.post('/api/security/users', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: `Stage7 delete user ${suffix}`,
          password: `Delete${suffix}99`,
          accessLevelId: createdLevel.id,
          status: 'active'
        }
      });
      expect(createUserResponse.ok()).toBeTruthy();
      const createUserBody = await createUserResponse.json();
      expect(createUserBody.user?.id).toBeTruthy();

      const blockedDeleteResponse = await api.delete(`/api/security/access-levels/${encodeURIComponent(createdLevel.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          expectedRev: createdLevel.rev
        }
      });
      expect(blockedDeleteResponse.status()).toBe(409);
      const blockedDeleteBody = await blockedDeleteResponse.json();
      expect(blockedDeleteBody.code).toBe('ACCESS_LEVEL_IN_USE');
      expect(blockedDeleteBody.entity).toBe('security.access-level');
      expect(blockedDeleteBody.id).toBe(createdLevel.id);
      expect(blockedDeleteBody.attachedUsersCount).toBeGreaterThan(0);

      const deleteUserResponse = await api.delete(`/api/security/users/${encodeURIComponent(createUserBody.user.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          expectedRev: createUserBody.user.rev
        }
      });
      expect(deleteUserResponse.ok()).toBeTruthy();

      const refreshedLevelsResponse = await api.get('/api/security/access-levels');
      expect(refreshedLevelsResponse.ok()).toBeTruthy();
      const refreshedLevelsBody = await refreshedLevelsResponse.json();
      const refreshedLevel = (refreshedLevelsBody.accessLevels || []).find(level => level && level.id === createdLevel.id);
      expect(refreshedLevel).toBeTruthy();

      const deleteLevelResponse = await api.delete(`/api/security/access-levels/${encodeURIComponent(createdLevel.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: {
          expectedRev: refreshedLevel.rev
        }
      });
      expect(deleteLevelResponse.ok()).toBeTruthy();
      const deleteLevelBody = await deleteLevelResponse.json();
      expect(deleteLevelBody.command).toBe('security.access-level.delete');
      expect(deleteLevelBody.deletedId).toBe(createdLevel.id);
      expect((deleteLevelBody.accessLevels || []).some(level => level && level.id === createdLevel.id)).toBe(false);
    } finally {
      await api.dispose();
    }
  });
});
