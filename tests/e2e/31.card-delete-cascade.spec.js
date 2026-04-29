const { test, expect, request: playwrightRequest } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { resetDatabaseFromSnapshot } = require('./helpers/snapshot');
const { restartServer, stopServer } = require('./helpers/server');
const { dataDbPath, runtimeStorageDir } = require('./helpers/paths');

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

function writeJsonDb(mutator) {
  const db = JSON.parse(fs.readFileSync(dataDbPath, 'utf8'));
  mutator(db);
  fs.writeFileSync(dataDbPath, JSON.stringify(db, null, 2));
}

function readJsonDb() {
  return JSON.parse(fs.readFileSync(dataDbPath, 'utf8'));
}

function seedCascadeFixture() {
  const target = {
    id: 'card_stage0_delete_cascade',
    name: 'МК-STAGE0-DEL',
    routeCardNumber: 'МК-STAGE0-DEL',
    qrId: 'STAGE0DEL1',
    barcode: 'STAGE0DEL1',
    cardType: 'MKI',
    archived: false,
    approvalStage: 'DRAFT',
    status: 'NOT_STARTED',
    productionStatus: 'NOT_STARTED',
    rev: 5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attachments: [{
      id: 'att_stage0_delete_cascade',
      name: 'passport.pdf',
      originalName: 'passport.pdf',
      relPath: 'GENERAL/passport.pdf',
      category: 'GENERAL'
    }],
    inputControlFileId: 'att_stage0_delete_cascade',
    operations: [{
      id: 'rop_stage0_delete_cascade',
      opId: 'op_stage0_delete_cascade',
      opName: 'Удаляемая операция',
      status: 'NOT_STARTED'
    }],
    logs: []
  };
  const keep = {
    id: 'card_stage0_keep_cascade',
    name: 'МК-STAGE0-KEEP',
    routeCardNumber: 'МК-STAGE0-KEEP',
    qrId: 'KEEP0DEL1',
    barcode: 'KEEP0DEL1',
    cardType: 'MKI',
    archived: false,
    approvalStage: 'DRAFT',
    status: 'NOT_STARTED',
    productionStatus: 'NOT_STARTED',
    rev: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attachments: [],
    operations: [{
      id: 'rop_stage0_keep_cascade',
      opId: 'op_stage0_keep_cascade',
      opName: 'Сохраненная операция',
      status: 'NOT_STARTED'
    }],
    logs: []
  };
  const deleteTask = {
    id: 'pst_stage0_delete_cascade',
    cardId: target.id,
    routeOpId: target.operations[0].id,
    opId: target.operations[0].opId,
    opName: target.operations[0].opName,
    date: '2026-04-20',
    shift: 1,
    areaId: 'area_stage0_delete'
  };
  const keepTask = {
    id: 'pst_stage0_keep_cascade',
    cardId: keep.id,
    routeOpId: keep.operations[0].id,
    opId: keep.operations[0].opId,
    opName: keep.operations[0].opName,
    date: '2026-04-20',
    shift: 1,
    areaId: 'area_stage0_keep'
  };
  const deleteRow = {
    key: '2026-04-20|1|area_stage0_delete|card_stage0_delete_cascade|rop_stage0_delete_cascade|',
    taskId: deleteTask.id,
    cardId: target.id,
    routeOpId: target.operations[0].id,
    routeCardNumber: target.routeCardNumber,
    qrId: target.qrId
  };
  const keepRow = {
    key: '2026-04-20|1|area_stage0_keep|card_stage0_keep_cascade|rop_stage0_keep_cascade|',
    taskId: keepTask.id,
    cardId: keep.id,
    routeOpId: keep.operations[0].id,
    routeCardNumber: keep.routeCardNumber,
    qrId: keep.qrId
  };
  const conversationId = 'cvt_stage0_delete_cascade';

  writeJsonDb(db => {
    db.cards = (db.cards || []).concat([target, keep]);
    db.productionShiftTasks = (db.productionShiftTasks || []).concat([deleteTask, keepTask]);
    db.productionShifts = (db.productionShifts || []).concat([{
      id: 'SHIFT_STAGE0_DELETE_1',
      date: '2026-04-20',
      shift: 1,
      timeFrom: '08:00',
      timeTo: '16:00',
      status: 'OPEN',
      openedAt: Date.now(),
      openedBy: 'Abyss',
      closedAt: null,
      closedBy: '',
      isFixed: false,
      initialSnapshot: {
        createdAt: Date.now(),
        createdBy: 'Abyss',
        employees: [],
        tasks: [deleteTask, keepTask]
      },
      logs: [
        { id: 'shiftlog_stage0_delete', action: 'MOVE_TASK_TO_SHIFT', targetId: target.operations[0].id, newValue: `МК ${target.routeCardNumber}` },
        { id: 'shiftlog_stage0_keep', action: 'MOVE_TASK_TO_SHIFT', targetId: keep.operations[0].id, newValue: `МК ${keep.routeCardNumber}` }
      ],
      closePageDraft: {
        rows: {
          [deleteRow.key]: deleteRow,
          [keepRow.key]: keepRow
        }
      },
      closePageSnapshot: {
        savedAt: Date.now(),
        operationFacts: {
          [`${target.id}|${target.operations[0].id}|2026-04-20|1`]: { total: 1 },
          [`${keep.id}|${keep.operations[0].id}|2026-04-20|1`]: { total: 1 }
        },
        rows: [deleteRow, keepRow]
      },
      closePageSnapshotHistory: [{
        savedAt: Date.now(),
        operationFacts: {
          [`${target.id}|${target.operations[0].id}|2026-04-20|1`]: { total: 1 },
          [`${keep.id}|${keep.operations[0].id}|2026-04-20|1`]: { total: 1 }
        },
        rows: [deleteRow, keepRow]
      }]
    }]);
    db.userActions = (db.userActions || []).concat([
      { id: 'act_stage0_delete_machine', userId: 'id272497', cardId: target.id, text: 'Удаляемая карточка' },
      { id: 'act_stage0_delete_text', userId: 'id272497', text: `Открыта маршрутная карта ${target.routeCardNumber}` },
      { id: 'act_stage0_keep', userId: 'id272497', text: `Открыта маршрутная карта ${keep.routeCardNumber}` }
    ]);
    db.chatConversations = (db.chatConversations || []).concat([{
      id: conversationId,
      type: 'direct',
      participantIds: ['id272497', 'system'],
      createdAt: new Date().toISOString(),
      lastMessageId: 'cmsg_stage0_delete_attachment',
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: `Файл ${target.attachments[0].id} добавлен`
    }]);
    db.chatMessages = (db.chatMessages || []).concat([
      { id: 'cmsg_stage0_keep', conversationId, seq: 1, senderId: 'system', text: `Сообщение по маршрутной карте ${keep.routeCardNumber}`, createdAt: new Date().toISOString() },
      { id: 'cmsg_stage0_delete_attachment', conversationId, seq: 2, senderId: 'system', text: `Файл ${target.attachments[0].id} добавлен`, createdAt: new Date().toISOString() }
    ]);
  });

  const cardsDir = path.join(runtimeStorageDir, 'cards');
  fs.mkdirSync(path.join(cardsDir, target.qrId, 'GENERAL'), { recursive: true });
  fs.writeFileSync(path.join(cardsDir, target.qrId, 'GENERAL', 'passport.pdf'), 'delete');
  fs.mkdirSync(path.join(cardsDir, keep.qrId, 'GENERAL'), { recursive: true });
  fs.writeFileSync(path.join(cardsDir, keep.qrId, 'GENERAL', 'keep.pdf'), 'keep');

  return { target, keep, conversationId };
}

