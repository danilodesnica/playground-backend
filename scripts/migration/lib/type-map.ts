import { XanoColumn } from './xano-client';

export interface PgColumn {
  name: string;
  pgType: string;
  nullable: boolean;
  defaultSql?: string;
  checkSql?: string;
  fkRefTableId?: number;
  isList: boolean;
  isPrimaryKey: boolean;
  skip?: boolean;
  note?: string;
}

function baseType(col: XanoColumn): string {
  switch (col.type) {
    case 'int':         return 'bigint';
    case 'decimal':     return 'numeric';
    case 'text':        return 'text';
    case 'email':       return 'text';
    case 'bool':
    case 'boolean':     return 'boolean';
    case 'timestamp':   return 'timestamptz';
    case 'date':        return 'date';
    case 'uuid':        return 'uuid';
    case 'json':
    case 'object':      return 'jsonb';
    case 'enum':        return 'text';
    case 'attachment':
    case 'image':
    case 'video':
    case 'audio':
    case 'storage':     return 'jsonb';
    case 'vector':      return 'text';
    case 'geography':   return 'text';
    default:            return 'jsonb';
  }
}

function defaultSqlFor(col: XanoColumn, pgBase: string): string | undefined {
  const d = col.default;
  if (d === undefined || d === null || d === '') return undefined;

  if (pgBase === 'timestamptz' && d === 'now') return 'now()';
  if (pgBase === 'timestamptz') return `'${String(d).replace(/'/g, "''")}'::timestamptz`;
  if (pgBase === 'date' && d === 'now') return 'CURRENT_DATE';

  if (pgBase === 'boolean') {
    if (d === true || d === 'true' || d === 1 || d === '1') return 'true';
    if (d === false || d === 'false' || d === 0 || d === '0') return 'false';
    return undefined;
  }

  if (pgBase === 'bigint' || pgBase === 'numeric') {
    const n = Number(d);
    return Number.isFinite(n) ? String(n) : undefined;
  }

  if (pgBase === 'jsonb') {
    try {
      return `'${JSON.stringify(d).replace(/'/g, "''")}'::jsonb`;
    } catch {
      return undefined;
    }
  }

  return `'${String(d).replace(/'/g, "''")}'`;
}

export function mapColumn(col: XanoColumn): PgColumn {
  const name = col.name;
  const isPrimaryKey = name === 'id';
  const isList = col.style === 'list';
  const nullable = !isPrimaryKey && (col.nullable ?? !(col.required ?? false));

  if (col.type === 'password') {
    return {
      name,
      pgType: 'text',
      nullable: true,
      isList: false,
      isPrimaryKey: false,
      skip: true,
      note: 'password field deferred to auth task',
    };
  }

  const pgBase = baseType(col);
  const pgType = isList ? `${pgBase}[]` : pgBase;

  const defaultSql = isList ? undefined : defaultSqlFor(col, pgBase);

  let checkSql: string | undefined;
  if (col.type === 'enum' && !isList) {
    const values = col.values ?? [];
    if (values.length) {
      checkSql = `CHECK (${quoteIdent(name)} IN (${values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')}))`;
    }
  }

  const fkRefTableId = !isList ? col.tableref_id : undefined;

  const notes: string[] = [];
  if (col.type === 'password') notes.push('password deferred');
  if (['image', 'video', 'audio', 'attachment', 'storage'].includes(col.type)) notes.push('file metadata; paths rewritten during data load');
  if (col.type === 'vector') notes.push('vector fallback');
  if (col.type === 'geography') notes.push('geography fallback');
  if (isList && fkRefTableId === undefined && col.tableref_id !== undefined) notes.push(`list ref to table ${col.tableref_id} — no element-level FK`);

  return {
    name,
    pgType,
    nullable,
    defaultSql,
    checkSql,
    fkRefTableId,
    isList,
    isPrimaryKey,
    note: notes.length ? notes.join('; ') : undefined,
  };
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
