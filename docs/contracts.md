# Contracts MVP — một room, nhiều run

Đây là bản thiết kế contract để các nhánh game logic, API/store và UI làm việc song song. **Mốc đầu tiên của triển khai** là chuyển các schema dưới đây thành schema runtime và TypeScript types dùng chung trong `src/contracts/`, thêm fixture hợp lệ/không hợp lệ, rồi khóa phiên bản `v1`. Không viết các page/API riêng trước khi mốc đó qua kiểm tra.

## 1. Thuật ngữ và ranh giới

| Tên | Nghĩa |
|---|---|
| `room` | Room duy nhất của ứng dụng; có `code` 4 chữ cái, roster snapshot và các run. Reset không tạo room mới. |
| `run` | Một lần chơi từ Lobby đến Finish hoặc Reset, có `runId` riêng. Các vòng, điểm và trạng thái loại thuộc run. |
| `account` | Danh tính người chơi tạo khi nhập nickname + mã room (kiểu Kahoot): `username` (nickname chuẩn hóa, lowercase), `displayName`, `teamId` (server tự gán). Không có mật khẩu; chỉ Host đăng nhập. Nickname là duy nhất trong room (qua mọi run). |
| `participant` | Account đã vào room trước khi vòng 1 của run mở. Danh sách participant bị khóa khi mở vòng 1. |
| `active` | Participant chưa bị loại. Mất kết nối không đổi trạng thái này. |
| `pick` | Lựa chọn cuối cùng của participant trong một vòng, số nguyên `0..1000` biểu diễn bước `0.1`. |
| `version` | Số nguyên tăng sau mỗi mutation có thể nhìn thấy; dùng cho `ETag`, polling và lệnh Host. |

`version` thuộc room và **không trở về 0 sau RESET**. `runId` đổi sau RESET; một request chứa `runId` cũ không được ghi vào run mới.

## 2. Seed roster SQL ở `db/`

[`db/seed.sql`](../db/seed.sql) tạo bảng source `seed_teams` chứa danh sách
đội. Chạy `npm run seed-db` trước lần tạo room đầu tiên. Không có bảng người
chơi: người chơi chỉ nhập nickname và mã room như Kahoot.
Một team có `id`, `name`, `image?`, `color?`.

- `image`, `color` tùy chọn. `image` chỉ trỏ tới asset tĩnh trong `public/teams/`. Khi không có ảnh, UI hiện tên/màu dự phòng.
- `id` đội duy nhất (không phân biệt hoa thường). Từ chối seed không có đội khi tạo room.
- Nickname: loại thẻ HTML/ký tự điều khiển, gộp khoảng trắng, trim, dài 1–20 ký tự; `username` = nickname chuẩn hóa dạng lowercase, duy nhất trong room. Server tự gán người chơi vào đội đang ít account nhất (hòa thì lấy đội đứng trước). Tối đa 200 account mỗi room.
- Khi tạo room, server snapshot danh sách đội vào store. Sửa file rồi deploy lại không thay đổi room đã có. Reset giữ đội và account.
- `db/keynesian-beauty-contest.dev.db` là SQLite database runtime trong dev, được gitignore và được migrate/kiểm tra schema khi server dev khởi động. Chỉ hỗ trợ một process dev ghi file.

## 3. Kiểu dữ liệu dùng chung

Các tên sau là contract logic; implementation có thể chia file nhưng không đổi hình dạng công khai nếu chưa cập nhật fixture và các nhánh phụ thuộc.

