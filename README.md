# Phụ đề họp

App desktop mã nguồn mở hiện **phụ đề dịch realtime** cho cuộc họp: nghe tiếng Anh (hoặc Nhật, Hàn, Trung…), hiện tiếng Việt ngay trên màn hình. Chạy trên Windows, macOS và Linux.

Không có server trung gian: bạn dùng key Google Cloud của chính mình, app gọi thẳng Google, và bạn chỉ trả đúng phần mình dùng.

> **Lưu ý cho người fork/phát hành:** thay `your-org` trong `package.json`, `README.md`, `docs/` và `src/renderer/index.html` bằng tài khoản/tổ chức GitHub của bạn.

## Tính năng

- Nghe **âm thanh máy tính** (Zoom, Meet, Teams, YouTube…), **micro**, hoặc **cả hai** cùng lúc.
- Nhận dạng giọng nói bằng Google Cloud Speech-to-Text (streaming) hoặc [whisper.cpp chạy trên máy](docs/whisper.md) (miễn phí), dịch bằng Google Cloud Translation.
- Hiện chữ gốc ngay khi người nói đang nói; tuỳ chọn **dịch tạm** trước khi hết câu.
- **Phụ đề nổi**: cửa sổ trong suốt luôn nằm trên cùng, kể cả khi app họp đang toàn màn hình; kéo thả, đổi cỡ chữ, ẩn/hiện câu gốc.
- **Biên bản song ngữ** có giờ: sao chép, lưu `.txt` hoặc `.srt`.
- Hiện số phút đã dùng và **chi phí ước tính**.
- Key được **mã hoá** bằng kho khoá của hệ điều hành (Keychain / DPAPI / libsecret); giao diện không bao giờ đọc được key thật.
- Giao diện sáng/tối theo hệ thống, co giãn tới bề rộng 420 px.

## Cài đặt

