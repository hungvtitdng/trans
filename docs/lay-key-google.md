# Lấy key Google Cloud cho "Phụ đề họp"

App không có server trung gian: mọi yêu cầu đi thẳng từ máy bạn tới Google bằng key của chính bạn, và Google tính phí vào project của bạn. Làm một lần, mất khoảng 10 phút.

## 1. Tạo project

1. Vào <https://console.cloud.google.com/> và đăng nhập.
2. Ở thanh trên cùng, bấm chọn project → **New Project**.
3. Đặt tên (ví dụ `phu-de-hop`) → **Create**. Nhớ chọn project vừa tạo trước khi làm các bước sau.

## 2. Gắn thanh toán (Billing)

Speech-to-Text và Translation yêu cầu project có tài khoản thanh toán, kể cả khi bạn chỉ dùng trong hạn mức miễn phí.

1. Mở <https://console.cloud.google.com/billing>.
2. Tạo hoặc chọn một billing account, rồi **Link** nó với project.

## 3. Bật 2 API

Mở từng link, chọn đúng project, bấm **Enable**:

- Cloud Speech-to-Text API: <https://console.cloud.google.com/apis/library/speech.googleapis.com>
- Cloud Translation API: <https://console.cloud.google.com/apis/library/translate.googleapis.com>

## 4. Tạo API key

1. Mở <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials** → **API key**. Sao chép key vừa tạo.
3. Bấm vào key → **API restrictions** → **Restrict key** → chỉ tích:
   - Cloud Speech-to-Text API
   - Cloud Translation API
4. **Application restrictions** để **None** (app desktop không có website hay IP cố định; đặt giới hạn theo website/IP sẽ khiến key bị chặn).
5. **Save**.
6. Trong app: **Cài đặt** → dán key vào ô **API key**. Key được lưu ngay; muốn xoá, rê chuột vào ô và bấm **×**.

> Giới hạn key chỉ cho 2 API giúp giảm thiệt hại nếu key bị lộ: người khác không dùng được key đó cho các dịch vụ đắt tiền khác.

## 5. Đặt cảnh báo chi phí (Budget)

1. Mở <https://console.cloud.google.com/billing/budgets> → **Create budget**.
2. Chọn project, đặt số tiền (ví dụ 5 USD/tháng).
3. Để các ngưỡng cảnh báo 50%, 90%, 100% → Google gửi email khi chạm ngưỡng.

Budget **chỉ cảnh báo**, không tự dừng dịch vụ. Muốn chặn cứng, dùng quota ở bước sau.

## 6. Giới hạn quota (chặn cứng)

1. Mở <https://console.cloud.google.com/iam-admin/quotas>.
2. Lọc theo dịch vụ **Cloud Speech-to-Text API** hoặc **Cloud Translation API**.
3. Chọn quota (ví dụ số request mỗi phút, hoặc "Characters per day" của Translation) → **Edit quota** → đặt mức thấp hơn.

Khi chạm quota, app sẽ báo "Đã vượt hạn mức (quota) của Google".

## Bảng giá tham khảo

| Dịch vụ | Giá | Miễn phí |
|---|---|---|
| Speech-to-Text v1 (có data logging) | $0,016 / phút | 60 phút / tháng |
| Speech-to-Text v1 (không data logging) | $0,024 / phút | 60 phút / tháng |
| Translation (Basic, v2) | $20 / 1 triệu ký tự | 500.000 ký tự / tháng |

Ví dụ: một cuộc họp 60 phút ≈ 60 × $0,016 ≈ $0,96 cho nhận dạng, cộng khoảng 40–60 nghìn ký tự dịch ≈ $1 (bật "dịch tạm" sẽ tốn thêm ký tự). App hiện ước tính chi phí ở thanh trên; đơn giá chỉnh được trong Cài đặt.

Giá có thể thay đổi, hãy xem bảng giá chính thức:

- <https://cloud.google.com/speech-to-text/pricing>
- <https://cloud.google.com/translate/pricing>

## Gặp lỗi khi bấm "Bắt đầu"?

| Thông báo | Cách xử lý |
|---|---|
| Key không hợp lệ | Sao chép lại key, kiểm tra không thiếu ký tự. |
| API chưa được bật | Làm lại bước 3, đúng project chứa key. |
| Chưa gắn thanh toán | Làm lại bước 2. |
| Key đang bị giới hạn | Trong API restrictions tích đủ 2 API; Application restrictions để None. |
| Không kết nối được tới Google | Kiểm tra mạng, VPN, proxy, tường lửa công ty. |
