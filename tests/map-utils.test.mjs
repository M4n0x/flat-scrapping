import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  formatMarkerDetails,
  moneyLabel,
  popupHtml,
  profileColor,
  roomsLabel,
  surfaceLabel
} from '../dashboard/map-utils.js';

test('profileColor is stable and hex formatted', () => {
  assert.equal(profileColor('fribourg'), profileColor('fribourg'));
  assert.match(profileColor('fribourg'), /^#[0-9a-f]{6}$/i);
});

test('labels format missing values compactly', () => {
  assert.equal(moneyLabel(null), 'CHF -');
  assert.equal(roomsLabel(null), '- p');
  assert.equal(surfaceLabel(null), '- m2');
});

test('formatMarkerDetails combines price rooms and surface', () => {
  assert.equal(
    formatMarkerDetails({ totalChf: 1450, rooms: 2.5, surfaceM2: 62 }),
    "CHF 1'450 · 2.5 p · 62 m2"
  );
});

test('popupHtml escapes listing content and keeps safe link attributes', () => {
  const html = popupHtml({
    profileTitle: '<Profile>',
    title: '<Flat>',
    address: 'Rue & Lac',
    area: 'Vevey',
    totalChf: 1450,
    rooms: 2.5,
    surfaceM2: 62,
    source: 'immobilier.ch',
    url: 'https://example.test/listing'
  });

  assert.match(html, /&lt;Profile&gt;/);
  assert.match(html, /&lt;Flat&gt;/);
  assert.match(html, /Rue &amp; Lac/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('popupHtml omits unsafe javascript links', () => {
  const html = popupHtml({ url: 'javascript:alert(1)' });

  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /javascript:/);
});

test('popupHtml keeps valid https links with safe attributes', () => {
  const html = popupHtml({ url: 'https://example.test/listing' });

  assert.match(html, /href="https:\/\/example\.test\/listing"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('escapeHtml handles quotes', () => {
  assert.equal(escapeHtml(`"A&B"`), '&quot;A&amp;B&quot;');
});
