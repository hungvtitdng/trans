# Nhận dạng giọng nói trên máy bằng whisper.cpp

Thay Google Speech-to-Text bằng [whisper.cpp](https://github.com/ggml-org/whisper.cpp) chạy trên máy: không tốn phí, âm thanh không rời khỏi máy. Phần dịch vẫn dùng Google Translation (miễn phí 500.000 ký tự/tháng), nên vẫn cần key Google — chỉ cần bật **Cloud Translation API**.

## 1. Cài whisper.cpp

macOS:

```sh
brew install whisper-cpp
```

Windows/Linux: tải bản build ở [Releases](https://github.com/ggml-org/whisper.cpp/releases) hoặc tự build theo README của whisper.cpp.

## 2. Tải model

Tải một file model từ <https://huggingface.co/ggerganov/whisper.cpp/tree/main>:

| File | Dung lượng | Khi nào dùng |
|---|---|---|
| `ggml-large-v3-turbo-q5_0.bin` | ~550 MB | Mac M1 trở lên, 16 GB RAM (khuyên dùng) |
| `ggml-small.bin` | ~470 MB | Máy yếu hoặc 8 GB RAM |

## 3. Chọn trong app

1. **Cài đặt** → **Nhận dạng giọng nói bằng** → **whisper.cpp trên máy**.
2. Bấm **Chọn file model…** và chọn file `.bin` vừa tải.

App tự chạy `whisper-server` mỗi khi mở và tắt nó khi thoát. Dòng trạng thái dưới nút cho biết server đã chạy hay gặp lỗi. Server cần vài giây để nạp model, nên chờ một chút rồi mới bấm **Bắt đầu**.

Muốn dùng server chạy trên máy khác, nhập địa chỉ của nó (ví dụ `http://192.168.1.10:8080`) vào ô **Địa chỉ whisper-server**; khi đó app không tự chạy server. Trên máy kia chạy:

```sh
whisper-server -m ~/Downloads/ggml-large-v3-turbo-q5_0.bin --host 0.0.0.0 --port 8080
```

## Khác biệt so với Google

- Whisper không streaming: phụ đề hiện **sau khi người nói ngừng** (~0,7 giây), câu dài bị cắt mỗi 12 giây. Không có chữ tạm khi đang nói.
- App phát hiện câu bằng độ to của âm thanh; nhạc nền to có thể làm câu bị gộp.
- Số phút trên thanh chi phí chỉ tính phần Google; Whisper không tính phí.
