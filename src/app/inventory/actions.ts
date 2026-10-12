"use server";
import { saveCatalogItemAction as save, deleteCatalogItemAction as archive } from '@/app/catalog/actions';
export async function saveCatalogItemAction(data: Record<string, unknown>) { return save(data); }
export async function deleteCatalogItemAction(id: string, version?: number, requestKey?: string) { return archive(id, version, requestKey); }
