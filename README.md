# Keynesian Beauty Contest — Máy chủ trò chơi trực tiếp

Ứng dụng web để tổ chức **trò chơi cuộc thi sắc đẹp Keynes** (trò chơi “đoán 80% giá trị trung bình”; phiên bản kinh điển sử dụng 2/3) trực tiếp với một nhóm người. Người chơi tham gia bằng điện thoại qua một đường link; người dẫn chiếu một **cổng hiển thị** trên màn hình lớn để cả phòng cùng theo dõi diễn biến trò chơi. Ứng dụng được lưu trữ trên **Vercel**.

README này là đặc tả sản phẩm và kỹ thuật gốc. **Phạm vi MVP đã được chốt lại** trong [`decisions.md`](docs/decisions.md), [`contracts.md`](docs/contracts.md) và [`mvp-plan.md`](docs/mvp-plan.md). Khi tài liệu gốc khác các quyết định MVP, dùng ba tài liệu này để triển khai MVP; các phần còn lại là định hướng sau MVP.

---

## 1. Trò chơi

### Bối cảnh
John Maynard Keynes (*General Theory*, 1936, chương 12) so sánh việc chọn cổ phiếu với một cuộc thi trên báo, trong đó người tham gia chọn 6 gương mặt đẹp nhất trong 100 bức ảnh và chiến thắng bằng cách chọn những gương mặt được *nhiều người khác* chọn nhất. Người chơi cấp độ 1 chọn điều họ thấy đẹp nhất; người chơi cấp độ 2 chọn điều họ nghĩ người trung bình thấy đẹp nhất; người chơi cấp độ 3 đoán điều mà họ nghĩ người trung bình nghĩ người trung bình nghĩ là đẹp nhất, và cứ thế tiếp tục.

Phiên bản tiêu chuẩn trong phòng thí nghiệm/lớp học là **cuộc thi vẻ đẹp p** (Nagel 1995):

1. Mỗi người chơi bí mật chọn một số trong `[0, 100]`.
2. Tính giá trị trung bình của tất cả lựa chọn.
3. **Mục tiêu** là `p × average` (mặc định `p = 0.8`, tức **80% giá trị trung bình**; phiên bản trong sách sử dụng `p = 2/3`).
4. Người chơi có lựa chọn **gần mục tiêu nhất** sẽ thắng vòng.

### Lý thuyết (hiển thị cho khán giả trong phần tổng kết)
- Nếu mọi người chọn ngẫu nhiên theo phân phối đều, giá trị trung bình ≈ 50, nên mục tiêu ≈ 40 (`0.8 × 50`). Người chơi “cấp độ 1” chọn khoảng 40.
- Người chơi “cấp độ 2” dự đoán những người khác sẽ chọn 40 và chọn khoảng 32; cấp độ 3 chọn khoảng 25,6; cấp độ 4 khoảng 20,5; v.v. (`50 · 0.8ᵏ`). Với `p = 2/3`, dãy cấp độ-k tiến về 0 nhanh hơn (các bước là 33, 22, 15…).
- Lặp vô hạn sẽ hội tụ về **0**, cân bằng Nash duy nhất (đối với lựa chọn giá trị thực).
- Các nhóm thực tế không chơi 0. Kết quả vòng đầu điển hình của trò chơi kinh điển với `p = 2/3`: các lựa chọn tập trung gần **33** và **22**, cùng các đỉnh tại 50 và 0/1; giá trị trung bình khoảng 25–40 tùy nhóm (ví dụ khoảng ≈ 40 ở khán giả kinh doanh nói chung, ≈ 25–30 ở nghiên cứu sinh kinh tế / sinh viên Caltech). Các con số này dành cho `p = 2/3`; với `p = 0.8`, hãy kỳ vọng các cụm gần **40** và **32** cùng giá trị trung bình cao hơn.
- Qua nhiều vòng, giá trị trung bình giảm dần về 0 khi người chơi học hỏi.

### Giai đoạn leo thang (quy tắc loại người chơi)
Trò chơi có hai giai đoạn.

**Giai đoạn A — Bình thường.** Áp dụng các quy tắc cơ bản ở trên. Mọi người chơi mọi vòng. Không có loại người chơi.

**Giai đoạn B — Leo thang.** Bắt đầu khi phòng chơi đạt **cân bằng Nash**, từ đó trò chơi trở nên khắc nghiệt hơn: người chơi bị loại từng người một và mỗi bước bổ sung một quy tắc mới.