```ts
type Phase = 'NORMAL' | 'ESCALATION';
type Status = 'LOBBY' | 'ROUND_OPEN' | 'ROUND_LOCKED' | 'ROUND_REVEALED' | 'FINISHED';
type RuleId = 1 | 2;
type P = '0.8' | '2/3' | '1/2';

type Team = { id: string; name: string; image?: string; color?: string };
type Account = { username: string; displayName: string; teamId: string };
type Participant = Account & {
  joinedAt: string;
  status: 'ACTIVE' | 'ELIMINATED';
  eliminatedInRound: number | null;
  totalPoints: number;
};
type RoundSettings = {
  p: P; min: 0; max: 100; step: 0.1;
  timerSeconds: number | null; // 60 | 90 | 120 from the host UI (default 60); null = off
  winPoints: number;  // default 10
  losePoints: number; // default 0; deducted from every non-winner, only in rounds that have a winner
  maxPoints: number | null; // per-player total cap; null = no cap. Totals are floored at 0
  startPoints: number; // default 100; everyone starts the run with this and is eliminated at 0 points. 0 = off
};
type RoundResult = {
  average: string | null; // decimal for display; null when there are no picks
  target: string | null;
  winners: string[]; // usernames; empty is valid
  eliminatedUsername: string | null;
  eliminationSeed: string | null;
  eliminationCandidates: string[];
  pointEliminatedUsernames: string[]; // eliminated this round because their points reached 0
  pointsByUsername: Record<string, number>; // signed delta actually applied (after cap/floor); omitted when 0
};
type Round = {
  number: number;
  settings: RoundSettings;
  openedAt: string;
  deadlineAt: string | null;
  lockedAt: string | null;
  revealedAt: string | null;
  result: RoundResult | null;
};
type RoomState = {
  schemaVersion: 1;
  code: string;
  version: number;
  runId: string;
  runNumber: number;
  status: Status;
  phase: Phase;
  escalationReason: 'NASH' | 'HOST' | null;
  activeRules: RuleId[];
  teams: Team[];
  accounts: Account[];
  participants: Participant[];
  participationLocked: boolean;
  settingsForNextRound: RoundSettings;
  rounds: Round[];
  createdAt: string;
  finishedAt: string | null;
};
```

`RoomState` là kiểu logic, **không phải** JSON trả nguyên vẹn cho client: credential, token và pick nằm trong dữ liệu server riêng. Store phải cung cấp snapshot nhất quán của room, picks và version.

Contract response của `GET state` được chốt bằng discriminated union theo `view` ở M0. Các field bắt buộc:

```ts
type PublicPlayer = {
  username: string; displayName: string; teamId: string;
  hasSubmitted: boolean; status: 'ACTIVE' | 'ELIMINATED';
  eliminatedInRound: number | null; totalPoints: number;
  finalPlacement: number | null; // survival order in escalation; score rank when Host finishes early
};
type RevealedPick = { valueTenths: number }; // anonymous; winners named separately
type RevealedRound = {
  number: number; settings: RoundSettings; average: string | null;
  target: string | null; picks: RevealedPick[];
  winners: { username: string; valueTenths: number; points: number }[];
  eliminatedUsername: string | null;
};
type PublicFields = {
  schemaVersion: 1; code: string; runId: string; runNumber: number;
  version: number; serverNow: string; status: Status; phase: Phase;
  escalationReason: 'NASH' | 'HOST' | null; activeRules: RuleId[];
  teams: Team[]; players: PublicPlayer[];
  currentRound: { number: number; settings: RoundSettings; deadlineAt: string | null } | null;
  nextRoundSettings: RoundSettings; // what OPEN_ROUND will snapshot; shown in the lobby and Host settings form
  submittedCount: number; activeCount: number; revealedRounds: RevealedRound[];
  individualLeaderboard: { username: string; rank: number; points: number }[];
  teamLeaderboard: { teamId: string; rank: number; points: number }[];
};
type PublicProjection = PublicFields & { view: 'public' };
type PlayerProjection = PublicFields & {
  view: 'player';
  self: { username: string; currentPickTenths: number | null; totalPoints: number;
    status: 'ACTIVE' | 'ELIMINATED'; eliminatedInRound: number | null };
};
type HostProjection = PublicFields & {
  view: 'host';
  hostPicks: { username: string; valueTenths: number }[] | null;
};
type StateResponse = PublicProjection | PlayerProjection | HostProjection;
```

`players.hasSubmitted` và `submittedCount` chỉ tính active của vòng hiện tại. `revealedRounds` chỉ gồm vòng đã công bố. `hostPicks = null` trong OPEN và LOBBY; sau LOCK có thể chứa pick của vòng hiện tại. Field riêng của Player chỉ chứa pick của chính họ. M0 phải tạo fixture đúng shape cho mỗi trạng thái, gồm trường hợp không có pick và sau reset.

## 4. Lệnh và invariant game

