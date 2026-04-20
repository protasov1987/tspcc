const fs = require('fs');
const { resolveSnapshot } = require('./snapshot');

function loadSnapshotDb(snapshotName = 'baseline-with-production-fixtures') {
  return JSON.parse(fs.readFileSync(resolveSnapshot(snapshotName), 'utf8'));
}

function getCards(db) {
  return Array.isArray(db.cards) ? db.cards : [];
}

function getUsers(db) {
  return Array.isArray(db.users) ? db.users : [];
}

function getUserByName(db, name) {
  const expectedName = String(name || '').trim();
  if (!expectedName) return null;
  return getUsers(db).find((user) => String(user?.name || '').trim() === expectedName) || null;
}

function getFirstOtherUser(db, excludedName) {
  const normalizedExcludedName = String(excludedName || '').trim();
  return getUsers(db).find((user) => (
    user
    && String(user?.id || '').trim()
    && String(user?.name || '').trim()
    && String(user?.name || '').trim() !== normalizedExcludedName
  )) || null;
}

function formatProductionShiftRouteKey(dateStr, shift) {
  const normalizedDate = String(dateStr || '').trim();
  const normalizedShift = Number(shift);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !Number.isInteger(normalizedShift) || normalizedShift <= 0) {
    return '';
  }
  const [yyyy, mm, dd] = normalizedDate.split('-');
  return `${dd}${mm}${yyyy}s${normalizedShift}`;
}

function getProductionFixture(db) {
  const cards = getCards(db);
  const workspaceCards = cards.filter((card) => (
    card
    && !card.archived
    && card.cardType === 'MKI'
    && Array.isArray(card.operations)
    && card.operations.length > 0
    && String(card.qrId || '').trim()
  ));
  const archivedCards = cards.filter((card) => card && card.archived && String(card.qrId || '').trim());
  const cardsWithOps = cards.filter((card) => card && Array.isArray(card.operations) && card.operations.length > 0);
  return {
    routeCard: cardsWithOps.find((card) => !card.archived && String(card.qrId || '').trim()) || null,
    workspaceCard: workspaceCards.find((card) => card.status === 'PAUSED' || card.status === 'IN_PROGRESS') || workspaceCards[0] || null,
    archivedCard: archivedCards[0] || null,
    cards,
    workspaceCards
  };
}

function getStage1RouteFixture(db) {
  const productionFixture = getProductionFixture(db);
  const productionShifts = Array.isArray(db.productionShifts) ? db.productionShifts : [];
  const shiftEntry = productionShifts.find((entry) => (
    entry
    && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || '').trim())
    && Number.isInteger(Number(entry.shift))
    && Number(entry.shift) > 0
  )) || null;

  return {
    abyssUser: getUserByName(db, 'Abyss'),
    foreignProfileUser: getFirstOtherUser(db, 'Abyss'),
    routeCard: productionFixture.routeCard || null,
    workspaceCard: productionFixture.workspaceCard || productionFixture.routeCard || null,
    archivedCard: productionFixture.archivedCard || null,
    shiftRouteKey: shiftEntry ? formatProductionShiftRouteKey(shiftEntry.date, shiftEntry.shift) : '',
    shiftRoutePath: shiftEntry ? `/production/shifts/${formatProductionShiftRouteKey(shiftEntry.date, shiftEntry.shift)}` : ''
  };
}

module.exports = {
  loadSnapshotDb,
  getProductionFixture,
  getStage1RouteFixture,
  getFirstOtherUser,
  getUserByName,
  formatProductionShiftRouteKey
};