- **Điều kiện kích hoạt Nash.** Sau khi công bố kết quả một vòng, nếu **mọi người chơi đang hoạt động đều gửi chính xác giá trị nhỏ nhất của miền (`0` theo mặc định)**, cân bằng đã đạt được. (Cần ít nhất 2 người chơi đang hoạt động. Giai đoạn B không kết thúc sau khi bắt đầu; trạng thái này không thể đảo ngược trong trò chơi đó.)
- **Tại thời điểm kích hoạt:** thông báo “Đã đạt cân bằng Nash” và kích hoạt **Quy tắc 1**. Giai đoạn B bắt đầu từ vòng **tiếp theo**.
- **Mỗi vòng trong Giai đoạn B loại chính xác một người chơi** (xem “Ai bị loại” bên dưới). **Sau mỗi lần loại**, quy tắc tiếp theo trong danh sách được kích hoạt (lần loại đầu tiên kích hoạt **Quy tắc 2**). Các quy tắc đã kích hoạt vẫn tiếp tục có hiệu lực và được tích lũy.
- Trò chơi kết thúc khi còn **một người chơi đang hoạt động** (người thắng) hoặc khi người dẫn kết thúc. Người chơi bị loại trở thành khán giả: họ tiếp tục thấy chế độ hiển thị kiểu Portal, không thể gửi lựa chọn, và được xếp hạng theo thứ tự bị loại (bị loại sau có thứ hạng cao hơn).

**Danh sách quy tắc** (có thứ tự, có thể mở rộng; v1 cung cấp hai quy tắc này):

| # | Quy tắc | Tác động |
|---|--------|---------|
| 1 | **Không trùng lặp** | Bất kỳ giá trị nào được **từ 2 người chơi trở lên** chọn: tất cả những người chơi đó **tự động thua vòng** (không thể thắng vòng). Những người có lựa chọn duy nhất đủ điều kiện; người thắng là người đủ điều kiện gần mục tiêu nhất. Các lựa chọn trùng nhau **vẫn được tính** vào giá trị trung bình. |
| 2 | **100 đánh bại 0** | Nếu có ít nhất một người chơi chọn `0` **và** ít nhất một người chọn `100` (giá trị nhỏ nhất / lớn nhất của miền), người chọn `100` **chắc chắn thắng** vòng, bất kể khoảng cách tới mục tiêu. Nếu nhiều người chơi chọn `100` và Quy tắc 1 đang hoạt động, họ bị xem là trùng lặp và thua, nên quy tắc này không tạo ra người thắng và vòng sẽ quay về Quy tắc 1 / cách tính cơ bản. |

**Độ ưu tiên khi các quy tắc chồng lấn:** kết quả Quy tắc 2 → lọc theo Quy tắc 1 → “gần mục tiêu nhất” cơ bản. Một quy tắc không bao giờ ghi đè quy tắc có độ ưu tiên cao hơn.

**Ai bị loại** (mỗi vòng Giai đoạn B một người, không bao giờ là người thắng vòng đó). Các ứng viên được xếp theo các nhóm từ tệ nhất đến tốt nhất:
1. Người chơi đang hoạt động **không gửi lựa chọn**.
2. Người chơi tự động thua do Quy tắc 1 (trùng lặp), nếu Quy tắc 1 đang hoạt động.
3. Tất cả những người chơi không thắng còn lại.

Trong mỗi nhóm, người chơi có **khoảng cách lớn nhất tới mục tiêu** bị loại. Nếu vẫn hòa, chọn **ngẫu nhiên bằng một seed được lưu trữ**, đồng thời ghi seed và danh sách ứng viên vào lịch sử vòng để có thể kiểm tra kết quả. Mỗi vòng loại chính xác một người chơi.

### Nguồn tham khảo
- Wikipedia: <https://en.wikipedia.org/wiki/Keynesian_beauty_contest>
- Nagel (1995), “Unraveling in Guessing Games: An Experimental Study”, *American Economic Review*.
- Quy trình lớp học: <https://en.wikiversity.org/wiki/Economic_Classroom_Experiments/Guessing_Game>
- Bài giảng có biểu đồ Nagel: <https://cs.brown.edu/courses/csci1440/lectures/2025/beauty_contest.pdf>

---

## 2. Vai trò và màn hình

