# Quyết định cho MVP

Tài liệu này ghi các quyết định đã chốt sau khi thảo luận về [`README.md`](../README.md). Khi một mục dưới đây khác đặc tả ban đầu, quyết định MVP ở đây và [`contracts.md`](contracts.md) được ưu tiên trong quá trình triển khai MVP.

## Sản phẩm

- Một ứng dụng Next.js trên Vercel có đúng **một room** cho toàn bộ ứng dụng. Host tạo room một lần. Room có thể được reset để chơi lại, giữ nguyên mã room và roster; mỗi lần chơi là một `runId` khác nhau.
- Host có thể reset bất kỳ lúc nào. Trước khi reset, server lưu bản kết quả của run hiện tại để xem và xuất CSV/JSON trong 7 ngày. Host cũng có thể kết thúc sớm.
- Không giới hạn số vòng. Host có thể bắt đầu leo thang thủ công sau bất kỳ vòng thường nào đã công bố. Portal phải phân biệt việc chuyển thủ công với thông báo đạt cân bằng Nash.
- MVP bao gồm Nash, hai quy tắc leo thang, loại người chơi, điểm và bảng xếp hạng cá nhân/đội. Đội thắng là đội có tổng điểm cá nhân cao nhất; điểm của người bị loại vẫn được giữ.
- Chỉ người đã vào lobby trước khi Host mở vòng đầu tiên của run mới được tính là người chơi của run. Sau đó roster tham gia bị khóa. Mất kết nối không làm mất tư cách tham gia hoặc lượt chọn đã gửi.
- Giao diện MVP chỉ dùng tiếng Anh. Có QR, histogram/biểu đồ xu hướng cơ bản, xuất CSV/JSON và kiểm thử với 50 người. Chuyển ngôn ngữ, hiệu ứng trình chiếu phức tạp, phân tích cấp độ-k và kiểm thử tải 200 người để sau MVP.
- Hệ số `p` hỗ trợ `0.8`, `2/3`, `1/2`; miền cố định `0–100`, bước `0.1`. Có thể đổi `p` giữa các vòng; mỗi vòng lưu bản cấu hình được dùng để tính kết quả. Không hỗ trợ `p = 4/3` trong MVP.
- Nếu không ai đủ điều kiện thắng thì vòng không có người thắng/điểm thắng. Trong leo thang vẫn loại đúng một người. Nếu không ai gửi lựa chọn, `average` và `target` là `null`, tie-break loại dùng seed đã lưu.

## Dữ liệu và vận hành

- `db/seed.sql` chỉ chứa danh sách đội có thể sửa. Chạy `npm run seed-db` trước khi tạo room. Host tạo room sẽ snapshot các đội này, nên sửa seed sau đó không đổi room hiện có. Team có `id`, `name`, `image?`, `color?`.
- Người chơi **không đăng nhập**, vào giống Kahoot: nhập mã room + nickname là chơi. Server cấp player token lưu trong `localStorage` và tự gán đội (đội ít người nhất). Nickname duy nhất trong room. Chỉ Host có tài khoản. Người mất token không thể nhận lại nickname cũ.
- Chỉ có một tài khoản Host, khai báo trong `.env` ở dev và Environment Variables của Vercel ở production. Các thao tác tạo room, điều khiển và reset cần phiên Host hợp lệ.
- Production lưu trạng thái sống trong **Turso/libSQL** (SQLite-compatible, remote qua HTTP) được kết nối với Vercel. Không dùng file SQLite cục bộ trong Vercel Function vì filesystem của Function không bền vững và không được chia sẻ giữa các instance. Dev dùng file SQLite cục bộ `db/keynesian-beauty-contest.dev.db`; file này không commit nhưng được giữ qua lần khởi động lại dev server.
- Client polling trạng thái mỗi 1 giây qua API có `version`/`ETag`; không dùng WebSocket cho MVP. Portal và Host luôn polling khi mở; Player có thể tạm dừng khi tab ẩn và đồng bộ lại khi hiện.
- Kết quả run đã kết thúc hoặc đã reset được giữ 7 ngày để xem/xuất. Room hiện tại không mất chỉ vì Function khởi động lại.

## Quyết định giao diện/contract khi triển khai

- Reset giữ `code`, dữ liệu đội/tài khoản đã snapshot và phiên đăng nhập; xóa vòng, điểm, trạng thái loại và danh sách tham gia của run cũ. Người chơi đang mở app có thể vào lại sảnh run mới mà không nhập lại mật khẩu; khi mở vòng đầu tiên, danh sách tham gia mới được khóa lại.
- Điểm đội là tổng điểm cá nhân, kể cả điểm của người đã bị loại. Nếu bằng điểm, các đội đồng hạng. Người thắng cá nhân cuối cùng trong leo thang là người sống sót cuối; bảng điểm vẫn được hiển thị riêng.
- Host dùng cookie phiên `HttpOnly` được ký bằng secret môi trường; Player dùng token ngẫu nhiên để khôi phục phiên. Mật khẩu và token không xuất hiện trong projection của Portal.

Những quy tắc và hình thức API chi tiết nằm trong [`contracts.md`](contracts.md). Thứ tự thực hiện ở [`mvp-plan.md`](mvp-plan.md).

## Quyết định từ scaffold trên main

- Dự án dùng `npm` và `package-lock.json` vì máy dev chưa có pnpm. Scripts hiện có: `dev`, `build`, `lint`, `test`, `typecheck`.
- Tailwind CSS 4 dùng `@tailwindcss/postcss` và `@import "tailwindcss"` trong `src/app/globals.css`; không có `tailwind.config`.

## Round cá cược

- Host chọn loại cho vòng kế tiếp: `STANDARD` hoặc `WAGER`. Lựa chọn được snapshot khi mở vòng, độc lập với phase `NORMAL | ESCALATION`, và có thể đổi lại sau mỗi vòng đã công bố.
- Cá cược chỉ dùng điểm ảo trong game. Player lưu `pick` và `stake` nguyên, không âm trong cùng một request; stake không vượt quá tổng điểm hiện có. Người không gửi được pick mặc định `50` và stake mặc định `0` khi khóa vòng.
- Khi công bố vòng cá cược, server trừ stake, chia toàn bộ pot cho những winner có stake theo tỷ lệ stake, rồi áp dụng điểm thắng/thua cơ bản. Điểm chia lẻ dùng largest-remainder; phần dư bằng nhau ưu tiên username theo thứ tự tăng dần để kết quả xác định.
- Winner có stake `0` vẫn nhận điểm thắng cơ bản nhưng không nhận pot. Nếu không winner nào có stake, tất cả stake được hoàn. Sau đó mới xét loại vì điểm về `0`.
- Stake của người khác được giữ kín khi vòng mở. Sau reveal, stake, payout, wager delta, base delta và tổng delta được công bố/xuất. Hủy kết quả hoàn tác đúng tổng delta và cho phép reveal lại cùng pick/stake.