Máy trạng thái: `LOBBY → ROUND_OPEN → ROUND_LOCKED → ROUND_REVEALED → (ROUND_OPEN | FINISHED)`; `RESET` từ mọi trạng thái về `LOBBY` với `runId` mới. Mỗi lệnh Host có `commandId` UUID và `expectedVersion`; cùng `commandId` lặp lại phải trả cùng kết quả, không thực hiện lần hai. Version sai trả `409 VERSION_CONFLICT` kèm version mới nhất.

```ts
type HostCommand = { commandId: string; expectedVersion: number } & (
  | { type: 'OPEN_ROUND' | 'LOCK_ROUND' | 'REVEAL_ROUND' | 'START_ESCALATION' | 'FINISH' | 'RESET' }
  | { type: 'UPDATE_SETTINGS'; payload: { p?: P; timerSeconds?: 60 | 90 | 120 | null; winPoints?: number; losePoints?: number; maxPoints?: number | null; startPoints?: number } }
);
```

| Lệnh | Điều kiện | Tác động |
|---|---|---|
| `OPEN_ROUND` | `LOBBY` hoặc `ROUND_REVEALED`; ít nhất 2 participant ở vòng đầu | Khóa participant ở vòng 1; chụp `settingsForNextRound`; mở vòng tiếp theo. |
| `LOCK_ROUND` | `ROUND_OPEN` | Chốt picks. Deadline hết hạn cũng gọi transition này từ server khi request kế tiếp đến. |
| `REVEAL_ROUND` | `ROUND_LOCKED` | Tính kết quả duy nhất, điểm, Nash hoặc loại và quy tắc mới; có thể tự `FINISHED` nếu còn một active. |
| `START_ESCALATION` | `NORMAL`, sau một vòng `ROUND_REVEALED` | Đặt phase B và Rule 1 cho vòng kế; `escalationReason='HOST'`. |
| `UPDATE_SETTINGS` | `LOBBY` hoặc `ROUND_REVEALED` | Chỉ sửa `p` và timer cho vòng kế. Vòng đã mở giữ nguyên settings snapshot. |
| `FINISH` | Room chưa `FINISHED` | Chốt run sớm, tạo bản export/retention. |
| `RESET` | Bất kỳ trạng thái nào, Host hợp lệ | Lưu run cũ có vòng thành archive, tạo `runId` mới, xóa vòng/điểm/loại/participant của run; giữ room code, roster và các session hợp lệ. |

- Chỉ participant `ACTIVE` được gửi. Client gửi `value` ở bước `0.1`; server từ chối ngoài `0..100`, sai bước, sai vòng hoặc sau deadline/lock, không tự làm tròn. Gửi lại trước lock thay thế lựa chọn cũ. Cùng request id lặp lại là idempotent.
- Sau reset, token Player cũ vẫn xác thực account nhưng account phải vào sảnh của `runId` mới để thành participant. App đang mở tự gọi lệnh join cho run mới; account offline không tự được tính. `join` sau khi mở vòng 1 chỉ hợp lệ với participant đã nằm trong run đó (để khôi phục phiên), không thêm người mới.
- Tất cả phép so sánh pick dùng số nguyên phần mười. `p` là phân số chính xác `4/5`, `2/3` hoặc `1/2`; trung bình, target và khoảng cách được so sánh bằng phân số/số nguyên, chỉ làm tròn khi trình bày.
- Người không gửi không vào trung bình, nhận 0 điểm. Không có pick: `average = target = null`, không có winner. Hòa gần target: mọi người hòa đều thắng và mỗi người +10. Bonus suýt thắng tắt trong MVP.
- Điều kiện Nash: sau reveal trong NORMAL, ít nhất 2 active và **tất cả active** đã chọn đúng `0`. Khi đó phase chuyển sang ESCALATION, hiện thông báo Nash, Rule 1 áp dụng từ vòng kế. Chuyển thủ công chỉ được ghi `HOST` và không được ghi là Nash.
- ESCALATION: pick trùng vẫn vào trung bình nhưng người chọn trùng bị Rule 1 loại khỏi tập thắng. Nếu có `0` và đúng một `100` đủ điều kiện sau Rule 1, Rule 2 cho `100` thắng; nếu không, xét người còn đủ điều kiện gần target nhất. Không có ai đủ điều kiện thì không có winner. Sau mỗi vòng B loại đúng một active khác winner; ưu tiên người không gửi → người trùng → người thua còn lại, rồi khoảng cách xa target nhất, cuối cùng seed đã lưu. Nếu nhóm không gửi hoặc không có target, tie-break bằng seed. Rule 2 bật sau lần loại đầu, giữ nguyên sau đó. Còn một active thì tự FINISHED.
- Điểm đội = tổng `totalPoints` của mọi participant trong đội, kể cả đã bị loại. Đội đồng điểm cùng hạng. Nếu FINISH sớm với nhiều active, bảng điểm cá nhân xếp theo điểm; nếu chỉ còn một active, người đó là survivor champion và bảng điểm vẫn hiển thị riêng.