| Vai trò | Thiết bị | URL | Mục đích |
|------|--------|-----|---------|
| **Người chơi** | Điện thoại (dọc) | `/` và `/play/[code]` | Tham gia trò chơi, gửi một số, xem kết quả của mình |
| **Người dẫn** | Laptop | `/host/[code]` | Tạo trò chơi, điều khiển các vòng, xem toàn bộ dữ liệu |
| **Portal** | Máy chiếu / màn hình lớn (16:9, 1920×1080) | `/portal/[code]` | Màn hình khán giả chỉ đọc của trò chơi trực tiếp |

Người dẫn mở Portal trong một cửa sổ trình duyệt thứ hai và chiếu nó. Các điều khiển của người dẫn và Portal là **những trang riêng biệt**: Portal tuyệt đối không được hiển thị điều khiển hoặc bất kỳ thông tin nào khán giả không nên thấy (ví dụ: lựa chọn riêng lẻ trong giai đoạn gửi lựa chọn).

### 2.1 Luồng người chơi
1. Mở đường link được chia sẻ (`/` hoặc `/play/ABCD`). Nhập **mã trò chơi** (4 chữ cái viết hoa) và **tên hiển thị** (tối đa 20 ký tự, duy nhất trong trò chơi; tên trùng bị từ chối kèm thông báo rõ ràng).
2. Chờ trong sảnh (“Đang chờ người dẫn…”).
3. Khi một vòng mở: xem lời nhắc quy tắc, ô nhập số (thanh trượt + trường số, `0–100`, bước mặc định `0.1`, có thể cấu hình), nút **Gửi** và bộ đếm ngược nếu đã đặt hẹn giờ. Lựa chọn đã gửi là lựa chọn cuối cùng, trừ khi người dẫn bật “cho phép thay đổi cho đến khi khóa” (mặc định: được phép thay đổi cho đến khi vòng bị khóa).
4. Sau khi gửi: “Đã khóa ✓ — đang chờ những người khác”. Hiển thị số người đã gửi (chỉ hiển thị số lượng).
5. Sau khi công bố: hiển thị lựa chọn của mình, giá trị trung bình, mục tiêu, người thắng, thứ hạng và khoảng cách tới mục tiêu của mình.
6. Giữa các vòng: điểm tích lũy và vị trí trên bảng xếp hạng.
7. Trong `ESCALATION`: các quy tắc đang hoạt động luôn được hiển thị phía trên ô nhập. Nếu bị loại, người chơi thấy màn hình “Bị loại ở vòng N” và trở thành khán giả (không còn ô nhập).

Người chơi có thể tham gia lại sau khi đóng tab (token phiên được lưu trong `localStorage`, gắn với tên hiển thị). Người chơi mất kết nối không được mất lựa chọn đã gửi.

### 2.2 Luồng người dẫn
1. **Tạo trò chơi**: chọn cài đặt (xem §3.3). Nhận mã trò chơi, link tham gia của người chơi, mã QR và link Portal. Không có hệ thống tài khoản; người dẫn được xác định bằng **host token** bí mật (ngẫu nhiên, ≥128 bit) lưu trong `localStorage` và trong fragment của URL người dẫn để có thể mở lại trang.
2. **Sảnh**: xem danh sách người chơi đã tham gia theo thời gian thực; có thể đuổi một người chơi.
3. **Điều khiển vòng** (máy trạng thái, §3.1): `Open round` → (hẹn giờ hoặc thủ công) `Lock` → `Reveal` → `Next round` / `Finish game`.
4. Chỉ có thể chỉnh `p`, hẹn giờ và miền giá trị **giữa các vòng**.
5. Có thể xuất kết quả dưới dạng CSV/JSON bất kỳ lúc nào sau vòng 1.
6. Có thể **kết thúc trò chơi** và hiển thị bục chung cuộc.

### 2.3 Portal (màn hình trình chiếu) — yêu cầu cốt lõi
Chỉ đọc, tự động cập nhật, dễ đọc từ cuối phòng (chữ lớn, tương phản cao, văn bản phụ tối thiểu 28 px ở độ phân giải 1080p). Mặc định dùng giao diện tối. Không cuộn; mọi thứ vừa trong một khung nhìn 16:9 và co giãn theo `vw`/`vh`. Thiết kế để người chơi không cần nhìn vào điện thoại vẫn theo dõi được diễn biến.

Trạng thái và nội dung Portal hiển thị:

