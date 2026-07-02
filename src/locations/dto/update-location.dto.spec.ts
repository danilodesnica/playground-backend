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
