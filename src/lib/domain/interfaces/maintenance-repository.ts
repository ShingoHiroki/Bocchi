/**
 * TTL の物理削除（R6）を抽象化するインターフェース（Supabase 非依存）。
 * UI・ドメインロジックはこのインターフェース越しにのみデータ操作を行い、
 * adapters/supabase の実装を直接 import しない（CLAUDE.md）。
 *
 * 期限切れデータの掃除は「アクセス時のオポチュニスティック削除」で行う（実装計画 7 節 R6）。
 * 「いつ呼ぶか（トリガー）」はアプリ側（actions.ts）が持ち、実際の削除方法はここに隔離する。
 */

export interface MaintenanceRepository {
  /**
   * 期限切れ（expires_at <= now()）の events / rooms を物理削除する。
   * 配下の room_members / messages / lobby_entries は FK の ON DELETE CASCADE で連鎖削除される。
   * 返り値は観測・検証用の削除件数（直接削除した rooms / events の数）。
   */
  purgeExpired(): Promise<{ deletedRooms: number; deletedEvents: number }>;
}
