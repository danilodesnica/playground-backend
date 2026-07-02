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

export interface ReviewLocation {
  id: string;
  name: string;
  type: string;
  placePosition: string | null;
}

export interface ReviewWithUser extends ReviewRow {
  user: ReviewUser | null;
  /** Populated on the admin list so moderators can see what the review is for. */
  location?: ReviewLocation | null;
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

    // Insert the review (status defaults to 'pending'). The reviews_stats DB trigger
    // (migration 0006) recomputes location.average_rating and location.reviews from
    // approved reviews — no manual, non-atomic read-modify-write here.
    const { data: review, error: insertErr } = await this.admin
      .from('reviews')
      .insert({
        user_id: jwtUserId,
        location_id: body.location_id,
        review: body.review ?? '',
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

    return toReviewRow(review);
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

  // Admin — every review (all statuses), newest first, with the author AND the
  // reviewed location joined so moderators can see what each review is for.
  async listAllForAdmin(): Promise<ReviewWithUser[]> {
    const { data, error } = await this.admin
      .from('reviews')
      .select(`
        id, created_at, user_id, location_id, review, rating, status,
        user:user_id (id, email, name, code, is_admin, created_at),
        location:location_id (id, name, type, place_position)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch reviews: ${error.message}`);
    }

    return (data ?? []).map((row: any) => ({
      ...toReviewRow(row),
      user: row.user ? toReviewUser(row.user) : null,
      location: row.location
        ? {
            id: row.location.id,
            name: row.location.name,
            type: row.location.type,
            placePosition: row.location.place_position ?? null,
          }
        : null,
    }));
  }

  // Admin — flip a review's moderation status.
  async setStatus(id: string, status: 'approved' | 'rejected'): Promise<ReviewRow> {
    const { data, error } = await this.admin
      .from('reviews')
      .update({ status })
      .eq('id', id)
      .select('id, created_at, user_id, location_id, review, rating, status')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to update review: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(`Review ${id} not found`);
    }

    return toReviewRow(data);
  }
}
