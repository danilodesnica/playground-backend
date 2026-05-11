import { Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';

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
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) { }

  async featured(): Promise<FeaturedLocations> {
    const { data, error } = await this.admin.rpc('get_featured_locations');
    if (error) {
      throw new InternalServerErrorException(`Failed to fetch featured locations: ${error.message}`);
    }

    const result: FeaturedLocations = {
      upcomingEvents: [],
      popularPlaygrounds: [],
      newPlaygrounds: [],
      newEvents: [],
      activities: [],
    };

    for (const row of data ?? []) {
      const key = CATEGORY_MAP[row.category];
      if (!key) continue;
      result[key].push(toLocationDto(row));
    }
    return result;
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
  }): Promise<LocationListItem[]> {
    console.log('[locations.findFiltered] raw query:', JSON.stringify(q));

    const today = new Date().toISOString().split('T')[0];
    const appliedFilters: string[] = [];

    let query = this.admin
      .from('location')
      .select(
        'id, created_at, latitude, longitude, name, end_date, category, url, description, tags, place_position, type, img_url, preview_img, reviews, average_rating',
      )
      .or(`end_date.is.null,end_date.gte.${today}`);
    appliedFilters.push(`end_date IS NULL OR >= ${today}`);

    if (q.type && q.type !== 'all') {
      query = query.eq('type', q.type);
      appliedFilters.push(`type = '${q.type}'`);
    } else {
      console.log('[locations.findFiltered] type filter skipped:', q.type ?? '(undefined)');
    }

    if (q.filters && q.filters.length > 0) {
      query = query.overlaps('tags', q.filters);
      appliedFilters.push(`tags && [${q.filters.map((t) => `'${t}'`).join(',')}]`);
    } else {
      console.log('[locations.findFiltered] tags filter skipped');
    }

    if (q.search) {
      const safe = q.search.replace(/[,()*]/g, ' ').replace(/%/g, '\\%');
      query = query.or(`name.ilike.%${safe}%,place_position.ilike.%${safe}%`);
      appliedFilters.push(`name OR place_position ILIKE %${safe}%`);
    } else {
      console.log('[locations.findFiltered] search filter skipped');
    }

    if (q.latitude !== undefined) {
      const lo = q.latitude - 0.03;
      const hi = q.latitude + 0.03;
      query = query.gte('latitude', lo).lte('latitude', hi);
      appliedFilters.push(`latitude BETWEEN ${lo} AND ${hi}`);
    } else {
      console.log('[locations.findFiltered] latitude filter skipped');
    }

    if (q.longitude !== undefined) {
      const lo = q.longitude - 0.03;
      const hi = q.longitude + 0.03;
      query = query.gte('longitude', lo).lte('longitude', hi);
      appliedFilters.push(`longitude BETWEEN ${lo} AND ${hi}`);
    } else {
      console.log('[locations.findFiltered] longitude filter skipped');
    }

    query = query.order('created_at', { ascending: false });

    console.log('[locations.findFiltered] applied:', appliedFilters);

    const { data, error } = await query;
    if (error) {
      console.error('[locations.findFiltered] supabase error:', error);
      throw new InternalServerErrorException(`Failed to fetch locations: ${error.message}`);
    }

    const rows = (data ?? []).map(toLocationListItem);
    console.log(`[locations.findFiltered] returned ${rows.length} rows`);
    return rows;
  }

  async findById(id: string): Promise<LocationListItem> {
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
    return toLocationListItem(data);
  }
}
