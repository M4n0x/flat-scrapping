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

test('popupHtml renders a hero image carousel without thumbnails', () => {
  const html = popupHtml({
    title: 'Appartement',
    imageUrls: [
      '/data/profiles/vevey/images/cover.jpg',
      'https://example.test/two.jpg'
    ]
  });

  assert.match(html, /class="map-popup-carousel"/);
  assert.match(html, /class="map-popup-carousel-image map-popup-hero-image"/);
  assert.match(html, /class="map-popup-close"/);
  assert.match(html, /class="map-popup-body"/);
  assert.match(html, /data-popup-close/);
  assert.match(html, /src="\/data\/profiles\/vevey\/images\/cover\.jpg"/);
  assert.match(html, /data-carousel-url="https:\/\/example\.test\/two\.jpg"/);
  assert.match(html, /data-carousel-prev/);
  assert.match(html, /data-carousel-next/);
  assert.match(html, /1 \/ 2/);
  assert.doesNotMatch(html, /data-carousel-thumb/);
  assert.doesNotMatch(html, /map-popup-carousel-thumbs/);
});

test('popupHtml omits unsafe image urls from the carousel', () => {
  const html = popupHtml({
    imageUrls: [
      'javascript:alert(1)',
      'ftp://example.test/image.jpg',
      '/dashboard/home.css',
      'https://example.test/safe.jpg'
    ]
  });

  assert.match(html, /https:\/\/example\.test\/safe\.jpg/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /ftp:\/\//);
  assert.doesNotMatch(html, /\/dashboard\/home\.css/);
});

test('escapeHtml handles quotes', () => {
  assert.equal(escapeHtml(`"A&B"`), '&quot;A&amp;B&quot;');
});
