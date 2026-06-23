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
import { toOfferDto } from '../offers/offers.service';
import type { OfferDto } from '../offers/offers.service';
import { SavedOfferPayloadDto } from './dto/saved-offer-payload.dto';

export interface SavedOfferRow {
  id: number;
  user_id: string;
  offers_id: number;
  created_at: string;
}

export interface SavedOfferWithOffer extends SavedOfferRow {
  offer: OfferDto | null;
}

const OFFER_EMBED = `
  id,
  created_at,
  name,
  description,
  image,
  category,
  preview_img,
  url
`;

function assertOwner(jwtUserId: string, payloadUserId: string): void {
  if (payloadUserId !== jwtUserId) {
    throw new ForbiddenException('user_id does not match the authenticated user');
  }
}

@Injectable()
export class SavedOffersService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) {}

  async create(jwtUserId: string, payload: SavedOfferPayloadDto): Promise<SavedOfferRow> {
    assertOwner(jwtUserId, payload.user_id);

    // Idempotent: an offer is saved at most once per user.
    const existing = await this.findSavedRow(jwtUserId, payload.offers_id);
    if (existing) {
      return existing;
    }

    const { data, error } = await this.admin
      .from('saved_offers')
      .insert({ user_id: jwtUserId, offers_id: payload.offers_id })
      .select('id, user_id, offers_id, created_at')
      .single();

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') {
        throw new BadRequestException('Invalid offers_id (no matching offer row)');
      }
      // Race: another request saved it between our check and insert — return that row.
      if (code === '23505') {
        const row = await this.findSavedRow(jwtUserId, payload.offers_id);
        if (row) return row;
      }
      throw new InternalServerErrorException(`Failed to save offer: ${error.message}`);
    }
    return data as SavedOfferRow;
  }

  private async findSavedRow(userId: string, offersId: number): Promise<SavedOfferRow | null> {
    const { data } = await this.admin
      .from('saved_offers')
      .select('id, user_id, offers_id, created_at')
      .eq('user_id', userId)
      .eq('offers_id', offersId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: number | string; user_id: string; offers_id: number | string; created_at: string };
    return {
      id: Number(row.id),
      user_id: row.user_id,
      offers_id: Number(row.offers_id),
      created_at: row.created_at,
    };
  }

  async findAllByMe(jwtUserId: string): Promise<SavedOfferWithOffer[]> {
    const { data, error } = await this.admin
      .from('saved_offers')
      .select(`id, user_id, offers_id, created_at, offer:offers_id (${OFFER_EMBED})`)
      .eq('user_id', jwtUserId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch saved offers: ${error.message}`);
    }

    return (data ?? []).map((row: any) => ({
      id: Number(row.id),
      user_id: row.user_id,
      offers_id: Number(row.offers_id),
      created_at: row.created_at,
      offer: row.offer ? toOfferDto(row.offer) : null,
    }));
  }

  async remove(jwtUserId: string, payload: SavedOfferPayloadDto): Promise<{ success: true; deleted: SavedOfferRow[] }> {
    assertOwner(jwtUserId, payload.user_id);

    const { data, error } = await this.admin
      .from('saved_offers')
      .delete()
      .eq('user_id', jwtUserId)
      .eq('offers_id', payload.offers_id)
      .select('id, user_id, offers_id, created_at');

    if (error) {
      throw new InternalServerErrorException(`Failed to delete saved offer: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new NotFoundException('Saved offer not found');
    }
    return { success: true, deleted: data as SavedOfferRow[] };
  }
}
