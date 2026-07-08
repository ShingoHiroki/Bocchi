# domain/services

マッチング判定ロジックなど、Supabase に依存しない純粋関数を置く（例: `MatchingService.decideMatch()`）。
「いつ実行するか（トリガー）」は adapters 層で差し替え、ロジック自体はここに閉じ込める。
