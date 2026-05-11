import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';
import { toLocationListItem } from '../locations/locations.service';
import type { LocationListItem } from '../locations/locations.service';
import { SavedLocationBodyDto } from './dto/saved-location-body.dto';

export interface SavedLocationRow {
  id: string;
  user_id: string;
  location_id: string;
  created_at: string;
}

export interface SavedLocationWithLocation extends SavedLocationRow {
  location: LocationListItem | null;
}

const LOCATION_EMBED = `
  id,
  created_at,
  latitude,
  longitude,
  name,
  end_date,
  category,
  url,
  description,
  tags,
  place_position,
  type,
  img_url,
  preview_img,
  reviews,
  average_rating
`;

function assertOwner(jwtUserId: string, bodyUserId: string): void {
  if (bodyUserId !== jwtUserId) {
    throw new ForbiddenException('user_id in body does not match the authenticated user');
  }
}


@Injectable()
export class SavedLocationsService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) { }

  async create(jwtUserId: string, body: SavedLocationBodyDto): Promise<SavedLocationRow> {
    assertOwner(jwtUserId, body.user_id);

    const { data, error } = await this.admin
      .from('saved_location')
      .insert({ user_id: jwtUserId, location_id: body.location_id })
      .select('id, user_id, location_id, created_at')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new BadRequestException('Invalid location_id (no matching location row)');
      }
      throw new InternalServerErrorException(`Failed to save location: ${error.message}`);
    }
    return data as SavedLocationRow;
  }

  async findAllByUser(jwtUserId: string, pathUserId: string): Promise<SavedLocationWithLocation[]> {
    if (pathUserId !== jwtUserId) {
      throw new ForbiddenException('userId in path does not match the authenticated user');
    }

    const { data, error } = await this.admin
      .from('saved_location')
      .select(`id, user_id, location_id, created_at, location:location_id (${LOCATION_EMBED})`)
      .eq('user_id', jwtUserId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch saved locations: ${error.message}`);
    }

    return (data ?? []).map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      location_id: row.location_id,
      created_at: row.created_at,
      location: row.location ? toLocationListItem(row.location) : null,
    }));
  }

  async findOne(jwtUserId: string, pathUserId: string, locationId: string): Promise<SavedLocationRow[]> {
    if (pathUserId !== jwtUserId) {
      throw new ForbiddenException('userId in path does not match the authenticated user');
    }

    const { data, error } = await this.admin
      .from('saved_location')
      .select('id, user_id, location_id, created_at')
      .eq('user_id', jwtUserId)
      .eq('location_id', locationId)
      .limit(1);

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch saved location: ${error.message}`);
    }

    return (data as SavedLocationRow[]) ?? [];
  }

  async remove(jwtUserId: string, body: SavedLocationBodyDto): Promise<{ success: true; deleted: SavedLocationRow[] }> {
    assertOwner(jwtUserId, body.user_id);

    const { data, error } = await this.admin
      .from('saved_location')
      .delete()
      .eq('user_id', jwtUserId)
      .eq('location_id', body.location_id)
      .select('id, user_id, location_id, created_at');

    if (error) {
      throw new InternalServerErrorException(`Failed to delete saved location: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new NotFoundException('Saved location not found');
    }
    return { success: true, deleted: data as SavedLocationRow[] };
  }
}
