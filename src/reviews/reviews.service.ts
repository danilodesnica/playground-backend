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
import { CreateReviewDto } from './dto/create-review.dto';

export interface ReviewRow {
  id: string;
  created_at: number;
  user_id: string | null;
  location_id: string | null;
  review: string;
  rating: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ReviewUser {
  id: string;
  email: string;
  name: string;
  code: string | null;
  is_admin: boolean;
  created_at: number;
}

export interface ReviewWithUser extends ReviewRow {
  user: ReviewUser | null;
}

function toMs(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const t = new Date(value as string).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toReviewRow(row: any): ReviewRow {
  return {
    id: row.id,
    created_at: toMs(row.created_at),
    user_id: row.user_id,
    location_id: row.location_id,
    review: row.review,
    rating: Number(row.rating),
    status: row.status,
  };
}

function toReviewUser(row: any): ReviewUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    code: row.code,
    is_admin: row.is_admin,
    created_at: toMs(row.created_at),
  };
}

@Injectable()
export class ReviewsService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) {}

  async create(jwtUserId: string, body: CreateReviewDto): Promise<ReviewRow> {
    if (body.user_id !== jwtUserId) {
      throw new ForbiddenException('user_id in body does not match the authenticated user');
    }

    // 1) Insert the review (status defaults to 'pending')
    const { data: review, error: insertErr } = await this.admin
      .from('reviews')
      .insert({
        user_id: jwtUserId,
        location_id: body.location_id,
        review: body.review,
        rating: body.rating,
      })
      .select('id, created_at, user_id, location_id, review, rating, status')
      .single();

    if (insertErr) {
      if ((insertErr as { code?: string }).code === '23503') {
        throw new BadRequestException('Invalid location_id (no matching location row)');
      }
      throw new InternalServerErrorException(`Failed to create review: ${insertErr.message}`);
    }

    const created = toReviewRow(review);

    // 2) Append review.id to location.reviews uuid[] (fetch + update — atomic enough for low traffic)
    const { data: loc, error: locFetchErr } = await this.admin
      .from('location')
      .select('reviews')
      .eq('id', body.location_id)
      .maybeSingle();

    if (locFetchErr) {
      throw new InternalServerErrorException(`Review created but failed to fetch location: ${locFetchErr.message}`);
    }
    if (!loc) {
      throw new NotFoundException(`Location ${body.location_id} not found (review row still exists)`);
    }

    const updatedReviews: string[] = [...((loc.reviews as string[] | null) ?? []), created.id];

    const { error: updateErr } = await this.admin
      .from('location')
      .update({ reviews: updatedReviews })
      .eq('id', body.location_id);

    if (updateErr) {
      throw new InternalServerErrorException(`Review created but failed to append to location.reviews: ${updateErr.message}`);
    }

    return created;
  }

  async findApprovedByLocation(locationId: string): Promise<ReviewWithUser[]> {
    const { data, error } = await this.admin
      .from('reviews')
      .select(`
        id, created_at, user_id, location_id, review, rating, status,
        user:user_id (id, email, name, code, is_admin, created_at)
      `)
      .eq('location_id', locationId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch reviews: ${error.message}`);
    }

    return (data ?? []).map((row: any) => ({
      ...toReviewRow(row),
      user: row.user ? toReviewUser(row.user) : null,
    }));
  }
}
