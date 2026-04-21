const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');

async function loginApi(baseURL, password = 'ssyba') {
  const api = await playwrightRequest.newContext({ baseURL });
  const loginResponse = await api.post('/api/login', {
    data: { password }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginBody = await loginResponse.json();
  expect(loginBody.csrfToken).toBeTruthy();
  return {
    api,
    csrfToken: loginBody.csrfToken,
    user: loginBody.user
  };
}

async function createProductionApprovalUser(baseURL, adminApi, adminCsrfToken, suffix) {
  const levelName = `Stage4 Approval Production ${suffix}`;
  const levelResponse = await adminApi.post('/api/security/access-levels', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name: levelName,
      description: 'Stage 4 approval command test level',
      permissions: {
        tabs: {
          approvals: { view: true, edit: true }
        },
        headProduction: true,
        headSKK: false,
        deputyTechDirector: false
      }
    }
  });
  expect(levelResponse.ok()).toBeTruthy();
  const levelBody = await levelResponse.json();
  const createdLevel = (levelBody.accessLevels || []).find(level => level && level.name === levelName);
  expect(createdLevel).toBeTruthy();

  const userName = `Stage4ProdApprover_${suffix}`;
  const userPassword = `Stage4A${suffix}9`;
  const createUserResponse = await adminApi.post('/api/security/users', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name: userName,
      password: userPassword,
      accessLevelId: createdLevel.id,
      status: 'active'
    }
  });
  expect(createUserResponse.ok()).toBeTruthy();

  const approverSession = await loginApi(baseURL, userPassword);
  return {
    levelId: createdLevel.id,
    userName,
    userPassword,
    api: approverSession.api,
    csrfToken: approverSession.csrfToken,
    user: approverSession.user
  };
}

