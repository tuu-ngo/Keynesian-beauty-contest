# Kế hoạch MVP — contract trước, triển khai song song

Phạm vi và quyết định: [`decisions.md`](decisions.md). Contract v1: [`contracts.md`](contracts.md). Đặc tả gốc: [`README.md`](../README.md); các mục rộng hơn MVP trong README được hoãn theo decisions.

## Mục tiêu nghiệm thu

Một Host đăng nhập, tạo room duy nhất, cho người chơi đăng nhập từ roster JSON, chạy nhiều vòng thường, đạt Nash hoặc bật leo thang thủ công, loại từng người theo hai quy tắc, xem điểm cá nhân/đội trên Portal, kết thúc hoặc reset và xuất run cũ. 50 client mô phỏng theo dõi được thay đổi trong khoảng 2 giây; dữ liệu sống qua restart của dev server và deploy/restart Function trên Vercel.

## Thứ tự và điểm khóa

| Mốc | Công việc | Đầu ra bắt buộc | Có thể bắt đầu song song sau mốc |
|---|---|---|---|
| M0 — Contracts | Chuyển `contracts.md` thành Zod schemas/types ở `src/contracts/`; viết fixtures seed, room, round, projections, command, lỗi; chốt API examples và kiểm tra liên kết với đặc tả gốc. | `npm run test:contracts` qua; contract v1 được các nhánh cùng dùng. | M1a–M1d |
| M1a — Game engine | Máy trạng thái, phân số chính xác, scoring, Nash, rule registry, elimination/seed, team ranking; hàm thuần không I/O. | Test bảng tình huống ở §7 contracts. | M2 integration |
| M1b — Store | SQLite/libSQL schema + migrations, local SQLite dev và Turso production, atomic commands, archive TTL 7 ngày, version. | Chung một bộ contract tests cho hai cấu hình; thử 50 pick đồng thời. | M2 integration |
| M1c — UI Player/Host | Login, lobby, pick, host controls, reset/export, session restore, English strings; dùng fixture/API mock theo contracts. | Story/UI flow ở mobile và desktop; không phụ thuộc store thật. | M2 integration |
| M1d — UI Portal | QR, roster/team display, timer/progress, reveal cơ bản, histogram, trend, individual/team leaderboard, Nash/manual escalation, elimination/final. | Chạy bằng fixture mọi trạng thái; không lộ pick trước reveal. | M2 integration |
| M2 — API và tích hợp | Route handlers, runtime validation, auth Host/Player, role projections, polling/ETag, deadline server-side, nối UI với store/game engine. | E2E một run và reset/archive/export; security projection tests. | M3 |
| M3 — Deploy và nghiệm thu | `.env.example`, Vercel + Turso, region gần DB, kiểm thử 50 client, lỗi mạng/reconnect, build/lint/test. | Demo trên Vercel: ba trang, 50 người, dữ liệu còn sau Function restart, xuất run cũ. | Hoàn tất MVP |

M1a–M1d là bốn luồng triển khai độc lập **sau** khi M0 được merge. UI dùng fixture từ M0; API/store không sửa shape công khai đơn phương. Nếu contract đổi, cập nhật schema, fixture, contract tests và changelog trước khi đồng bộ các nhánh.

## Phân chia file để tránh xung đột

| Luồng | Sở hữu chính | Không sửa trực tiếp |
|---|---|---|
| M0 Contracts | `src/contracts/**`, `db/seed.sql`, `docs/contracts.md` | Page và store adapter |
| M1a Game engine | `src/lib/game/**`, `tests/game/**` | `src/contracts/**` |
| M1b Store | `src/lib/store/**`, `src/lib/db/**`, `tests/store/**`, `db/keynesian-beauty-contest.dev.db` (runtime, gitignored) | Game rules và UI |
| M1c Player/Host | `src/app/page.tsx`, `src/app/play/**`, `src/app/host/**`, `src/components/player/**`, `src/components/host/**` | Portal và API route handlers |
| M1d Portal | `src/app/portal/**`, `src/components/portal/**` | Player/Host và API route handlers |
| M2 Integration | `src/app/api/**`, shared polling/auth adapters, end-to-end tests | Contract v1 trừ khi có change request |

## Công việc cụ thể theo mốc

### M0 — Khóa contract