test.describe('card delete cascade', () => {
  test.beforeEach(async () => {
    resetDatabaseFromSnapshot('baseline-with-production-fixtures');
  });

  test.afterEach(async () => {
    await stopServer();
  });

  test('stale delete keeps data and successful delete removes persistent card references only', async ({}, testInfo) => {
    const fixture = seedCascadeFixture();
    await restartServer();
    const baseURL = testInfo.project.use.baseURL;
    const { api, csrfToken } = await loginApi(baseURL);

    try {
      const staleResponse = await api.delete(`/api/cards-core/${encodeURIComponent(fixture.target.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: { expectedRev: fixture.target.rev - 1 }
      });
      expect(staleResponse.status()).toBe(409);
      const staleBody = await staleResponse.json();
      let db = readJsonDb();
      expect((db.cards || []).some(card => card?.id === fixture.target.id)).toBeTruthy();
      expect((db.productionShiftTasks || []).some(task => task?.cardId === fixture.target.id)).toBeTruthy();
      expect(fs.existsSync(path.join(runtimeStorageDir, 'cards', fixture.target.qrId))).toBeTruthy();

      const deleteResponse = await api.delete(`/api/cards-core/${encodeURIComponent(fixture.target.id)}`, {
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/json'
        },
        data: { expectedRev: staleBody.actualRev }
      });
      expect(deleteResponse.ok()).toBeTruthy();
      const deleteBody = await deleteResponse.json();
      expect(deleteBody.deletedId).toBe(fixture.target.id);
      expect(deleteBody.cascadeSummary.productionShiftTasksRemoved).toBe(1);
      expect(deleteBody.cascadeSummary.storageFoldersRemoved).toBe(1);
      expect(deleteBody.cascadeSummary.productionShiftCloseDraftRowsRemoved).toBe(1);
      expect(deleteBody.cascadeSummary.productionShiftCloseSnapshotRowsRemoved).toBe(1);
      expect(deleteBody.cascadeSummary.productionShiftCloseSnapshotHistoryRowsRemoved).toBe(1);
      expect(deleteBody.cascadeSummary.userActionsRemoved).toBe(2);
      expect(deleteBody.cascadeSummary.chatMessagesRemoved).toBe(1);

      db = readJsonDb();
      expect((db.cards || []).some(card => card?.id === fixture.target.id)).toBeFalsy();
      expect((db.cards || []).some(card => card?.id === fixture.keep.id)).toBeTruthy();
      expect((db.productionShiftTasks || []).some(task => task?.cardId === fixture.target.id)).toBeFalsy();
      expect((db.productionShiftTasks || []).some(task => task?.cardId === fixture.keep.id)).toBeTruthy();

      const shift = (db.productionShifts || []).find(item => item?.id === 'SHIFT_STAGE0_DELETE_1');
      expect(Object.values(shift.closePageDraft.rows || {}).some(row => row?.cardId === fixture.target.id)).toBeFalsy();
      expect(Object.values(shift.closePageDraft.rows || {}).some(row => row?.cardId === fixture.keep.id)).toBeTruthy();
      expect((shift.closePageSnapshot.rows || []).some(row => row?.cardId === fixture.target.id)).toBeFalsy();
      expect((shift.closePageSnapshot.rows || []).some(row => row?.cardId === fixture.keep.id)).toBeTruthy();
      expect((shift.closePageSnapshotHistory[0].rows || []).some(row => row?.cardId === fixture.target.id)).toBeFalsy();
      expect((shift.initialSnapshot.tasks || []).some(task => task?.cardId === fixture.target.id)).toBeFalsy();
      expect((shift.initialSnapshot.tasks || []).some(task => task?.cardId === fixture.keep.id)).toBeTruthy();
      expect((shift.logs || []).some(log => log?.targetId === fixture.target.operations[0].id)).toBeFalsy();
      expect((shift.logs || []).some(log => log?.targetId === fixture.keep.operations[0].id)).toBeTruthy();

      expect((db.userActions || []).some(entry => entry?.id === 'act_stage0_delete_machine')).toBeFalsy();
      expect((db.userActions || []).some(entry => entry?.id === 'act_stage0_delete_text')).toBeFalsy();
      expect((db.userActions || []).some(entry => entry?.id === 'act_stage0_keep')).toBeTruthy();
      expect((db.chatMessages || []).some(message => message?.id === 'cmsg_stage0_delete_attachment')).toBeFalsy();
      expect((db.chatMessages || []).some(message => message?.id === 'cmsg_stage0_keep')).toBeTruthy();
      const conversation = (db.chatConversations || []).find(item => item?.id === fixture.conversationId);
      expect(conversation.lastMessageId).toBe('cmsg_stage0_keep');

      expect(fs.existsSync(path.join(runtimeStorageDir, 'cards', fixture.target.qrId))).toBeFalsy();
      expect(fs.existsSync(path.join(runtimeStorageDir, 'cards', fixture.keep.qrId, 'GENERAL', 'keep.pdf'))).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });
});
