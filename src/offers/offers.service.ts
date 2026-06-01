import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';

export interface OfferDto {
  id: number;
  created_at: number;
  name: string;
  description: string;
  image: Record<string, unknown> | null;
  category: string;
  previewImg: Array<Record<string, unknown>> | null;
  url: string;
  isSaved?: boolean;
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const t = new Date(value as string).getTime();
  return Number.isFinite(t) ? t : null;
}

export function toOfferDto(row: any, isSaved?: boolean): OfferDto {
  return {
    id: Number(row.id),
    created_at: toMs(row.created_at) ?? 0,
    name: row.name,
    description: row.description,
    image: row.image,
    category: row.category,
    previewImg: row.preview_img,
    url: row.url,
    ...(isSaved === undefined ? {} : { isSaved }),
  };
}

const OFFER_COLUMNS = 'id, created_at, name, description, image, category, preview_img, url';

@Injectable()
export class OffersService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) { }

  async findAll(jwtUserId: string): Promise<OfferDto[]> {
    const [offersRes, savedRes] = await Promise.all([
      this.admin
        .from('offers')
        .select(OFFER_COLUMNS)
        .order('created_at', { ascending: false }),
      this.admin
        .from('saved_offers')
        .select('offers_id')
        .eq('user_id', jwtUserId),
    ]);

    if (offersRes.error) {
      throw new InternalServerErrorException(`Failed to fetch offers: ${offersRes.error.message}`);
    }
    if (savedRes.error) {
      throw new InternalServerErrorException(`Failed to fetch saved offers: ${savedRes.error.message}`);
    }

    const savedSet = new Set<number>(
      (savedRes.data ?? []).map((r: { offers_id: number | string }) => Number(r.offers_id)),
    );

    return (offersRes.data ?? []).map((row: any) => toOfferDto(row, savedSet.has(Number(row.id))));
  }

  async findById(id: number): Promise<OfferDto> {
    const { data, error } = await this.admin
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch offer: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(`Offer ${id} not found`);
    }
    return toOfferDto(data);
  }

  // Admin — create an offer. Images are pre-uploaded to Storage; the body carries their metadata.
  async createOffer(input: CreateOfferDto): Promise<OfferDto> {
    const row = {
      name: input.name,
      description: input.description,
      category: input.category,
      url: input.url,
      image: input.image ?? null,
      preview_img: input.previewImg ?? null,
    };

    const { data, error } = await this.admin
      .from('offers')
      .insert(row)
      .select(OFFER_COLUMNS)
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to create offer: ${error.message}`);
    }

    return toOfferDto(data);
  }

  // Admin — partial update. Only the keys present in the body are written;
  // an explicit null clears a nullable column (image / preview_img). id/created_at untouched.
  async updateOffer(id: number, input: UpdateOfferDto): Promise<OfferDto> {
    const COLUMN_MAP: Record<string, string> = {
      previewImg: 'preview_img',
    };

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue; // omitted → leave unchanged
      patch[COLUMN_MAP[key] ?? key] = value; // null kept intentionally (clear)
    }

    // Nothing to change — return the current row (404 if it doesn't exist).
    if (Object.keys(patch).length === 0) {
      return this.findById(id);
    }

    const { data, error } = await this.admin
      .from('offers')
      .update(patch)
      .eq('id', id)
      .select(OFFER_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to update offer: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(`Offer ${id} not found`);
    }

    return toOfferDto(data);
  }
}