| Trạng thái trò chơi | Nội dung Portal |
|------------|----------------|
| **Sảnh** | Mã trò chơi thật lớn, URL tham gia và **mã QR**, danh sách/lưới tên người chơi tham gia trực tiếp với hiệu ứng xuất hiện, số người chơi. Bảng quy tắc ngắn (4 bước ở §1). |
| **Vòng mở** | Số vòng, quy tắc (“Chọn một số 0–100. Người gần **80% giá trị trung bình** nhất sẽ thắng.” (văn bản lấy từ `p` đã cấu hình)), **bộ đếm ngược** lớn (nếu có hẹn giờ), vòng tiến độ trực tiếp “23 / 31 đã gửi”, và tên những người đã gửi hiển thị dưới dạng dấu tick (**chỉ tên, không bao giờ hiển thị giá trị**). |
| **Vòng bị khóa** | “Các lựa chọn đã được chốt!” cùng hiệu ứng hồi hộp ngắn (≈3 giây, người dẫn có thể bỏ qua). |
| **Công bố** | Chuỗi hiệu ứng: (1) biểu đồ histogram của tất cả lựa chọn được dựng từng bin trên trục 0–100; (2) một dấu dọc quét vào cho **giá trị trung bình**; (3) dấu thứ hai cho **mục tiêu** (`p × average`); (4) làm nổi bật người thắng cùng tên, lựa chọn và khoảng cách. Mặc định lựa chọn ẩn danh được hiển thị dưới dạng chấm; người dẫn có thể bật “hiển thị tên khi công bố”. |
| **Giữa các vòng** | Bảng xếp hạng (top 10, điểm tích lũy), cùng **biểu đồ xu hướng** của giá trị trung bình và mục tiêu qua các vòng đã chơi. |
| **Đã đạt Nash** | Thông báo ấn tượng toàn màn hình “Đã đạt cân bằng Nash — mọi người đều chọn 0”, sau đó là thẻ hiển thị **Quy tắc 1** với giải thích ngắn bằng ngôn ngữ đơn giản và ví dụ. Giữ nguyên cho đến khi người dẫn chuyển tiếp. |
| **Vòng leo thang** | Giống Vòng mở/Công bố, cộng thêm thanh bên **Các quy tắc đang hoạt động** (các thẻ được đánh số cho từng quy tắc đang có hiệu lực), bộ đếm **người chơi còn lại**, và người chơi bị loại được làm mờ cùng vòng bị loại. Chuỗi công bố thêm một bước: làm nổi bật các lựa chọn trùng lặp (Quy tắc 1), hiển thị tương tác `0` / `100` (Quy tắc 2), và kết thúc bằng **khoảnh khắc loại** (tên người bị loại, có hiệu ứng). Quy tắc mới thêm được thông báo sau khi loại. |
| **Chung cuộc** | Bục top 3, biểu đồ xu hướng tất cả các vòng với đường nét đứt tại cân bằng lý thuyết `0`, và **bảng tổng kết**: phần giải thích “Lập luận cấp độ-k” biểu diễn vị trí lựa chọn của phòng so với các giá trị cấp độ-k `50 · pᵏ` (với `p = 0.8`: 50 / 40 / 32 / 25,6 / 20,5 … 0; xem §3.5). |

Yêu cầu Portal:
- Cập nhật trong vòng **≤ 2 giây** sau mọi thay đổi trạng thái (xem §4.2 về phương thức truyền tải).
- Tự động kết nối lại sau khi mạng bị ngắt; hiển thị huy hiệu nhỏ “đang kết nối lại…”, không bao giờ hiển thị màn hình trống hoặc lỗi.
- Thân thiện với chế độ toàn màn hình (ẩn con trỏ sau 3 giây không hoạt động; phím `F` bật/tắt toàn màn hình).
- An toàn cho khán giả: **không bao giờ** gửi lựa chọn riêng lẻ tới client Portal trước trạng thái Công bố (phải thực thi trên server, không chỉ trong UI).
- Hoạt động với tối đa **200 người chơi** mà không vỡ bố cục (lưới tên chuyển sang chế độ gọn / chỉ hiển thị số lượng khi vượt khoảng 60 tên).

---

## 3. Yêu cầu chức năng

