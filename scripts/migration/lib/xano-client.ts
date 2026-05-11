import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const INSTANCE = process.env.XANO_INSTANCE!;
const WORKSPACE_ID = process.env.XANO_WORKSPACE_ID!;
const TOKEN = process.env.XANO_META_TOKEN!;

if (!INSTANCE || !WORKSPACE_ID || !TOKEN) {
  throw new Error('Missing XANO_INSTANCE, XANO_WORKSPACE_ID, or XANO_META_TOKEN in scripts/migration/.env');
}

export const xanoInstance: string = INSTANCE;
export const xanoWorkspaceId: string = WORKSPACE_ID;

export const meta: AxiosInstance = axios.create({
  baseURL: `${INSTANCE}/api:meta`,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout: 60_000,
});

export async function metaGet<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await meta.get<T>(url, config);
  return res.data;
}

export interface XanoTable {
  id: number;
  name: string;
  description?: string;
  auth?: boolean;
  tag?: string[];
  schema?: XanoColumn[];
}

export interface XanoColumn {
  name: string;
  type: string;
  nullable?: boolean;
  default?: unknown;
  required?: boolean;
  access?: string;
  style?: string;
  values?: string[];
  children?: XanoColumn[];
  config?: Record<string, unknown>;
  tableref_id?: number;
  validators?: Record<string, unknown>;
}

export async function listTables(): Promise<XanoTable[]> {
  const data = await metaGet<XanoTable[] | { items: XanoTable[] }>(`/workspace/${WORKSPACE_ID}/table`);
  return Array.isArray(data) ? data : data.items;
}

export async function getTable(tableId: number): Promise<XanoTable> {
  return metaGet<XanoTable>(`/workspace/${WORKSPACE_ID}/table/${tableId}`);
}

export async function getTableSchema(tableId: number): Promise<XanoColumn[]> {
  const data = await metaGet<XanoColumn[] | { schema: XanoColumn[] }>(`/workspace/${WORKSPACE_ID}/table/${tableId}/schema`);
  return Array.isArray(data) ? data : data.schema;
}
