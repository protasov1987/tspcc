const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

test('Stage 11 Batch 3 wires representative SQL domain families to audit/outbox helper', () => {
  const files = {
    server: readRepoFile('server.js'),
    base: readRepoFile('server/repositories/baseRepository.js'),
    cards: readRepoFile('server/repositories/cardsRepository.js'),
    directories: readRepoFile('server/repositories/directoriesRepository.js'),
    security: readRepoFile('server/repositories/securityRepository.js'),
    planningExecution: [
      readRepoFile('server/repositories/productionExecutionRepository.js'),
      readRepoFile('server.js')
    ].join('\n'),
    messaging: readRepoFile('server/repositories/messagingProfileRepository.js')
  };

  assertContains(files.base, /appendDomainEvent\(tx, input/, 'BaseRepository exposes domain event append boundary.');
  assertContains(files.server, /createPostCommitDispatchHook/, 'Server repositories use the shared post-commit dispatcher.');
  assertContains(files.server, /new AuditOutboxRepository/, 'Server owns a shared AuditOutboxRepository instance.');

  assertContains(files.cards, /eventType:\s*'card\.created'/, 'Cards create emits an outbox event.');
  assertContains(files.cards, /eventType:\s*'card\.updated'/, 'Cards update emits an outbox event.');
  assertContains(files.cards, /eventType:\s*'card\.deleted'/, 'Cards delete emits an outbox event.');
  assertContains(files.cards, /eventType:\s*'card\.files-updated'/, 'Card file metadata emits an outbox event.');

  assertContains(files.directories, /appendDirectoryEvent/, 'Directories use a shared domain event helper.');
  assertContains(files.directories, /directory\.department/, 'Department commands are wired.');
  assertContains(files.directories, /directory\.operation/, 'Operation commands are wired.');
  assertContains(files.directories, /directory\.area/, 'Area commands are wired.');
  assertContains(files.directories, /directory\.employee/, 'Employee assignment commands are wired.');
  assertContains(files.directories, /directory\.shift-time/, 'Shift time commands are wired.');

  assertContains(files.security, /security\.user/, 'User commands are wired.');
  assertContains(files.security, /security\.access-level/, 'Access level commands are wired.');

  assertContains(files.planningExecution, /production-planning/, 'Production planning commands are wired.');
  assertContains(files.planningExecution, /production-execution/, 'Production execution commands are wired.');
  assertContains(files.planningExecution, /transportEventName:\s*'card\.updated'/, 'Production execution maps to existing card live refresh transport.');

  assertContains(files.messaging, /chat\.message\.created/, 'Chat messages are wired.');
  assertContains(files.messaging, /chat\.message\.delivered/, 'Delivered state is wired.');
  assertContains(files.messaging, /chat\.message\.read/, 'Read state is wired.');
  assertContains(files.messaging, /profile\.user-action\.created/, 'User actions are wired.');
  assertContains(files.messaging, /profile\.user-visit\.created/, 'User visits are wired.');
  assertContains(files.messaging, /notification\.webpush/, 'WebPush ownership events are wired.');
  assertContains(files.messaging, /notification\.fcm/, 'FCM ownership events are wired.');
});

test('Stage 11 Batch 3 live compatibility uses targeted refresh transports, not bootstrap correctness', () => {
  const server = readRepoFile('server.js');
  const appState = readRepoFile('js/app.00.state.js');
  const messenger = readRepoFile('js/app.95.messenger.js');

  assertContains(server, /transportEventName:\s*eventOptions\.transportEventName\s*\|\|\s*'cards:changed'/, 'Planning uses existing cards:changed refresh transport.');
  assertContains(server, /msgSseSendToUser\(userId,\s*normalizedEventName,\s*livePayload\)/, 'Chat dispatch targets recipient users.');
  assertContains(appState, /Structured card events are notification hints only/, 'Client keeps card live events as refresh hints.');
  assertContains(appState, /source of truth for card state/, 'Client source scan documents refresh-based correctness.');
  assertContains(messenger, /scheduleChatLiveRefresh/, 'Chat live events trigger refresh, not trusted patching.');
});
