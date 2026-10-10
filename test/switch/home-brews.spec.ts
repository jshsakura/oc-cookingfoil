import { test, expect } from '../switch.setup';

test.describe('Roms and homebrews listing', () => {
  test('Shop.json lists scanned game files with name + size + icon_url', async ({ nxPage }) => {
    const response = await nxPage.request.get(`/shop.json`);
    expect(response.ok()).toBeTruthy();

    const shop = await response.json();

    // Welcome message comes from the test env (COOK_WELCOME_MSG).
    expect(shop.success).toBe('The Server Works!!');

    // Files must include both sample NSZ entries with the expected
    // wire-encoded paths. URLs are absolute against the request origin and
    // icon URLs carry a ?v= cache stamp (CyberFoil fetches them verbatim),
    // so only the stable parts are matched.
    expect(shop.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringMatching(/\/Sample%20Homebrew%20%5BNSZ%5D%2FSample%20Homebrew%20%5B05000000AB000000%5D%5Bv0%5D%20%280.39%20GB%29.nsz$/),
          name: expect.any(String),
          size: 5,
          icon_url: expect.stringMatching(/\/api\/shop\/icon\/05000000AB000000(\?|$)/),
        }),
        expect.objectContaining({
          url: expect.stringMatching(/\/Sample%20Homebrew%20%5BNSZ%5D%2FSample%20Homebrew%20%5B05000000AB000800%5D%5Bv65536%5D%20%280.11%20GB%29.nsz$/),
          name: expect.any(String),
          size: 5,
          icon_url: expect.stringMatching(/\/api\/shop\/icon\/05000000AB000800(\?|$)/),
        }),
      ]),
    );

    // Per the no-omission invariant, every file gets name + url.
    for (const f of shop.files) {
      expect(typeof f.url).toBe('string');
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
    }

    // The titledb map is left out by default (COOK_EMIT_TITLEDB): CyberFoil
    // turns its entries into ghost rows. Rich detail comes from /api/title/:id.
    expect(shop.titledb).toBeUndefined();
  });

  test('Icon endpoint 404s with no-store when the asset is not yet on disk', async ({ nxPage }) => {
    // Tinfoil and other embedded HTTP clients memoize icon responses by
    // URL; serving a 200 + 1×1 transparent PNG looked like a successful
    // fetch and pinned the placeholder forever, so a later NACP extraction
    // filling in the real bytes never made it to the screen. 404 +
    // Cache-Control: no-store is the new contract: clients render their
    // own 'no icon' placeholder and re-fetch on the next shop refresh.
    const response = await nxPage.request.get('/api/shop/icon/05000000AB000000');
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('Icon endpoint rejects bogus titleIds', async ({ nxPage }) => {
    const response = await nxPage.request.get('/api/shop/icon/notreallyhex');
    expect(response.status()).toBe(400);
  });
});
