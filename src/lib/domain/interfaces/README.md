# domain/interfaces

Supabase 非依存のリポジトリ・チャネルのインターフェース定義を置く（`EventRepository`, `RoomRepository`,
`LobbyRepository`, `ChatRepository`, `RealtimeChannel` など）。UI・ドメインロジックはここで定義した
インターフェース越しにのみデータ操作を行い、`adapters/supabase/` の実装を直接 import しない。