## 5. API v1

Mọi body được validate runtime; lỗi chuẩn `{ "error": { "code": "...", "message": "..." } }`. Response riêng tư dùng `Cache-Control: no-store`. API không bao giờ nhận `role` từ query như bằng chứng xác thực; role được suy ra từ cookie/token.

| Method và path | Quyền | Request / response chính |
|---|---|---|
| `POST /api/host/login` | public | `{username,password}` → cookie Host `HttpOnly`, `SameSite=Strict`. Credentials so với env. |
| `POST /api/host/logout` | Host | Xóa cookie. |
| `GET /api/room` | Host | Mã room/run hiện tại nếu đã tạo; không có thì `404`. |
| `POST /api/room` | Host | Tạo room duy nhất với các đội trong `seed_teams` → `{code, runId, version}`; lần sau `409 ROOM_EXISTS`. |
| `GET /api/room/state?code=ABCD&view=public|player|host` | Public, Player hoặc Host | `view=public` không cần credential; `player` cần Player token; `host` cần Host cookie. Server kiểm tra quyền trước khi trả projection/`304`; mã sai → `404`. |
| `POST /api/room/login` | public | `{code,name}` → `{playerToken, account, runId, version}`. Tạo account theo nickname và join run hiện tại; chỉ khi run ở LOBBY (`409 INVALID_TRANSITION` nếu đã bắt đầu). Nickname trùng → `409 NAME_TAKEN`; room đầy → `409 ROOM_FULL`. Người chơi quay lại bằng token đã lưu; mất token thì không nhận lại nickname cũ được. |
| `POST /api/room/join` | Player token | `{runId}` → `{joined,version}`; idempotent. Chỉ thêm participant ở LOBBY; dùng khi token cũ nhận `runId` mới sau reset. |
| `PUT /api/room/pick` | Player token | `{runId,round,value,requestId}` → `{acceptedVersion,pick}`. |
| `POST /api/room/command` | Host | `{type,commandId,expectedVersion,payload?}` → `{version,status,runId}`. |
| `GET /api/room/archives` | Host | Danh sách `{runId,runNumber,endedAt,reason,expiresAt}` còn hạn để chọn bản xuất. |
| `GET /api/room/export?runId=...&format=csv|json` | Host | Export run hiện tại hoặc archive còn hạn. |

`GET state` dùng cùng path với `view` tường minh để Portal luôn nhận public projection, kể cả khi cùng trình duyệt có cookie Host. `view` là yêu cầu về dữ liệu, không phải bằng chứng xác thực. Response có `version`, `serverNow`, `runId`, `status`, `phase`, `teams`, tiến độ, bảng điểm, dữ liệu theo trạng thái. Cụ thể:

