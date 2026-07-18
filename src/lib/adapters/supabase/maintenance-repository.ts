import type { SupabaseClient } from "@supabase/supabase-js";

import type { MaintenanceRepository } from "@/lib/domain/interfaces/maintenance-repository";

import { getSupabaseServiceRoleClient } from "./client";

type PurgeRow = {
  deleted_rooms: number;
  deleted_events: number;
};

export class SupabaseMaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async purgeExpired(): Promise<{ deletedRooms: number; deletedEvents: number }> {
    // 物理削除は DB 関数 purge_expired に閉じ込める（削除条件は expires_at のみ、
    // 連鎖削除は FK の ON DELETE CASCADE 任せで巻き添えを防ぐ）。
    const { data, error } = await this.client.rpc("purge_expired");
    if (error) throw error;

    const rows = (data as PurgeRow[] | null) ?? [];
    const row = rows[0];
    return {
      deletedRooms: Number(row?.deleted_rooms ?? 0),
      deletedEvents: Number(row?.deleted_events ?? 0),
    };
  }
}

/** service_role クライアントを使う MaintenanceRepository を生成する（サーバー側専用）。 */
export function createMaintenanceRepository(): MaintenanceRepository {
  return new SupabaseMaintenanceRepository(getSupabaseServiceRoleClient());
}
