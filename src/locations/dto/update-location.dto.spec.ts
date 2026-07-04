import { UpdateLocationSchema } from './update-location.dto';

describe('UpdateLocationSchema — cafe fields', () => {
  it('accepts the exact body the admin edit page sends and keeps the cafe fields', () => {
    // Mirrors playtime-admin lib/api.ts updateLocation() body for a playground
    // with a cafe name/subtitle/directions typed in and no cafe image chosen.
    const body = {
      name: 'Gunyama Park Aquatic Playground',
      description: 'A great water play space.',
      latitude: -33.9173,
      longitude: 151.2278,
      placePosition: 'Zetland',
      category: 'Popular Playgrounds',
      type: 'playground',
      tags: ['all', 'water', '1-3'],
      url: null,
      endDate: null,
      cafeName: 'Wild Flour Cafe',
      cafeSubtitle: 'Great coffee 200m away',
      cafeDirectionsUrl: 'https://maps.google.com/?q=wild+flour',
      cafeImageUrl: null,
    };

    const parsed = UpdateLocationSchema.parse(body);
    expect(parsed.cafeName).toBe('Wild Flour Cafe');
    expect(parsed.cafeSubtitle).toBe('Great coffee 200m away');
    expect(parsed.cafeDirectionsUrl).toBe('https://maps.google.com/?q=wild+flour');
    expect(parsed.cafeImageUrl).toBeNull();
  });

  it('REPRO: a record with an empty category must not fail the whole save', () => {
    // Locations that aren't in any homepage rail hold category '' — the admin
    // form round-trips that as "". If the schema rejects it, adding a cafe to
    // any uncategorized playground fails entirely.
    const body = {
      name: 'Some Local Playground',
      description: 'Nice spot.',
      latitude: -33.9,
      longitude: 151.2,
      placePosition: 'Bondi',
      category: '',
      type: 'playground',
      tags: [],
      url: null,
      endDate: null,
      cafeName: 'Corner Cafe',
      cafeSubtitle: null,
      cafeDirectionsUrl: null,
      cafeImageUrl: null,
    };
    const result = UpdateLocationSchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('accepts explicit nulls (clearing a cafe)', () => {
    const parsed = UpdateLocationSchema.parse({
      cafeName: null,
      cafeSubtitle: null,
      cafeImageUrl: null,
      cafeDirectionsUrl: null,
    });
    expect(parsed.cafeName).toBeNull();
  });
});