### 3.1 Máy trạng thái trò chơi
```
LOBBY → ROUND_OPEN → ROUND_LOCKED → ROUND_REVEALED → (ROUND_OPEN | FINISHED)
```
- Chuyển trạng thái chỉ do người dẫn kích hoạt (hoặc do hẹn giờ hết hạn đối với `ROUND_OPEN → ROUND_LOCKED`, được đánh giá phía server).
- Server là nguồn sự thật duy nhất. Client không bao giờ tự tính kết quả.
- Mọi chuyển trạng thái đều idempotent (những lần bấm lặp lại của người dẫn không được chuyển tiến hai lần).
- Trò chơi cũng chứa `phase: NORMAL | ESCALATION`, `activeRules: number[]` và `status: ACTIVE | ELIMINATED` cho từng người chơi (kèm `eliminatedInRound`). Khi `ROUND_OPEN → ROUND_LOCKED → ROUND_REVEALED`, server lần lượt đánh giá kết quả vòng (§3.2 với các quy tắc), điều kiện Nash (nếu `NORMAL`), việc loại (nếu `ESCALATION`) và kích hoạt quy tắc. Trạng thái `FINISHED` cũng được tự động chuyển sang khi chỉ còn một người chơi đang hoạt động.
- Chỉ người chơi `ACTIVE` mới được gửi lựa chọn và được tính trong “N / M đã gửi”.

### 3.2 Quy tắc tính điểm và người thắng
- `average = mean(all valid picks)`; `target = p × average`.
- Người thắng = (những) lựa chọn có `|pick − target|` nhỏ nhất. **Hòa**: tất cả người hòa đều thắng và mỗi người nhận đủ điểm (không chia ngẫu nhiên).
- Trong `ESCALATION`, áp dụng các quy tắc đang hoạt động ở §1 theo độ ưu tiên của chúng (Quy tắc 2 → Quy tắc 1 → cơ bản). Cài đặt mỗi quy tắc thành một hàm thuần `(picks, ctx) → { winners?, disqualified? }` được đăng ký trong một danh sách quy tắc có thứ tự, để thêm Quy tắc 3+ không cần thay đổi máy trạng thái.
- Chỉ lựa chọn của người chơi `ACTIVE` được đưa vào giá trị trung bình. Giá trị trung bình được tính **trước** khi lọc theo quy tắc.
- Quy tắc 1 so sánh lựa chọn sau khi làm tròn theo bước đã cấu hình (vì vậy `12.0` và `12` là trùng nhau); so sánh thập phân chính xác, không dùng epsilon số thực.
- Người chơi không gửi trong một vòng không có lựa chọn và nhận 0 điểm; họ bị loại khỏi giá trị trung bình (không tự động điền).
- Điểm mỗi vòng (có thể cấu hình): người thắng `10`; tùy chọn thưởng “suýt thắng” `3` cho người trong phạm vi 2 đơn vị so với mục tiêu; mặc định chỉ tính điểm người thắng. Điểm tích lũy quyết định bảng xếp hạng; người hòa điểm trên bảng cùng hạng.
- Lựa chọn được kiểm tra/giới hạn phía server trong `[min, max]` và làm tròn theo bước đã cấu hình. Dữ liệu không hợp lệ bị từ chối kèm thông báo, không bao giờ âm thầm thay đổi.
- Dùng số học thập phân chính xác (ví dụ làm việc với số nguyên được nhân theo tỷ lệ 10 hoặc 100) để kết quả xác định và việc phát hiện hòa đáng tin cậy.

### 3.3 Cài đặt trò chơi (người dẫn, khi tạo; một số có thể chỉnh giữa các vòng)
| Cài đặt | Mặc định | Ghi chú |
|---------|---------|-------|
| `p` (hệ số) | `0.8` | Preset: `0.8`, `2/3`, `1/2`, `4/3` (biến thể `>1` có động lực thú vị; cân bằng là 0 *hoặc* giá trị lớn nhất), tùy chỉnh |
| Miền giá trị | `0–100` | Số nguyên hoặc số thập phân (`step` 1, 0.1, 0.01) |
| Số vòng (Giai đoạn A) | `3` | 1–10; tùy chọn “không giới hạn cho đến khi người dẫn kết thúc”. Trò chơi ở Giai đoạn A cho đến khi điều kiện Nash hoặc giới hạn vòng xảy ra (sau đó người dẫn có thể kết thúc trò chơi hoặc buộc chuyển sang Giai đoạn B) |
| Điều kiện Nash | `tất cả người chơi đang hoạt động chọn giá trị nhỏ nhất của miền` | Người dẫn có thể tắt hoàn toàn Giai đoạn B |
| Danh sách quy tắc | `[1, 2]` | Kích hoạt theo thứ tự: Nash → Quy tắc 1, sau đó thêm một quy tắc sau mỗi lần loại |
| Hẹn giờ mỗi vòng | `60 s` | Cho phép `off` |
| Cho phép thay đổi lựa chọn cho đến khi khóa | bật | |
| Hiển thị tên khi công bố | tắt | |
| Điểm thắng / thưởng suýt thắng | `10` / `0` | |
| Số người chơi tối đa | `200` | |

