/**
 * ルーム（rooms）・ルーム参加者（room_members）へのアクセスを抽象化するインターフェース。
 * Supabase 非依存。UI・ドメインロジックはこのインターフェース越しに使う（CLAUDE.md）。
 */

export type RoomRecord = {
  id: string;
  eventId: string;
  name: string;
  capacity: number;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export type RoomMemberRecord = {
  id: string;
  roomId: string;
  nickname: string;
  xAccount: string | null;
  deviceId: string;
  joinedAt: string;
};

/** ルーム＋現在人数（SC-004 の一覧表示用）。 */
export type RoomWithMemberCount = RoomRecord & {
  memberCount: number;
};

export type CreateRoomInput = {
  eventId: string;
  /** 空文字なら実装側で自動命名する（SC-005）。 */
  name: string;
  capacity: number;
  /** 作成者。作成と同時に room_members へ追加する。 */
  creator: {
    nickname: string;
    xAccount: string | null;
    deviceId: string;
  };
};

export type JoinRoomInput = {
  roomId: string;
  nickname: string;
  xAccount: string | null;
  deviceId: string;
};

/** join の結果。満員・未存在・既参加を区別できるようにする（画面のトースト分岐用）。 */
export type JoinRoomResult =
  | { status: "joined"; member: RoomMemberRecord }
  | { status: "already_member"; member: RoomMemberRecord }
  | { status: "full" }
  | { status: "not_found" };

export interface RoomRepository {
  /** イベント配下の「有効な」ルームを現在人数付きで返す（空きあり優先で並べる）。 */
  list(eventId: string): Promise<RoomWithMemberCount[]>;

  /** ルームを作成し、作成者を room_members に追加する。作成したルームを返す。 */
  create(input: CreateRoomInput): Promise<RoomRecord>;

  /** ルームに参加する。定員超過・未存在・既参加を結果で区別する。 */
  join(input: JoinRoomInput): Promise<JoinRoomResult>;

  /** ルーム 1 件を現在人数付きで取得する（期限切れ含む。期限判定は呼び出し側）。 */
  getWithMemberCount(roomId: string): Promise<RoomWithMemberCount | null>;

  /** ルームの参加者一覧を取得する。 */
  listMembers(roomId: string): Promise<RoomMemberRecord[]>;

  /** 指定端末が参加しているルームの id 一覧（当該イベント内）。「自分の参加」を表示するため。 */
  listJoinedRoomIds(eventId: string, deviceId: string): Promise<string[]>;

  /** 指定端末をルームから除去する（SC-007 退室・OV-02）。参加していなくても成功扱い（冪等）。 */
  leave(roomId: string, deviceId: string): Promise<void>;
}
