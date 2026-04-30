import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildListingAddressQuery,
  buildMapListingsPayload,
  profileColor,
  resolveListingCoordinates
} from '../scripts/map-listings.mjs';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

test('profileColor is stable and returns a hex color', () => {
  const first = profileColor('vevey');
  const second = profileColor('vevey');
  assert.equal(first, second);
  assert.match(first, /^#[0-9a-f]{6}$/i);
});

test('buildListingAddressQuery prefers listing address and appends Switzerland', () => {
  assert.equal(
    buildListingAddressQuery({ address: 'Rue du Lac 4, 1800 Vevey', area: 'Vevey' }),
    'Rue du Lac 4, 1800 Vevey, Suisse'
  );
  assert.equal(
    buildListingAddressQuery({ address: '', area: 'Fribourg' }),
    'Fribourg, Suisse'
  );
});

test('resolveListingCoordinates uses persisted map coordinates before cache', () => {
  const coords = resolveListingCoordinates(
    { mapLat: '46.46', mapLon: '6.84', address: 'Rue du Lac 4, 1800 Vevey' },
    { 'rue du lac 4, 1800 vevey, suisse': { lat: 1, lon: 2 } }
  );
  assert.deepEqual(coords, {
    lat: 46.46,
    lon: 6.84,
    address: 'Rue du Lac 4, 1800 Vevey'
  });
});

test('resolveListingCoordinates falls back to geocode cache address query', () => {
  const coords = resolveListingCoordinates(
    { address: 'Rue du Lac 4, 1800 Vevey', area: 'Vevey' },
    { 'rue du lac 4, 1800 vevey, suisse': { lat: 46.46, lon: 6.84 } }
  );
  assert.deepEqual(coords, {
    lat: 46.46,
    lon: 6.84,
    address: 'Rue du Lac 4, 1800 Vevey, Suisse'
  });
});

test('resolveListingCoordinates falls back when persisted map coordinates are blank or null', () => {
  const geocodeCache = {
    'rue du lac 4, 1800 vevey, suisse': { lat: 46.46, lon: 6.84 }
  };

  assert.deepEqual(
    resolveListingCoordinates(
      { mapLat: '', mapLon: null, address: 'Rue du Lac 4, 1800 Vevey' },
      geocodeCache
    ),
    {
      lat: 46.46,
      lon: 6.84,
      address: 'Rue du Lac 4, 1800 Vevey, Suisse'
    }
  );
  assert.deepEqual(
    resolveListingCoordinates(
      { mapLat: '   ', mapLon: ' ', address: 'Rue du Lac 4, 1800 Vevey' },
      geocodeCache
    ),
    {
      lat: 46.46,
      lon: 6.84,
      address: 'Rue du Lac 4, 1800 Vevey, Suisse'
    }
  );
});

test('resolveListingCoordinates returns null for blank persisted coordinates without a valid cache point', () => {
  assert.equal(
    resolveListingCoordinates(
      { mapLat: null, mapLon: '', address: 'Rue du Lac 4, 1800 Vevey' },
      {}
    ),
    null
  );
  assert.equal(
    resolveListingCoordinates(
      { mapLat: ' ', mapLon: '   ', address: 'Rue du Lac 4, 1800 Vevey' },
      { 'rue du lac 4, 1800 vevey, suisse': { lat: '', lon: null } }
    ),
    null
  );
});

test('resolveListingCoordinates ignores blank and null geocode cache coordinates', () => {
  assert.equal(
    resolveListingCoordinates(
      { address: 'Rue du Lac 4, 1800 Vevey' },
      { 'rue du lac 4, 1800 vevey, suisse': { lat: '', lon: ' ' } }
    ),
    null
  );
  assert.equal(
    resolveListingCoordinates(
      { address: 'Rue du Lac 4, 1800 Vevey' },
      { 'rue du lac 4, 1800 vevey, suisse': { lat: null, lon: 6.84 } }
    ),
    null
  );
});

test('resolveListingCoordinates ignores invalid coordinate types and ranges', () => {
  assert.equal(
    resolveListingCoordinates(
      { mapLat: 91, mapLon: 6.84, address: 'Rue du Lac 4, 1800 Vevey' },
      {}
    ),
    null
  );
  assert.equal(
    resolveListingCoordinates(
      { mapLat: 46.46, mapLon: 181, address: 'Rue du Lac 4, 1800 Vevey' },
      {}
    ),
    null
  );
  assert.equal(
    resolveListingCoordinates(
      { address: 'Rue du Lac 4, 1800 Vevey' },
      { 'rue du lac 4, 1800 vevey, suisse': { lat: true, lon: 6.84 } }
    ),
    null
  );
  assert.equal(
    resolveListingCoordinates(
      { address: 'Rue du Lac 4, 1800 Vevey' },
      { 'rue du lac 4, 1800 vevey, suisse': { lat: 46.46, lon: -181 } }
    ),
    null
  );
});

test('buildMapListingsPayload includes only active displayed non-refused listings with coordinates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apartment-map-'));
  const profilesDir = path.join(root, 'profiles');

  try {
    await writeJson(path.join(profilesDir, 'vevey', 'watch-config.json'), {
      shortTitle: 'Vevey',
      areas: [{ label: 'Vevey' }]
    });
    await writeJson(path.join(profilesDir, 'vevey', 'geocode-cache.json'), {
      'rue active 1, 1800 vevey, suisse': { lat: 46.46, lon: 6.84 }
    });
    await writeJson(path.join(profilesDir, 'vevey', 'tracker.json'), {
      listings: [
        {
          id: 'active',
          active: true,
          display: true,
          status: 'À contacter',
          title: 'Appartement actif',
          address: 'Rue Active 1, 1800 Vevey',
          area: 'Vevey',
          totalChf: 1450,
          rooms: 2.5,
          surfaceM2: 62,
          source: 'immobilier.ch',
          url: 'https://example.test/active'
        },
        {
          id: 'removed',
          active: false,
          display: true,
          isRemoved: true,
          address: 'Rue Removed 1, 1800 Vevey'
        },
        {
          id: 'refused',
          active: true,
          display: true,
          status: 'Refusé',
          mapLat: 46.47,
          mapLon: 6.85,
          address: 'Rue Refused 1, 1800 Vevey'
        },
        {
          id: 'missing-coords',
          active: true,
          display: true,
          status: 'À contacter',
          address: 'Rue Missing 1, 1800 Vevey'
        },
        {
          id: 'missing-active',
          display: true,
          status: 'À contacter',
          mapLat: 46.48,
          mapLon: 6.86,
          address: 'Rue Missing Active 1, 1800 Vevey'
        },
        {
          id: 'active-false-visible',
          active: false,
          display: true,
          status: 'À contacter',
          mapLat: 46.49,
          mapLon: 6.87,
          address: 'Rue Active False 1, 1800 Vevey'
        },
        {
          id: 'refused-whitespace',
          active: true,
          display: true,
          status: ' Refusé ',
          mapLat: 46.5,
          mapLon: 6.88,
          address: 'Rue Refused Whitespace 1, 1800 Vevey'
        }
      ]
    });

    const payload = await buildMapListingsPayload(profilesDir);

    assert.equal(payload.profiles.length, 1);
    assert.equal(payload.profiles[0].slug, 'vevey');
    assert.equal(payload.profiles[0].totalActiveDisplayed, 2);
    assert.equal(payload.profiles[0].mappedCount, 1);
    assert.equal(payload.profiles[0].missingCoordinates, 1);
    assert.equal(payload.listings.length, 1);
    assert.equal(payload.listings[0].id, 'active');
    assert.equal(payload.listings[0].profileSlug, 'vevey');
    assert.equal(payload.listings[0].lat, 46.46);
    assert.equal(payload.listings[0].lon, 6.84);
    assert.deepEqual(payload.totals, {
      profiles: 1,
      activeDisplayed: 2,
      mapped: 1,
      missingCoordinates: 1
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildMapListingsPayload includes sanitized listing image urls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apartment-map-images-'));
  const profilesDir = path.join(root, 'profiles');

  try {
    await writeJson(path.join(profilesDir, 'vevey', 'watch-config.json'), {
      shortTitle: 'Vevey'
    });
    await writeJson(path.join(profilesDir, 'vevey', 'tracker.json'), {
      listings: [
        {
          id: 'with-images',
          active: true,
          display: true,
          mapLat: 46.46,
          mapLon: 6.84,
          address: 'Rue Image 1, 1800 Vevey',
          imageUrlsLocal: [
            '/data/profiles/vevey/images/local-cover.jpg',
            'javascript:alert(1)'
          ],
          imageUrls: [
            'https://example.test/fallback.jpg'
          ],
          imageUrlsRemote: [
            'https://example.test/remote.jpg',
            'ftp://example.test/unsafe.jpg'
          ],
          imageUrl: 'https://example.test/single.jpg'
        }
      ]
    });

    const payload = await buildMapListingsPayload(profilesDir);

    assert.deepEqual(payload.listings[0].imageUrls, [
      '/data/profiles/vevey/images/local-cover.jpg',
      'https://example.test/fallback.jpg',
      'https://example.test/remote.jpg',
      'https://example.test/single.jpg'
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildMapListingsPayload sorts profiles by slug and listings by profile then id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apartment-map-sort-'));
  const profilesDir = path.join(root, 'profiles');

  try {
    await writeJson(path.join(profilesDir, 'zurich', 'watch-config.json'), {
      shortTitle: 'Zurich'
    });
    await writeJson(path.join(profilesDir, 'zurich', 'tracker.json'), {
      listings: [
        {
          id: 'b',
          active: true,
          display: true,
          mapLat: 47.37,
          mapLon: 8.54,
          address: 'Rue B, Zurich'
        },
        {
          id: 'a',
          active: true,
          display: true,
          mapLat: 47.38,
          mapLon: 8.55,
          address: 'Rue A, Zurich'
        }
      ]
    });

    await writeJson(path.join(profilesDir, 'lausanne', 'watch-config.json'), {
      shortTitle: 'Lausanne'
    });
    await writeJson(path.join(profilesDir, 'lausanne', 'tracker.json'), {
      listings: [
        {
          id: 'c',
          active: true,
          display: true,
          mapLat: 46.52,
          mapLon: 6.63,
          address: 'Rue C, Lausanne'
        }
      ]
    });

    const payload = await buildMapListingsPayload(profilesDir);

    assert.deepEqual(
      payload.profiles.map((profile) => profile.slug),
      ['lausanne', 'zurich']
    );
    assert.deepEqual(
      payload.listings.map((listing) => `${listing.profileSlug}:${listing.id}`),
      ['lausanne:c', 'zurich:a', 'zurich:b']
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildMapListingsPayload assigns distinct colors when profile hash colors collide', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apartment-map-colors-'));
  const profilesDir = path.join(root, 'profiles');

  try {
    for (const slug of ['lausanne-gang', 'vevey']) {
      await writeJson(path.join(profilesDir, slug, 'watch-config.json'), {
        shortTitle: slug
      });
      await writeJson(path.join(profilesDir, slug, 'tracker.json'), {
        listings: [
          {
            id: `${slug}-listing`,
            active: true,
            display: true,
            mapLat: 46.5,
            mapLon: 6.6,
            address: slug
          }
        ]
      });
    }

    assert.equal(profileColor('lausanne-gang'), profileColor('vevey'));

    const payload = await buildMapListingsPayload(profilesDir);
    const colors = payload.profiles.map((profile) => profile.color);
    const listingColors = payload.listings.map((listing) => listing.profileColor);

    assert.equal(new Set(colors).size, 2);
    assert.deepEqual(new Set(listingColors), new Set(colors));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