### 3.4 Người chơi, danh tính, chống lạm dụng
- Không đăng nhập. Danh tính = (mã trò chơi, tên hiển thị) + một token người chơi ngẫu nhiên trong `localStorage`.
- Mỗi người chơi một lựa chọn mỗi vòng. Nếu cho phép thay đổi, việc gửi lại sẽ thay thế lựa chọn trước đó cho đến khi khóa.
- An toàn cơ bản không phụ thuộc danh sách từ tục: loại HTML, cắt khoảng trắng ở đầu/cuối, gộp khoảng trắng; chỉ render tên dưới dạng văn bản (không chèn HTML vào Portal).
- Giới hạn tần suất các endpoint tham gia và gửi lựa chọn theo IP và token.
- Trò chơi tự động hết hạn **24 giờ sau lần hoạt động cuối cùng**.

### 3.5 Phân tích tổng kết (màn hình chung cuộc và dashboard người dẫn)
Tính toán từ dữ liệu đã lưu:
- Histogram của tất cả lựa chọn theo từng vòng và gộp chung.
- Giá trị trung bình và mục tiêu theo từng vòng (biểu đồ xu hướng; cho thấy sự hội tụ về 0 nếu xảy ra).
- **Phân loại cấp độ-k** (mang tính thông tin): gom mỗi lựa chọn vòng đầu vào cấp độ gần nhất `Lk = 50·pᵏ` với `p` đã cấu hình. Với `p = 0.8` mặc định: `L0 = 50` (ngẫu nhiên/ngây thơ), `L1 = 40`, `L2 = 32`, `L3 = 25.6`, `L4 = 20.5`, `L5 = 16.4`, … giảm tới `≈ 0` (cân bằng). Tính các cấp độ từ `p`, tuyệt đối không hard-code. Hiển thị tỷ lệ của phòng ở mỗi cấp độ dưới dạng biểu đồ cột.
- Tỷ lệ người chơi chọn chính xác `0`, chính xác `50` và `> 100·p` (`> 80` với mặc định; bị trội nghiêm ngặt vì mục tiêu không bao giờ vượt quá `100·p` — hiển thị là “lựa chọn bị trội”).
- So sánh giá trị trung bình vòng đầu của phòng với các giá trị tham khảo (≈ 36 trong kết quả phòng thí nghiệm kiểu Nagel; ≈ 40 ở khán giả kinh doanh; ≈ 25–30 ở chuyên gia kinh tế — tất cả dành cho `p = 2/3`) dưới dạng chú thích nhỏ có nhãn “kết quả điển hình với p = 2/3”, chỉ hiển thị khi `p = 2/3`, không trình bày như các khẳng định chính xác.

### 3.6 Tính năng bổ sung của dashboard người dẫn
- Bảng người chơi trực tiếp cho biết đã gửi/chưa gửi theo từng vòng (người dẫn chỉ thấy lựa chọn sau khi khóa).
- Xuất: `results.csv` (player, round, pick, distance, points) và `game.json` (toàn bộ trạng thái).
- “Đặt lại trò chơi” đưa trò chơi về `LOBBY` nhưng giữ nguyên người chơi; “Kết thúc trò chơi” chuyển sang `FINISHED`.

---

## 4. Yêu cầu kỹ thuật

### 4.1 Công nghệ
- **Next.js (App Router) + TypeScript**, triển khai trên **Vercel**. Tailwind CSS để tạo kiểu. Biểu đồ dùng thư viện nhẹ (ví dụ Recharts hoặc visx) hoặc SVG tự viết — hiệu ứng công bố phải là SVG/CSS (ví dụ Framer Motion), không phải ảnh chụp canvas.
- **Kho trạng thái: Upstash Redis** qua Vercel Marketplace. Các Function là stateless nên cần kho dùng chung, kể cả khi dùng WebSocket. Vercel KV cũ không còn được cung cấp cho dự án mới. Duy trì một interface `Store` mỏng (`getGame`, `mutateGame`, …) để có thể thay backend (ví dụ Supabase) mà không chạm vào logic trò chơi.
- Logic trò chơi thuần (máy trạng thái, tính điểm, các bin cấp độ-k) nằm trong `src/lib/game/` và **không** import framework hay I/O để có thể kiểm thử đơn vị hoàn toàn.
- Node ≥ 20, `npm`.

