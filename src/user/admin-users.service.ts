import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';

export interface AdminUserListItem {
  id: string;
  name: string;
  email: string;
  postcode: string | null;
  created_at: string;
  favorites: number;
  saved_deals: number;
  reviews: number;
  last_active: string | null;
}

export interface AdminUsersListResponse {
  total: number;
  items: AdminUserListItem[];
}

export interface AdminUserDetail {
  user: {
    id: string;
    name: string;
    email: string;
    postcode: string | null;
    created_at: string;
  };
  favorites: Array<{
    location_id: string | null;
    name: string | null;
    type: string | null;
    place_position: string | null;
    saved_at: string;
  }>;
  saved_deals: Array<{
    offer_id: string | null;
    name: string | null;
    category: string | null;
    saved_at: string;
  }>;
  reviews: Array<{
    id: string;
    location_id: string | null;
    location_name: string | null;
    rating: number;
    review: string;
    status: string;
    created_at: string;
  }>;
  recent_events: Array<{
    received_at: string;
    event: string;
    screen: string | null;
    props: unknown;
    session_id: string;
  }>;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(@Inject(SUPABASE_ADMIN) private readonly admin: SupabaseClient) {}

  /** Paginated + searchable member directory. Wraps admin_users_list (migration 0012). */
  async list(
    search: string | undefined,
    limit: number,
    offset: number,
  ): Promise<AdminUsersListResponse> {
    const term = search && search.trim() !== '' ? search.trim() : null;
    const { data, error } = await this.admin.rpc('admin_users_list', {
      p_search: term,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      this.logger.error(`admin_users_list failed: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to list users: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    // `total` is a window count repeated on every row; pull it off the first row.
    const total = rows.length > 0 ? Number(rows[0].total) || 0 : 0;

    const items: AdminUserListItem[] = rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      email: r.email as string,
      // The RPC returns the raw signup `code`; the directory surfaces it as postcode.
      postcode: (r.code as string | null) ?? null,
      created_at: r.created_at as string,
      favorites: Number(r.favorites) || 0,
      saved_deals: Number(r.saved_deals) || 0,
      reviews: Number(r.reviews) || 0,
      last_active: (r.last_active as string | null) ?? null,
    }));

    return { total, items };
  }

  /** Full drill-down for one member — assembled from parallel admin queries. */
  async detail(id: string): Promise<AdminUserDetail> {
    const [profileRes, favoritesRes, savedDealsRes, reviewsRes, eventsRes] =
      await Promise.all([
        this.admin
          .from('users')
          .select('id, name, email, code, created_at')
          .eq('id', id)
          .maybeSingle(),
        this.admin
          .from('saved_location')
          .select(
            'created_at, location:location_id (id, name, type, place_position)',
          )
          .eq('user_id', id)
          .order('created_at', { ascending: false }),
        this.admin
          .from('saved_offers')
          .select('created_at, offer:offers_id (id, name, category)')
          .eq('user_id', id)
          .order('created_at', { ascending: false }),
        this.admin
          .from('reviews')
          .select(
            'id, location_id, rating, review, status, created_at, location:location_id (name)',
          )
          .eq('user_id', id)
          .order('created_at', { ascending: false }),
        this.admin
          .from('app_events')
          .select('received_at, event, screen, props, session_id')
          .eq('user_id', id)
          .order('received_at', { ascending: false })
          .limit(100),
      ]);

    for (const res of [
      profileRes,
      favoritesRes,
      savedDealsRes,
      reviewsRes,
      eventsRes,
    ]) {
      if (res.error) {
        this.logger.error(
          `admin user detail query failed: ${res.error.message}`,
        );
        throw new InternalServerErrorException(
          `Failed to load user: ${res.error.message}`,
        );
      }
    }

    const profile = profileRes.data as Record<string, unknown> | null;
    if (!profile) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const favorites = ((favoritesRes.data ?? []) as Array<any>).map((row) => ({
      location_id: row.location?.id ?? null,
      name: row.location?.name ?? null,
      type: row.location?.type ?? null,
      place_position: row.location?.place_position ?? null,
      saved_at: row.created_at,
    }));

    const savedDeals = ((savedDealsRes.data ?? []) as Array<any>).map(
      (row) => ({
        offer_id: row.offer?.id != null ? String(row.offer.id) : null,
        name: row.offer?.name ?? null,
        category: row.offer?.category ?? null,
        saved_at: row.created_at,
      }),
    );

    const reviews = ((reviewsRes.data ?? []) as Array<any>).map((row) => ({
      id: row.id,
      location_id: row.location_id ?? null,
      location_name: row.location?.name ?? null,
      rating: Number(row.rating),
      review: row.review,
      status: row.status,
      created_at: row.created_at,
    }));

    const recentEvents = ((eventsRes.data ?? []) as Array<any>).map((row) => ({
      received_at: row.received_at,
      event: row.event,
      screen: row.screen ?? null,
      props: row.props,
      session_id: row.session_id,
    }));

    return {
      user: {
        id: profile.id as string,
        name: profile.name as string,
        email: profile.email as string,
        postcode: (profile.code as string | null) ?? null,
        created_at: profile.created_at as string,
      },
      favorites,
      saved_deals: savedDeals,
      reviews,
      recent_events: recentEvents,
    };
  }
}
