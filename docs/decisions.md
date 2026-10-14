# Quyết định cho MVP

Tài liệu này ghi các quyết định đã chốt sau khi thảo luận về [`README.md`](../README.md). Khi một mục dưới đây khác đặc tả ban đầu, quyết định MVP ở đây và [`contracts.md`](contracts.md) được ưu tiên trong quá trình triển khai MVP.

## Sản phẩm

- Một ứng dụng Next.js trên Vercel có đúng **một room** cho toàn bộ ứng dụng. Host tạo room một lần. Room có thể được reset để chơi lại, giữ nguyên mã room và roster; mỗi lần chơi là một `runId` khác nhau.
- Host có thể reset bất kỳ lúc nào. Trước khi reset, server lưu bản kết quả của run hiện tại để xem và xuất CSV/JSON trong 7 ngày. Host cũng có thể kết thúc sớm.
- Không giới hạn số vòng. Host có thể bắt đầu leo thang thủ công sau bất kỳ vòng thường nào đã công bố. Portal phải phân biệt việc chuyển thủ công với thông báo đạt cân bằng Nash.
- MVP bao gồm Nash, hai quy tắc leo thang, loại người chơi, điểm và bảng xếp hạng cá nhân/đội. Đội thắng là đội có tổng điểm cá nhân cao nhất; điểm của người bị loại vẫn được giữ.
- Chỉ người đã đăng nhập trước khi Host mở vòng đầu tiên của run mới được tính là người chơi của run. Sau đó roster tham gia bị khóa. Mất kết nối không làm mất tư cách tham gia hoặc lượt chọn đã gửi.
- Giao diện MVP chỉ dùng tiếng Anh. Có QR, histogram/biểu đồ xu hướng cơ bản, xuất CSV/JSON và kiểm thử với 50 người. Chuyển ngôn ngữ, hiệu ứng trình chiếu phức tạp, phân tích cấp độ-k và kiểm thử tải 200 người để sau MVP.
- Hệ số `p` hỗ trợ `0.8`, `2/3`, `1/2`; miền cố định `0–100`, bước `0.1`. Có thể đổi `p` giữa các vòng; mỗi vòng lưu bản cấu hình được dùng để tính kết quả. Không hỗ trợ `p = 4/3` trong MVP.
- Nếu không ai đủ điều kiện thắng thì vòng không có người thắng/điểm thắng. Trong leo thang vẫn loại đúng một người. Nếu không ai gửi lựa chọn, `average` và `target` là `null`, tie-break loại dùng seed đã lưu.

## Dữ liệu và vận hành

- `db/teams.json` và `db/users.json` là dữ liệu đầu vào có thể sửa trước khi tạo room. Người chơi đăng nhập bằng `username` và `password` đơn giản; `displayName` tùy chọn, mặc định bằng `username`. Mỗi người có `teamId`. Team có `id`, `name`, `image?`, `color?`. Không bắt buộc đúng 50 người, 5 đội hay chia đều 10 người/đội; phải kiểm tra ID và tham chiếu hợp lệ.
- Chỉ có một tài khoản Host, khai báo trong `.env` ở dev và Environment Variables của Vercel ở production. Các thao tác tạo room, điều khiển và reset cần phiên Host hợp lệ.
- Production lưu trạng thái sống dưới dạng JSON trong Upstash Redis qua Vercel Marketplace. Dev dùng RAM và ghi snapshot vào `db/state.dev.json` sau mỗi mutation; khi khởi động lại, nạp snapshot để không mất dữ liệu. Snapshot dev không commit.
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
