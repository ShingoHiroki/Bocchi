/**
 * MatchingService.decideMatch — ロビー自動マッチの「判定ロジック」（D3）。
 *
 * Supabase 非依存の純粋関数（副作用なし・同じ入力なら同じ出力）。
 * 「いつ実行するか（トリガー）」と「どう適用するか（DB 反映・競合制御）」は
 * アダプター層／Server Action 側に置き、この関数は「誰をどこへ割り当てるか」だけを決める
 * （CLAUDE.md / docs/implementation-plan.md 4 節・7 節 R4）。
 *
 * 仕様（D3）:
 *  1. 待機時間がしきい値（既定 60 秒）を超えた待機者を対象にする。
 *  2. ①空きのある既存ルームへ割り当てる（既存ルーム優先）。
 *  3. ②割り当てられなかった待機者が 2 人以上残れば、グループ化して新ルーム（既定定員 3）を作る。
 *  4. 1 人だけ残った場合はマッチさせず待機を継続する。
 */

/** 待機中エントリ（lobby_entries の未マッチ行に相当）。 */
export type WaitingEntry = {
  id: string;
  deviceId: string;
  nickname: string;
  xAccount: string | null;
  /** 待機開始時刻（ISO 文字列）。 */
  enteredAt: string;
};

/** 空き判定に使うルーム情報（現在人数付き）。 */
export type OpenRoom = {
  id: string;
  capacity: number;
  memberCount: number;
};

/** マッチング判定のルール。しきい値・既定定員は matching-config から渡す。 */
export type CapacityRule = {
  /** この時間を超えて待っているエントリだけを対象にする（ミリ秒）。 */
  waitThresholdMs: number;
  /** ②新ルームの既定定員。 */
  defaultCapacity: number;
};

/** ①既存ルームへの割当。 */
export type MatchAssignment = {
  entryId: string;
  roomId: string;
};

/** ②新ルームのグループ（この待機者たちで 1 ルームを作る）。 */
export type NewRoomGroup = {
  entryIds: string[];
};

export type MatchResult = {
  assignments: MatchAssignment[];
  newRooms: NewRoomGroup[];
};

/** 空の結果（何もしない）。 */
function emptyResult(): MatchResult {
  return { assignments: [], newRooms: [] };
}

/**
 * マッチングを判定する。
 *
 * @param waiting   待機中エントリ（未マッチ）
 * @param openRooms 有効な（open・未期限切れ）ルームと現在人数
 * @param rule      しきい値・既定定員
 * @param now       現在時刻（ミリ秒。テスト容易性のため引数で受け取る）
 */
export function decideMatch(
  waiting: WaitingEntry[],
  openRooms: OpenRoom[],
  rule: CapacityRule,
  now: number,
): MatchResult {
  // 1. しきい値を超えた待機者だけを、待機が古い順（公平性）に並べる。
  const eligible = waiting
    .filter((e) => now - new Date(e.enteredAt).getTime() >= rule.waitThresholdMs)
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

  if (eligible.length === 0) return emptyResult();

  // 2. 空きスロットのあるルームを、残り枠が少ない順（＝満員に近い受け皿を優先して埋める）に並べる。
  const slots = openRooms
    .map((r) => ({ id: r.id, available: r.capacity - r.memberCount }))
    .filter((r) => r.available > 0)
    .sort((a, b) => a.available - b.available || a.id.localeCompare(b.id));

  const assignments: MatchAssignment[] = [];
  const leftovers: WaitingEntry[] = [];

  // ①空きのある既存ルームへ順に割り当てる。
  let slotIndex = 0;
  for (const entry of eligible) {
    // 空きが尽きたルームを飛ばす。
    while (slotIndex < slots.length && slots[slotIndex].available <= 0) {
      slotIndex += 1;
    }
    if (slotIndex < slots.length) {
      const room = slots[slotIndex];
      assignments.push({ entryId: entry.id, roomId: room.id });
      room.available -= 1;
    } else {
      leftovers.push(entry);
    }
  }

  // ②割り当てられなかった待機者を既定定員ごとにグループ化。2 人以上のグループだけ新ルームにする。
  const newRooms: NewRoomGroup[] = [];
  const size = Math.max(2, rule.defaultCapacity);
  for (let i = 0; i < leftovers.length; i += size) {
    const group = leftovers.slice(i, i + size);
    if (group.length >= 2) {
      newRooms.push({ entryIds: group.map((e) => e.id) });
    }
    // group.length === 1（末尾に 1 人だけ）は待機継続（新ルームを作らない）。
  }

  return { assignments, newRooms };
}