async function createDraftCard(adminApi, adminCsrfToken, name) {
  const response = await adminApi.post('/api/cards-core', {
    headers: {
      'x-csrf-token': adminCsrfToken
    },
    data: {
      name,
      desc: `approval command api test ${name}`,
      cardType: 'MKI',
      quantity: 2,
      material: 'Сталь 40Х'
    }
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.card).toBeTruthy();
  expect(body.cards).toBeUndefined();
  return body.card;
}

test.describe('approval lifecycle server commands', () => {
  test.beforeAll(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
    await restartServer();
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('supports revision-safe send, role-based approve/reject, return to draft and Abyss override', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);
    const suffix = String(Date.now()).slice(-6);
    const approver = await createProductionApprovalUser(baseURL, adminApi, adminCsrfToken, suffix);

    try {
      const firstDraft = await createDraftCard(adminApi, adminCsrfToken, `Stage4 lifecycle ${suffix}`);

      const sendResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(firstDraft.id)}/approval/send`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: firstDraft.rev,
          comment: 'Отправка на согласование из API'
        }
      });
      expect(sendResponse.ok()).toBeTruthy();
      const sendBody = await sendResponse.json();
      expect(sendBody.command).toBe('send');
      expect(sendBody.cards).toBeUndefined();
      expect(sendBody.card.id).toBe(firstDraft.id);
      expect(sendBody.card.approvalStage).toBe('ON_APPROVAL');
      expect(sendBody.card.approvalProductionStatus).toBeNull();
      expect(sendBody.card.approvalSKKStatus).toBeNull();
      expect(sendBody.card.approvalTechStatus).toBeNull();
      expect(sendBody.card.rejectionReason).toBe('');
      expect(sendBody.card.rev).toBeGreaterThan(firstDraft.rev);
      expect(sendBody.card.approvalThread.at(-1)).toMatchObject({
        actionType: 'SEND_TO_APPROVAL',
        comment: 'Отправка на согласование из API'
      });

      const approveResponse = await approver.api.post(`/api/cards-core/${encodeURIComponent(firstDraft.id)}/approval/approve`, {
        headers: {
          'x-csrf-token': approver.csrfToken
        },
        data: {
          expectedRev: sendBody.card.rev,
          comment: 'Согласовано только производством'
        }
      });
      expect(approveResponse.ok()).toBeTruthy();
      const approveBody = await approveResponse.json();
      expect(approveBody.command).toBe('approve');
      expect(approveBody.card.id).toBe(firstDraft.id);
      expect(approveBody.card.approvalProductionStatus).toBe('Согласовано');
      expect(approveBody.card.approvalSKKStatus).toBeNull();
      expect(approveBody.card.approvalTechStatus).toBeNull();
      expect(approveBody.card.approvalStage).toBe('ON_APPROVAL');
      expect(approveBody.card.responsibleProductionChief).toBe(approver.userName);
      expect(approveBody.card.approvalThread.at(-1)).toMatchObject({
        actionType: 'APPROVE',
        roleContext: 'PRODUCTION',
        comment: 'Согласовано только производством',
        userName: approver.userName
      });
      expect(
        (approveBody.card.logs || []).some(log => log && log.field === 'approvalProductionStatus' && log.newValue === 'Согласовано')
      ).toBeTruthy();

      const secondDraft = await createDraftCard(adminApi, adminCsrfToken, `Stage4 reject ${suffix}`);
      const secondSendResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(secondDraft.id)}/approval/send`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: secondDraft.rev,
          comment: 'Отправка перед отклонением'
        }
      });
      expect(secondSendResponse.ok()).toBeTruthy();
      const secondSendBody = await secondSendResponse.json();

      const rejectResponse = await approver.api.post(`/api/cards-core/${encodeURIComponent(secondDraft.id)}/approval/reject`, {
        headers: {
          'x-csrf-token': approver.csrfToken
        },
        data: {
          expectedRev: secondSendBody.card.rev,
          reason: 'Причина отклонения Stage 4'
        }
      });
      expect(rejectResponse.ok()).toBeTruthy();
      const rejectBody = await rejectResponse.json();
      expect(rejectBody.command).toBe('reject');
      expect(rejectBody.card.id).toBe(secondDraft.id);
      expect(rejectBody.card.approvalStage).toBe('REJECTED');
      expect(rejectBody.card.approvalProductionStatus).toBe('Не согласовано');
      expect(rejectBody.card.approvalSKKStatus).toBeNull();
      expect(rejectBody.card.approvalTechStatus).toBeNull();
      expect(rejectBody.card.rejectionReason).toBe('Причина отклонения Stage 4');
      expect(rejectBody.card.rejectionReadByUserName).toBe('');
      expect(rejectBody.card.approvalThread.at(-1)).toMatchObject({
        actionType: 'REJECT',
        roleContext: 'PRODUCTION',
        comment: 'Причина отклонения Stage 4',
        userName: approver.userName
      });
      expect(
        (rejectBody.card.logs || []).some(log => log && log.field === 'approvalStage' && log.newValue === 'REJECTED')
      ).toBeTruthy();

      const returnResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(secondDraft.id)}/approval/return-to-draft`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: rejectBody.card.rev,
          comment: 'Возвращено в черновик для доработки'
        }
      });
      expect(returnResponse.ok()).toBeTruthy();
      const returnBody = await returnResponse.json();
      expect(returnBody.command).toBe('return-to-draft');
      expect(returnBody.card.id).toBe(secondDraft.id);
      expect(returnBody.card.approvalStage).toBe('DRAFT');
      expect(returnBody.card.rejectionReason).toBe('Причина отклонения Stage 4');
      expect(returnBody.card.rejectionReadByUserName).toBe('Abyss');
      expect(returnBody.card.rejectionReadAt).toEqual(expect.any(Number));
      expect(returnBody.card.approvalThread.at(-1)).toMatchObject({
        actionType: 'UNFREEZE',
        comment: 'Возвращено в черновик для доработки',
        userName: 'Abyss'
      });

      const resendResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(secondDraft.id)}/approval/send`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: returnBody.card.rev,
          comment: 'Повторная отправка'
        }
      });
      expect(resendResponse.ok()).toBeTruthy();
      const resendBody = await resendResponse.json();
      expect(resendBody.card.approvalStage).toBe('ON_APPROVAL');
      expect(resendBody.card.rejectionReason).toBe('');
      expect(resendBody.card.approvalProductionStatus).toBeNull();
      expect(resendBody.card.approvalSKKStatus).toBeNull();
      expect(resendBody.card.approvalTechStatus).toBeNull();

      const abyssApproveResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(secondDraft.id)}/approval/approve`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: resendBody.card.rev,
          comment: 'Abyss override approval'
        }
      });
      expect(abyssApproveResponse.ok()).toBeTruthy();
      const abyssApproveBody = await abyssApproveResponse.json();
      expect(abyssApproveBody.card.approvalProductionStatus).toBe('Согласовано');
      expect(abyssApproveBody.card.approvalSKKStatus).toBe('Согласовано');
      expect(abyssApproveBody.card.approvalTechStatus).toBe('Согласовано');
      expect(abyssApproveBody.card.approvalStage).toBe('APPROVED');
      expect(abyssApproveBody.card.responsibleProductionChief).toBe('Abyss');
      expect(abyssApproveBody.card.responsibleSKKChief).toBe('Abyss');
      expect(abyssApproveBody.card.responsibleTechLead).toBe('Abyss');
    } finally {
      await approver.api.dispose();
      await adminApi.dispose();
    }
  });

  test('returns 409 conflict payload for stale expectedRev on approval command', async ({}, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const { api: adminApi, csrfToken: adminCsrfToken } = await loginApi(baseURL);

    try {
      const draftCard = await createDraftCard(adminApi, adminCsrfToken, `Stage4 stale ${Date.now()}`);
      const sendResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/send`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: draftCard.rev,
          comment: 'Подготовка stale expectedRev'
        }
      });
      expect(sendResponse.ok()).toBeTruthy();
      const sendBody = await sendResponse.json();

      const staleApproveResponse = await adminApi.post(`/api/cards-core/${encodeURIComponent(draftCard.id)}/approval/approve`, {
        headers: {
          'x-csrf-token': adminCsrfToken
        },
        data: {
          expectedRev: draftCard.rev,
          comment: 'Stale approval should fail'
        }
      });
      expect(staleApproveResponse.status()).toBe(409);
      const staleBody = await staleApproveResponse.json();
      expect(staleBody.code).toBe('STALE_REVISION');
      expect(staleBody.entity).toBe('card');
      expect(staleBody.id).toBe(draftCard.id);
      expect(staleBody.expectedRev).toBe(draftCard.rev);
      expect(staleBody.actualRev).toBe(sendBody.card.rev);
    } finally {
      await adminApi.dispose();
    }
  });
});
