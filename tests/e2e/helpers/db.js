const fs = require('fs');
const { resolveSnapshot } = require('./snapshot');

function loadSnapshotDb(snapshotName = 'baseline-with-production-fixtures') {
  return JSON.parse(fs.readFileSync(resolveSnapshot(snapshotName), 'utf8'));
}

function getCards(db) {
  return Array.isArray(db.cards) ? db.cards : [];
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

module.exports = {
  loadSnapshotDb,
  getProductionFixture
};
