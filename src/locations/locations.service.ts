import { Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { InteractionsService } from '../interactions/interactions.service';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const LOCATION_COLUMNS =
  'id, created_at, latitude, longitude, name, end_date, category, url, description, tags, place_position, type, img_url, preview_img, reviews, average_rating';

export interface LocationDto {
  id: string;
  createdAt: number;
  latitude: number;
  longitude: number;
  name: string;
  endDate: number | null;
  category: string;
  url: string;
  description: string;
  tags: string[] | null;
  placePosition: string;
  type: string;
  imgUrl: Record<string, unknown> | null;
  previewImg: Array<Record<string, unknown>> | null;
  reviews: string[] | null;
  averageRating: number;
}

export interface FeaturedLocations {
  upcomingEvents: LocationDto[];
  popularPlaygrounds: LocationDto[];
  newPlaygrounds: LocationDto[];
  newEvents: LocationDto[];
  activities: LocationDto[];
}

export interface LocationListItem {
  id: string;
  created_at: number;
  latitude: number;
  longitude: number;
  name: string;
  endDate: number | null;
  category: string;
  url: string;
  description: string;
  tags: string[] | null;
  placePosition: string;
  type: string;
  imgUrl: Record<string, unknown> | null;
  previewImg: Array<Record<string, unknown>> | null;
  reviews: string[] | null;
  averageRating: number;
}

export interface LocationListResponse {
  itemsReceived: number;
  curPage: number;
  nextPage: number | null;
  prevPage: number | null;
  offset: number;
  perPage: number;
  items: LocationListItem[];
}

const CATEGORY_MAP: Record<string, keyof FeaturedLocations> = {
  'Upcoming Events': 'upcomingEvents',
  'Popular Playgrounds': 'popularPlaygrounds',
  'New Playgrounds': 'newPlaygrounds',
  'New Events': 'newEvents',
  Activities: 'activities',
};

function groupFeatured(rows: any[] | null): FeaturedLocations {
  const result: FeaturedLocations = {
    upcomingEvents: [],
    popularPlaygrounds: [],
    newPlaygrounds: [],
    newEvents: [],
    activities: [],
  };
  for (const row of rows ?? []) {
    const key = CATEGORY_MAP[row.category];
    if (!key) continue;
    result[key].push(toLocationDto(row));
  }
  return result;
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const t = new Date(value as string).getTime();
  return Number.isFinite(t) ? t : null;
}

function toLocationDto(row: any): LocationDto {
  return {
    id: row.id,
    createdAt: toMs(row.created_at) ?? 0,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    name: row.name,
    endDate: toMs(row.end_date),
    category: row.category,
    url: row.url,
    description: row.description,
    tags: row.tags,
    placePosition: row.place_position,
    type: row.type,
    imgUrl: row.img_url,
    previewImg: row.preview_img,
    reviews: row.reviews,
    averageRating: Number(row.average_rating),
  };
}

export function toLocationListItem(row: any): LocationListItem {
  return {
    id: row.id,
    created_at: toMs(row.created_at) ?? 0,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    name: row.name,
    endDate: toMs(row.end_date),
    category: row.category,
    url: row.url,
    description: row.description,
    tags: row.tags,
    placePosition: row.place_position,
    type: row.type,
    imgUrl: row.img_url,
    previewImg: row.preview_img,
    reviews: row.reviews,
    averageRating: Number(row.average_rating),
  };
}

@Injectable()
export class LocationsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient,
    private readonly interactions: InteractionsService,
  ) { }

  // Anonymous / public callers (e.g. /locations/free) — random selection per rail.
  async featured(): Promise<FeaturedLocations> {
    const { data, error } = await this.admin.rpc('get_featured_locations');
    if (error) {
      throw new InternalServerErrorException(`Failed to fetch featured locations: ${error.message}`);
    }
    return groupFeatured(data);
  }

  // Authenticated callers — same rails, but ranked by the user's category/tag/geo affinity.
  // Cold-start users (no clicks, no favorites) collapse to ~average_rating + jitter, which
  // matches today's random-per-rail UX.
  async featuredForUser(userId: string): Promise<FeaturedLocations> {
    const { data, error } = await this.admin.rpc('get_personalized_featured', { uid: userId });
    if (error) {
      throw new InternalServerErrorException(`Failed to fetch personalized featured: ${error.message}`);
    }
    return groupFeatured(data);
  }

  async listByCategory(category: string, perPage: number, offset: number): Promise<LocationListResponse> {
    const today = new Date().toISOString().split('T')[0];

    const { data, count, error } = await this.admin
      .from('location')
      .select(
        'id, created_at, latitude, longitude, name, end_date, category, url, description, tags, place_position, type, img_url, preview_img, reviews, average_rating',
        { count: 'exact' },
      )
      .eq('category', category)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    const curPage = Math.floor(offset / perPage) + 1;

    if (error) {
      // PGRST103 = requested range beyond end of data. Return empty page instead of 500.
      if ((error as { code?: string }).code === 'PGRST103') {
        return {
          itemsReceived: 0,
          curPage,
          nextPage: null,
          prevPage: curPage > 1 ? curPage - 1 : null,
          offset,
          perPage,
          items: [],
        };
      }
      throw new InternalServerErrorException(`Failed to fetch locations: ${error.message}`);
    }

    const items = (data ?? []).map(toLocationListItem);
    const total = count ?? 0;
    const nextPage = offset + perPage < total ? curPage + 1 : null;
    const prevPage = offset > 0 ? Math.max(1, curPage - 1) : null;

    return {
      itemsReceived: items.length,
      curPage,
      nextPage,
      prevPage,
      offset,
      perPage,
      items,
    };
  }

  async findFiltered(q: {
    type?: 'playground' | 'event' | 'all';
    filters?: string[];
    search?: string;
    longitude?: number;
    latitude?: number;
    longitudeDelta?: number;
    latitudeDelta?: number;
  }): Promise<LocationListItem[]> {
    const today = new Date().toISOString().split('T')[0];

    // Pad the viewport slightly so markers just off-screen are ready when the user pans.
    const VIEWPORT_PAD = 1.15;
    // Legacy fixed box (degrees) for older App Store builds that send only a center point.
    const LEGACY_BOX = 0.03;
    // Safety cap on payload size (the table has ~1k+ rows; client clusters them).
    const MAX_RESULTS = 2000;

    let query = this.admin
      .from('location')
      .select(LOCATION_COLUMNS)
      .or(`end_date.is.null,end_date.gte.${today}`);

    if (q.type && q.type !== 'all') {
      query = query.eq('type', q.type);
    }

    if (q.filters && q.filters.length > 0) {
      query = query.overlaps('tags', q.filters);
    }

    if (q.search) {
      const safe = q.search.replace(/[,()*]/g, ' ').replace(/%/g, '\\%');
      // Match the name, the place/area attached to the location, and the description.
      query = query.or(
        `name.ilike.%${safe}%,place_position.ilike.%${safe}%,description.ilike.%${safe}%`,
      );
    }

    // Latitude bounds: real viewport box when a delta is provided, else legacy fixed box.
    if (q.latitude !== undefined) {
      const half =
        q.latitudeDelta !== undefined ? (q.latitudeDelta * VIEWPORT_PAD) / 2 : LEGACY_BOX;
      query = query.gte('latitude', q.latitude - half).lte('latitude', q.latitude + half);
    }

    // Longitude bounds: same scheme.
    if (q.longitude !== undefined) {
      const half =
        q.longitudeDelta !== undefined ? (q.longitudeDelta * VIEWPORT_PAD) / 2 : LEGACY_BOX;
      query = query.gte('longitude', q.longitude - half).lte('longitude', q.longitude + half);
    }

    query = query.order('created_at', { ascending: false }).limit(MAX_RESULTS);

    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException(`Failed to fetch locations: ${error.message}`);
    }

    return (data ?? []).map(toLocationListItem);
  }

  async findById(id: string, userId?: string): Promise<LocationListItem> {
    const { data, error } = await this.admin
      .from('location')
      .select(
        'id, created_at, latitude, longitude, name, end_date, category, url, description, tags, place_position, type, img_url, preview_img, reviews, average_rating',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch location: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    if (userId) {
      this.interactions.track(userId, id, 'click');
    }

    return toLocationListItem(data);
  }

  // Admin — full unfiltered list (includes expired events), newest first, no pagination.
  async listAllForAdmin(): Promise<LocationListItem[]> {
    const { data, error } = await this.admin
      .from('location')
      .select(LOCATION_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch locations: ${error.message}`);
    }

    return (data ?? []).map(toLocationListItem);
  }

  // Admin — create a location. Images are pre-uploaded to Storage; the body carries their metadata.
  async createLocation(input: CreateLocationDto): Promise<LocationListItem> {
    const row = {
      name: input.name,
      description: input.description,
      latitude: input.latitude,
      longitude: input.longitude,
      place_position: input.placePosition,
      category: input.category,
      type: input.type,
      url: input.url ?? null,
      end_date: input.endDate ?? null,
      tags: input.tags ?? null,
      img_url: input.imgUrl ?? null,
      preview_img: input.previewImg ?? null,
      average_rating: 0, // NOT NULL with no DB default
    };

    const { data, error } = await this.admin
      .from('location')
      .insert(row)
      .select(LOCATION_COLUMNS)
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to create location: ${error.message}`);
    }

    return toLocationListItem(data);
  }

  // Admin — partial update. Only the keys present in the body are written;
  // an explicit null clears a nullable column. id/created_at/average_rating are never touched.
  async updateLocation(id: string, input: UpdateLocationDto): Promise<LocationListItem> {
    const COLUMN_MAP: Record<string, string> = {
      placePosition: 'place_position',
      endDate: 'end_date',
      imgUrl: 'img_url',
      previewImg: 'preview_img',
    };

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue; // omitted → leave unchanged
      patch[COLUMN_MAP[key] ?? key] = value; // null is kept intentionally (clear)
    }

    // Nothing to change — just return the current row (404 if it doesn't exist).
    if (Object.keys(patch).length === 0) {
      return this.findById(id);
    }

    const { data, error } = await this.admin
      .from('location')
      .update(patch)
      .eq('id', id)
      .select(LOCATION_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to update location: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    return toLocationListItem(data);
  }
}