Tải bản mới nhất ở trang [Releases](https://github.com/your-org/phu-de-hop/releases).

Bản phát hành mặc định **chưa ký số**, nên hệ điều hành sẽ cảnh báo lần đầu mở.

### Windows

1. Tải `phu-de-hop-<phiên bản>-win-x64.exe` (hoặc `arm64` cho máy ARM).
2. Chạy file. Nếu hiện **"Windows protected your PC"** (SmartScreen): bấm **More info** → **Run anyway**.

### macOS

1. Tải file `.dmg`: `arm64` cho chip Apple (M1 trở lên), `x64` cho máy Intel.
2. Mở dmg, kéo **Phu de hop** vào **Applications**.
3. Lần đầu mở, Gatekeeper sẽ chặn. Cách vượt:
   - Chuột phải vào app → **Open** → **Open**; hoặc
   - System Settings → **Privacy & Security** → kéo xuống, bấm **Open Anyway**.
   - Nếu báo "app is damaged", chạy trong Terminal: `xattr -cr "/Applications/Phu de hop.app"`

### Linux

- **AppImage**: `chmod +x phu-de-hop-*.AppImage && ./phu-de-hop-*.AppImage`
- **Debian/Ubuntu**: `sudo apt install ./phu-de-hop-*.deb`

Để key được mã hoá trên Linux, cần có `gnome-keyring` hoặc `kwallet` (đa số môi trường desktop đã có sẵn). Nếu không, app vẫn chạy nhưng sẽ cảnh báo key chưa được mã hoá.

## Bắt đầu nhanh

1. Lấy key Google Cloud theo hướng dẫn: [docs/lay-key-google.md](docs/lay-key-google.md).
2. Mở app → hộp **Cài đặt** tự hiện → dán API key vào ô **API key** (lưu ngay, không cần bấm nút).
3. Cũng trong **Cài đặt**, mục **Âm thanh và ngôn ngữ**: chọn **Nguồn âm thanh**, **Người nói** (ví dụ Tiếng Anh (Mỹ)) và **Dịch sang** (Tiếng Việt), rồi bấm **Xong**.
4. Bấm **Bắt đầu**. Muốn phụ đề nổi trên app họp, bấm **Phụ đề nổi**.
5. Họp xong: **Dừng**, rồi **Lưu .txt** / **Lưu .srt** nếu cần.

## Lấy âm thanh máy tính theo hệ điều hành

| Hệ điều hành | Cách làm |
|---|---|
| **Windows 10/11** | Chạy ngay, chọn nguồn "Âm thanh máy tính". |
| **macOS 13 trở lên** | Chọn "Âm thanh máy tính". Khi phát triển, chạy bằng `npm run start:mac` thay vì `npm start` (quyền sẽ mang tên "Electron"). Lần đầu, cấp quyền tại System Settings → Privacy & Security → **Screen & System Audio Recording** → bật "Phu de hop", rồi thoát và mở lại app. App không lưu hình ảnh màn hình. |
| **macOS 12 trở xuống** | Cài [BlackHole](https://github.com/ExistentialAudio/BlackHole). Trong **Audio MIDI Setup** tạo **Multi-Output Device** gồm loa của bạn + BlackHole, đặt nó làm đầu ra. Trong app chọn nguồn "Micro / thiết bị thu" và thiết bị "BlackHole". |
| **Linux (PulseAudio/PipeWire)** | Chọn nguồn "Micro / thiết bị thu", thiết bị **"Monitor of …"** của loa đang dùng. |

Nếu "Âm thanh máy tính" không có tiếng trên Windows, có thể bật **Stereo Mix** (Sound Settings → Recording) hoặc cài **VB-Cable**, rồi chọn nó như một micro.

## Chi phí

App không thu phí. Google tính vào project của bạn:

- Speech-to-Text: khoảng **$0,016/phút** (miễn phí 60 phút/tháng).
- Translation: **$20/1 triệu ký tự** (miễn phí 500.000 ký tự/tháng).

Một cuộc họp 1 giờ thường tốn khoảng $1–2. Chi phí ước tính hiện ở thanh trên của app (đơn giá chỉnh được trong Cài đặt). Nên đặt **Budget** cảnh báo, xem [hướng dẫn](docs/lay-key-google.md#5-đặt-cảnh-báo-chi-phí-budget).

## Quyền riêng tư

- Âm thanh chỉ được gửi tới Google Speech-to-Text; chữ nhận dạng được gửi tới Google Translation. Không có server nào khác.
- App không ghi âm, không lưu âm thanh. Biên bản chỉ nằm trong bộ nhớ cho tới khi bạn tự lưu.
- Key lưu trong `settings.json` ở thư mục dữ liệu của app (quyền 0600), được mã hoá bằng `safeStorage` của Electron. Giao diện chỉ nhận bản tóm tắt (ví dụ "API key …x7Qk").
- Hình ảnh màn hình (bắt buộc phải xin khi thu âm thanh hệ thống) được tắt ngay và không bao giờ gửi đi.
- Chính sách dữ liệu của Google: <https://cloud.google.com/speech-to-text/docs/data-logging>.

## Phát triển

Yêu cầu Node.js 20 trở lên.

```bash
git clone https://github.com/your-org/phu-de-hop.git
cd phu-de-hop
npm install
npm start          # chạy app
npm run start:mac  # macOS: chạy app như app riêng để xin được quyền thu âm thanh máy tính
npm test           # chạy test (node:test)
npm run dist       # đóng gói cho hệ điều hành hiện tại
npm run dist:win   # hoặc dist:mac, dist:linux
```

Cấu trúc:

```
src/main/       main process: main.js (cửa sổ, IPC), stt.js (phiên streaming),
                google.js (client Google, dịch lỗi), settings.js (lưu key mã hoá),
                transcript.js (xuất TXT/SRT)
src/preload/    preload.js — cầu nối contextBridge duy nhất
src/renderer/   giao diện HTML/CSS/JS thuần, audio.js + pcm-worklet.js lấy âm thanh
test/           test cho stt, whisper, transcript, google, settings
```

Phát hành: đẩy tag `v*` (ví dụ `git tag v0.1.0 && git push --tags`), GitHub Actions sẽ chạy test rồi build cho cả 3 hệ điều hành và đưa lên Releases. Cách thêm chứng chỉ ký số: xem chú thích trong `.github/workflows/release.yml`.

### Luồng xử lý

```
 Âm thanh máy tính ─┐
 (getDisplayMedia)  ├─► AudioContext 16 kHz ─► pcm-worklet: Float32 → Int16,
 Micro ─────────────┘   (trộn nếu "Cả hai")    gói 100 ms + mức RMS
 (getUserMedia)                                        │ ipcRenderer.send
                                                       ▼
                        main: SttSession ── gRPC streamingRecognize ──► Google Speech-to-Text
                          │  (tự mở luồng mới sau 4,5 phút, kết nối lại khi lỗi 4/11/14)
                          │ câu tạm / câu chốt
                          ▼
                        Translator (cache) ── HTTPS ──► Google Translation
                          │
                          ▼ broadcast
               Cửa sổ chính (phụ đề + biên bản)   Phụ đề nổi
```

## Đóng góp

Mọi đóng góp đều hoan nghênh:

1. Fork repo, tạo nhánh mới.
2. Giữ phong cách hiện có: JavaScript thuần, không framework UI, chữ trên giao diện bằng tiếng Việt.
3. Chạy `npm test` trước khi mở Pull Request; thêm test nếu sửa logic trong `src/main`.
4. **Không bao giờ commit key hay file JSON service account.**

Báo lỗi hoặc đề xuất tính năng ở mục [Issues](https://github.com/your-org/phu-de-hop/issues).

## Giấy phép

[MIT](LICENSE)