### 4.2 Phương thức truyền tải thời gian thực
MVP dùng polling để đơn giản hóa vận hành. Vercel hiện hỗ trợ WebSocket ở Public Beta, nhưng mỗi kết nối vẫn bị giới hạn theo thời lượng Function và cần kho trạng thái chung. Vì vậy:
- Client (Portal, Host, Player) **poll** `GET /api/games/[code]/state?role=…&v=<version>` mỗi **1 giây** (Portal/Host) và **2 giây** (Player), kèm `ETag` / version để trạng thái không đổi trả về `304` với chi phí thấp. Thêm jitter ±200 ms để tránh bão request với 200 người chơi.
- Mỗi trò chơi có `version` tăng đơn điệu.
- Tạm dừng polling khi tab bị ẩn (chỉ player; **không bao giờ tạm dừng Portal**).
- Vai trò quyết định **projection** trạng thái mà server trả về (xem §4.4).
- Nếu có thời gian, có thể nâng cấp lên SSE nhưng polling phải vẫn là phương án dự phòng.

### 4.3 API (tất cả JSON, dưới `/api`)
| Phương thức & đường dẫn | Xác thực | Mục đích |
|---------------|------|---------|
| `POST /games` | không | Tạo trò chơi → `{ code, hostToken }` |
| `POST /games/[code]/join` | không | `{ name }` → `{ playerToken }` |
| `GET /games/[code]/state` | query role + token | Projection trạng thái theo vai trò |
| `POST /games/[code]/pick` | player token | `{ round, value }` |
| `POST /games/[code]/host/[action]` | host token | `open`, `lock`, `reveal`, `next`, `finish`, `reset`, `settings`, `kick` |
| `GET /games/[code]/export` | host token | CSV / JSON |

Portal chỉ cần mã trò chơi để truy cập (công khai, chỉ đọc và nhận projection an toàn cho khán giả).
- Kiểm tra mọi body bằng trình xác thực schema (ví dụ Zod). Trả về lỗi có cấu trúc `{ error: { code, message } }`.
- Đồng thời: dùng thao tác atomic của Redis hoặc optimistic versioning (`WATCH`/Lua) để các lượt gửi lựa chọn và chuyển trạng thái của người dẫn đồng thời không làm hỏng dữ liệu.

### 4.4 Projection dữ liệu (tối quan trọng về bảo mật)
| Vai trò | Nhận được |
|------|----------|
| Portal | Cài đặt trò chơi, trạng thái, tên người chơi, cờ đã gửi, số lượng; lựa chọn/tổng hợp **chỉ trong** `ROUND_REVEALED` và `FINISHED` |
| Player | Giống Portal và thêm lựa chọn của chính mình ở mọi thời điểm |
| Host | Mọi thứ, nhưng chỉ thấy lựa chọn của người chơi khác sau `ROUND_LOCKED` |

Test phải khẳng định response của Portal hoặc Player trong `ROUND_OPEN` không chứa giá trị lựa chọn của người chơi khác.

### 4.5 Yêu cầu phi chức năng
- 200 người chơi đồng thời, polling 1 giây ⇒ khoảng 200–250 request/giây ở đỉnh: response phải nhỏ (< 5 KB thông thường, gzip) và rẻ (một lần đọc Redis). Không cache qua CDN nhưng dùng `ETag` để trả `304`.
- Mobile-first cho UI Player (rộng ≥ 360 px, vùng chạm lớn, không phóng to khi focus ô nhập: cỡ chữ ≥ 16 px). Portal chỉ dành cho desktop, 16:9.
- Khả năng tiếp cận: tương phản đủ (WCAG AA), `aria-live` cho thay đổi trạng thái trên giao diện Player, không truyền tải thông tin chỉ bằng màu sắc trên Portal.
- i18n: mọi chuỗi UI nằm trong một dictionary; cung cấp **tiếng Việt (mặc định)** và **tiếng Anh**, có thể chuyển đổi trên trang host và theo từng player.
- Không phân tích dữ liệu, không tracker bên thứ ba, không dữ liệu cá nhân ngoài tên hiển thị do người dùng chọn.