1. Dùng scaffold Next.js App Router + TypeScript + Tailwind 4 + npm + Vitest đã có trên `main`; điều chỉnh các type/store sơ khai theo contract v1 trước khi chia nhánh.
2. Tạo/chạy `db/seed.sql` bằng `npm run seed-db`. Runtime chỉ đọc roster source ở server và snapshot roster vào room khi tạo.
3. Khai báo schema `TeamSeed`, `UserSeed`, `RoomState`, `Round`, `RoundResult`, `Command`, `Projection`, `ApiError`; cố định SQL seed, API examples và version `v1`.
4. Quyết định bảng lỗi HTTP cụ thể: 400 schema, 401 chưa xác thực, 403 sai quyền, 404 room/run, 409 trạng thái/version, 429 rate limit.
5. Chốt các fixture cho LOBBY, OPEN, LOCKED, REVEALED, NASH, ESCALATION, FINISHED và archive. Đây là dữ liệu dùng chung cho các UI trong khi backend đang xây.

### M1a — Game engine

1. Lưu pick bằng integer tenths, `p` bằng numerator/denominator; tính average/target/distance không dùng float để so sánh.
2. Triển khai transition thuần, scoring, Rule 1, Rule 2, ưu tiên quy tắc, seeded tie-break, Nash và manual escalation.
3. Tính individual/team leaderboard từ kết quả đã chốt. Test các trường hợp không gửi, không có người thắng, reset và kết thúc sớm.

### M1b — Store

1. Dùng `Store` contract; local adapter mở `db/keynesian-beauty-contest.dev.db`, chạy migrations và giữ dữ liệu qua restart. Không dùng in-memory state làm nguồn dữ liệu dev.
2. Dùng `@libsql/client`: `file:` URL ở dev và Turso/libSQL remote ở production. Mutation có điều kiện phải chạy trong một transaction ghi, gồm pick-vs-lock, reveal-once, reset/archive và version compare-and-swap. Không làm chuỗi read-then-write qua nhiều request.
3. Dùng lược đồ SQL có room singleton, runs, participants, rounds, picks, session/receipt và archive. `runId` vẫn là ID riêng; archive có TTL logic 7 ngày và được purge định kỳ khi có read/write. Thiết lập region Function gần Turso.

### M1c/M1d — Giao diện

1. Player: đăng nhập, khôi phục token, vào lại sảnh sau reset, chờ, gửi/sửa pick và stake nguyên tử đến lock, xem kết quả riêng, loại trở thành spectator. Thiết kế điện thoại rộng 360px trở lên.
2. Host: đăng nhập bằng account env, tạo room nếu chưa có, xem roster/team, điều khiển, đổi loại round (`STANDARD | WAGER`), `p`/timer giữa vòng, reset và chọn run để xuất.
3. Portal: nội dung công khai theo trạng thái, QR, tên/đội, số đã gửi, countdown, reveal/histogram/trend, thông báo Nash hoặc Host escalation, điểm cá nhân/đội, kết thúc. Chạy 16:9 không cuộn.
4. Shared polling hook 1 giây, `If-None-Match`, jitter, hủy request cũ, reconnect và đồng bộ lại; không có WebSocket trong MVP.

### M2/M3 — Tích hợp và kiểm chứng

1. Tích hợp API/auth/projections; test bằng request thật để chắc chắn Portal/Player không nhận pick người khác trước reveal, Host không thấy pick trước lock.
2. E2E: Host tạo room; ít nhất 3 Player thuộc nhiều đội; vòng thường → Nash → Rule 1 → Rule 2 → winner/elimination → finish → export → reset → archive export.
3. Chạy test tải 50 client polling mỗi giây và gửi gần đồng thời. Kiểm tra không mất pick, không nhân đôi lệnh, Portal đạt mục tiêu cập nhật trong 2 giây ở môi trường Vercel mục tiêu.
4. Kiểm tra `npm run lint`, `npm test`, `npm run typecheck`, `npm run build`, khởi động lại dev server, reconnect Player/Portal, và deploy Vercel với Turso. Ghi kết quả đo thực tế và giới hạn vào README.

## Rủi ro cần xử lý ở đúng mốc

- `README.md` còn mô tả phạm vi 200 người/i18n/`p=4/3` cho bản đầy đủ; M0 phải giữ liên kết rõ với decisions để tránh triển khai nhầm phạm vi MVP.
- Người chơi không có mật khẩu (vào bằng nickname + mã room); chỉ Host đăng nhập, Host password/secret chỉ ở env.
- Polling 1 giây với khoảng 50 client là khoảng 50+ lượt đọc trạng thái mỗi giây khi mọi tab đang mở. Cần đo chi phí/độ trễ thực tế trên Vercel và giữ projection gọn; 304 không xóa chi phí truy vấn database.
- `ROUND_OPEN` hết hạn được server kiểm tra khi request tiếp theo tới; Portal/Host đang mở bảo đảm có request đều. Nếu cần khóa đúng thời điểm khi không có client nào online, đó là yêu cầu scheduler riêng ngoài MVP.
