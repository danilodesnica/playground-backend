/**
 * Single source of truth for Xano → Supabase naming + schema tweaks.
 * Used by both the SQL generator and the data importer.
 */

export const tableRenames: Record<string, string> = {
  user_01: 'users',
};

export const columnRenames: Record<string, Record<string, string>> = {
  location: {
    endDate: 'end_date',
    placePosition: 'place_position',
    imgUrl: 'img_url',
    previewImg: 'preview_img',
    averageRating: 'average_rating',
  },
  offers: {
    previewImg: 'preview_img',
  },
  user_01: {
    isAdmin: 'is_admin',
  },
};

export const forceNullable: Record<string, string[]> = {
  location: ['tags', 'reviews', 'preview_img'],
  offers: ['preview_img'],
  user_01: ['magic_link'],
};

export const clearDefaults: Record<string, string[]> = {
  saved_offers: ['offers_id'],
};

export const skippedColumns: Record<string, string[]> = {
  user_01: ['password'],
};

export function isSkipped(table: string, column: string): boolean {
  return skippedColumns[table]?.includes(column) ?? false;
}

export function renameTable(original: string): string {
  return tableRenames[original] ?? original;
}

export function renameColumn(table: string, original: string): string {
  return columnRenames[table]?.[original] ?? original;
}