---

## 5. Cấu trúc dự án đề xuất
```
.
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                 # Màn hình tham gia
│  │  ├─ play/[code]/page.tsx     # Player
│  │  ├─ host/page.tsx            # Tạo trò chơi
│  │  ├─ host/[code]/page.tsx     # Console người dẫn
│  │  ├─ portal/[code]/page.tsx   # Màn hình trình chiếu
│  │  └─ api/games/...            # Route handler (§4.3)
│  ├─ lib/
│  │  ├─ game/                    # Logic thuần: state machine, scoring, levelK
│  │  ├─ store/                   # Store interface + triển khai Upstash + in-memory (test/dev)
│  │  └─ i18n/
│  └─ components/                 # Histogram, Podium, Countdown, QR, Leaderboard, TrendChart …
├─ tests/                         # Test đơn vị + API bằng Vitest; Playwright cho toàn bộ luồng
├─ docs/decisions.md
└─ README.md
```

## 6. Môi trường và triển khai
```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_BASE_URL=        # dùng cho link tham gia và mã QR
```
- Môi trường dev cục bộ phải chạy được **không cần dịch vụ bên ngoài** bằng store trong bộ nhớ (`STORE=memory`).
- Triển khai: push lên GitHub, import repo vào Vercel, gắn tích hợp Upstash Redis, thiết lập biến môi trường. Không có secret lúc build ngoài các biến ở trên.
- Thêm các script `npm run dev`, `npm test`, `npm run lint`, `npm run build`.

## 7. Tiêu chí nghiệm thu
1. Người dẫn tạo trò chơi, một trình duyệt thứ hai (Portal) và ≥ 3 điện thoại mô phỏng tham gia; sảnh hiển thị tên trực tiếp trên Portal trong vòng 2 giây.
2. Một vòng hoàn chỉnh: mở → gửi lựa chọn → khóa → công bố tạo ra đúng giá trị trung bình, mục tiêu và người thắng, được kiểm chứng bằng test đơn vị bao gồm hòa, không gửi, `p = 0.8` (mặc định), `p = 2/3`, `p = 1/2`, `p = 4/3`, các bước thập phân.
   - Leo thang: điều kiện Nash chỉ kích hoạt khi mọi người chơi đang hoạt động chọn giá trị nhỏ nhất; Quy tắc 1 (trùng lặp thua, bao gồm trùng ba người, lựa chọn trùng vẫn tính vào trung bình); Quy tắc 2 (`0` + một `100` → `100` thắng; `0` + hai `100` khi Quy tắc 1 hoạt động → quay về cách tính); độ ưu tiên Quy tắc 2 → Quy tắc 1 → cơ bản; chính xác một lần loại mỗi vòng Giai đoạn B và không bao giờ loại người thắng; các nhóm loại (không gửi, sau đó trùng lặp, sau đó khoảng cách lớn nhất) và tie-break có seed; trò chơi kết thúc khi còn một người chơi đang hoạt động; người chơi bị loại không thể gửi.
3. Trong `ROUND_OPEN`, kiểm tra mạng của response từ Portal và các Player khác không cho thấy giá trị lựa chọn nào (test tự động).
4. Đóng và mở lại tab Player hoặc Host khôi phục phiên; Portal vẫn hoạt động sau 30 giây offline và đồng bộ lại.
5. 200 người chơi mô phỏng (script trong `tests/load/`) hoàn thành một vòng với độ trễ polling trạng thái p95 < 500 ms.
6. Màn hình chung cuộc hiển thị bảng xếp hạng, biểu đồ hội tụ và phần tổng kết cấp độ-k.
7. `npm run build` chạy thành công và ứng dụng chạy trên Vercel với Upstash; `STORE=memory npm run dev` chạy offline.

## 8. Ngoài phạm vi (v1)
Tài khoản và hồ sơ cố định, thanh toán, nhiều người dẫn/đồng dẫn, video/thoại, dashboard kiểm duyệt, ứng dụng native, lịch sử trò chơi dài hạn ngoài thời hạn 24 giờ.

## 9. Có thể bổ sung (v2)
Hiệu ứng âm thanh khi công bố; chế độ đội; câu hỏi phụ “dự đoán giá trị trung bình”; phát lại trò chơi đã kết thúc; các biến thể trò chơi đoán khác (ví dụ “chọn phương án phổ biến nhất” nguyên bản của Keynes với các đáp án trắc nghiệm).
