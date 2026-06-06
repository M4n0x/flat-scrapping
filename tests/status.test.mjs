import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATUS_KEYS,
  STATUS_LABELS,
  isValidStatus,
  migrateStatus,
  DEFAULT_STATUS
} from '../scripts/status.mjs';

test('STATUS_KEYS is the closed set sorting/pursuing/archived', () => {
  assert.deepEqual(STATUS_KEYS, ['sorting', 'pursuing', 'archived']);
});

test('DEFAULT_STATUS is sorting (newly-found listings start here)', () => {
  assert.equal(DEFAULT_STATUS, 'sorting');
});

test('STATUS_LABELS provides French UI labels for each key', () => {
  assert.equal(STATUS_LABELS.sorting, 'À trier');
  assert.equal(STATUS_LABELS.pursuing, 'À poursuivre');
  assert.equal(STATUS_LABELS.archived, 'Archivé');
});

test('isValidStatus accepts only the three keys', () => {
  assert.equal(isValidStatus('sorting'), true);
  assert.equal(isValidStatus('pursuing'), true);
  assert.equal(isValidStatus('archived'), true);
  assert.equal(isValidStatus('À contacter'), false);
  assert.equal(isValidStatus(''), false);
  assert.equal(isValidStatus(null), false);
  assert.equal(isValidStatus(undefined), false);
});

test('migrateStatus maps every legacy French status', () => {
  assert.equal(migrateStatus('À contacter'), 'sorting');
  assert.equal(migrateStatus('Visite'), 'pursuing');
  assert.equal(migrateStatus('Dossier'), 'pursuing');
  assert.equal(migrateStatus('Relance'), 'pursuing');
  assert.equal(migrateStatus('Accepté'), 'pursuing');
  assert.equal(migrateStatus('Refusé'), 'archived');
  assert.equal(migrateStatus('Sans réponse'), 'archived');
});

test('migrateStatus tolerates whitespace and case differences', () => {
  assert.equal(migrateStatus(' À contacter '), 'sorting');
  assert.equal(migrateStatus('REFUSÉ'), 'archived');
});

test('migrateStatus passes through already-new keys unchanged', () => {
  assert.equal(migrateStatus('sorting'), 'sorting');
  assert.equal(migrateStatus('pursuing'), 'pursuing');
  assert.equal(migrateStatus('archived'), 'archived');
});

test('migrateStatus returns null for unknown values so callers can decide', () => {
  assert.equal(migrateStatus(''), null);
  assert.equal(migrateStatus(null), null);
  assert.equal(migrateStatus('Random'), null);
});

test('migrateStatus maps granular legacy variants to the right bucket', () => {
  // Visite-bucket variants
  assert.equal(migrateStatus('Visite demandée'), 'pursuing');
  assert.equal(migrateStatus('Visite planifiée'), 'pursuing');
  assert.equal(migrateStatus('Visité'), 'pursuing');
  // Dossier-bucket variants
  assert.equal(migrateStatus('Dossier prêt à envoyer'), 'pursuing');
  assert.equal(migrateStatus('Dossier envoyé'), 'pursuing');
  // Relance-bucket variants
  assert.equal(migrateStatus('Relance J+2'), 'pursuing');
});
