const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');

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

test.describe('cards core api', () => {
  test.beforeEach(() => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
  });

  test('returns domain-only list/detail payloads and enforces revision-safe update', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const listResponse = await api.get('/api/cards-core?archived=active');
      expect(listResponse.ok()).toBeTruthy();
      const listBody = await listResponse.json();
      expect(Array.isArray(listBody.cards)).toBeTruthy();
      expect(typeof listBody.total).toBe('number');
      expect(listBody.users).toBeUndefined();
      expect(listBody.ops).toBeUndefined();
      expect(listBody.data).toBeUndefined();

      const createResponse = await api.post('/api/cards-core', {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          name: 'Stage 3 API draft',
          desc: 'server-side cards core create',
          cardType: 'MKI',
          quantity: 3,
          material: 'Сталь 40Х'
        }
      });
      expect(createResponse.status()).toBe(201);
      const createBody = await createResponse.json();
      expect(createBody.cards).toBeUndefined();
      expect(createBody.card).toBeTruthy();
      expect(createBody.card.id).toBeTruthy();
      expect(createBody.card.approvalStage).toBe('DRAFT');
      expect(createBody.card.archived).toBeFalsy();
      expect(createBody.card.rev).toBe(1);

      const createdCard = createBody.card;
      const detailResponse = await api.get(`/api/cards-core/${encodeURIComponent(createdCard.id)}`);
      expect(detailResponse.ok()).toBeTruthy();
      const detailBody = await detailResponse.json();
      expect(detailBody.card).toBeTruthy();
      expect(detailBody.card.id).toBe(createdCard.id);
      expect(detailBody.users).toBeUndefined();
      expect(detailBody.ops).toBeUndefined();
      expect(detailBody.data).toBeUndefined();

      const updateResponse = await api.put(`/api/cards-core/${encodeURIComponent(createdCard.id)}`, {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          id: createdCard.id,
          expectedRev: createdCard.rev,
          name: 'Stage 3 API draft updated',
          desc: 'revision-safe update'
        }
      });
      expect(updateResponse.ok()).toBeTruthy();
      const updateBody = await updateResponse.json();
      expect(updateBody.card.id).toBe(createdCard.id);
      expect(updateBody.card.name).toBe('Stage 3 API draft updated');
      expect(updateBody.card.rev).toBeGreaterThan(createdCard.rev);

      const staleResponse = await api.put(`/api/cards-core/${encodeURIComponent(createdCard.id)}`, {
        headers: {
          'x-csrf-token': csrfToken
        },
        data: {
          id: createdCard.id,
          expectedRev: createdCard.rev,
          desc: 'stale write should fail'
        }
      });
      expect(staleResponse.status()).toBe(409);
      const staleBody = await staleResponse.json();
      expect(staleBody.code).toBe('STALE_REVISION');
      expect(staleBody.entity).toBe('card');
      expect(staleBody.id).toBe(createdCard.id);
      expect(staleBody.expectedRev).toBe(createdCard.rev);
      expect(staleBody.actualRev).toBe(updateBody.card.rev);

      const filteredListResponse = await api.get('/api/cards-core?archived=active&q=stage%203%20api%20draft%20updated');
      expect(filteredListResponse.ok()).toBeTruthy();
      const filteredListBody = await filteredListResponse.json();
      expect(filteredListBody.cards.some(card => card.id === createdCard.id)).toBeTruthy();

      const latestDetailResponse = await api.get(`/api/cards-core/${encodeURIComponent(createdCard.id)}`);
      expect(latestDetailResponse.ok()).toBeTruthy();
      const latestDetailBody = await latestDetailResponse.json();
      expect(latestDetailBody.card.rev).toBe(updateBody.card.rev);
      expect(latestDetailBody.card.name).toBe('Stage 3 API draft updated');
    } finally {
      await api.dispose();
    }
  });
});