- **Portal/public:** tên và đội participant, cờ đã gửi, tổng số; không có pick/average/target trước `ROUND_REVEALED`. Sau reveal chỉ có pick của vòng đã công bố và dữ liệu tổng hợp. Không có token.
- **Player:** PublicProjection cộng pick hiện tại của chính mình và trạng thái riêng. Không có pick của người khác trước reveal.
- **Host:** danh sách đã/chưa gửi khi vòng mở; chỉ thấy pick của người khác sau `ROUND_LOCKED`; có thể xem archive qua endpoint Host riêng.
- Mỗi trạng thái ứng với `ETag: "<version>-<projection-role>-<runId>"`; 304 chỉ sau khi xác thực role và kiểm tra version. Poll mỗi 1 giây, thêm jitter nhỏ và tránh request chồng. Client refetch ngay khi tab hiện lại hoặc mạng phục hồi. Nếu dữ liệu run FINISHED đã hết hạn mà room shell còn, API trả `410 RUN_EXPIRED`; Portal hiển thị thông báo thay vì trang trắng, Host vẫn có thể RESET.
- Host cookie dùng `HttpOnly`, `Secure` ở production, `SameSite=Strict`; API ghi kiểm tra `Origin`. Login Host/Player và pick có rate limit cơ bản.
- `results.csv` có một dòng cho mỗi participant của từng vòng đã **công bố**: `runId,round,username,displayName,teamId,pick,distance,points,winner,eliminated`. Ô thiếu pick/distance để trống. `game.json` gồm snapshot run, đội, participants, các vòng kể cả vòng dở bị reset, và bảng điểm; không có token. Archive chỉ Host xem và xuất.

Biến môi trường: `HOST_USERNAME`, `HOST_PASSWORD`, `HOST_SESSION_SECRET` (ngẫu nhiên, >=128 bit), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `NEXT_PUBLIC_BASE_URL`. Dev mặc định `TURSO_DATABASE_URL=file:db/keynesian-beauty-contest.dev.db`; production bắt buộc `TURSO_DATABASE_URL` là URL `libsql://`/`https://` của Turso và có `TURSO_AUTH_TOKEN`. Không đưa token vào `NEXT_PUBLIC_*`.

## 6. Store và độ bền dữ liệu

```ts
interface Store {
  getRoomSnapshot(): Promise<ConsistentRoomSnapshot | null>;
  createRoom(seed: ValidatedSeed): Promise<RoomState>;
  apply(command: StoreCommand): Promise<CommandOutcome>; // atomic, idempotent
  getArchive(runId: string): Promise<RunArchive | null>;
}
```

- `StoreCommand` gồm create/login/pick/host transition/reset. Một operation phải kiểm tra trạng thái và ghi mutation như một đơn vị SQL atomic; version tăng đúng một lần khi trạng thái công khai thay đổi. Lược đồ, transaction và chỉ mục là chi tiết nội bộ của adapter, không lộ vào game logic/API/UI.
- Một adapter SQLite-compatible dùng `@libsql/client`: dev mở file SQLite cục bộ, production kết nối Turso/libSQL từ xa. Mọi mutation dùng transaction ghi và compare-and-swap `room.version` để không mất cập nhật giữa các Function; không dựa vào mutex bộ nhớ. Hai cấu hình phải chạy chung contract tests, đặc biệt burst 50 pick, lock-vs-pick, reveal lặp và reset-vs-poll. File SQLite cục bộ không được dùng ở Vercel vì Function filesystem là ephemeral/read-only ngoài `/tmp`. [Vercel: SQLite on serverless](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [Turso Cloud on Vercel](https://vercel.com/marketplace/tursocloud/database).
- Run hoàn tất được archive một lần khi FINISH; RESET của run đã FINISHED không tạo archive trùng. Run đang chơi và room shell phải sống qua restart/deploy. Dữ liệu chi tiết của run đã kết thúc/reset có TTL 7 ngày; room shell (code, roster) còn để Host reset và chơi lại. Export sau ít nhất một vòng phải được tạo từ snapshot đã lưu, không tái tính bằng cấu hình hiện tại.

## 7. Contract tests phải qua trước khi chia nhánh

1. Seed hợp lệ, team tham chiếu sai, username trùng khác hoa/thường, ảnh tùy chọn.
2. State transition hợp lệ/sai; `commandId` lặp; `expectedVersion` cũ; reset tạo `runId` mới và giữ archive cũ.
3. Số học `0.8`, `2/3`, `1/2`, hòa, 0 pick, không gửi, trùng đôi/ba, Rule 2 và fallback, Nash, Host escalation, loại bằng seed.
4. Public/Player/Host projection tại OPEN, LOCKED, REVEALED không rò pick hoặc token.
5. SQLite dev database khôi phục state sau restart; Turso/libSQL không mất pick khi 50 request đồng thời.
