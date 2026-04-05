# Auto Darkwar v2.0

Chrome thật với **DevTools Guaranteed** 🛠️

## 🚀 Quick Start

### ✅ Cách 1: DevTools Tự Động (Khuyên dùng)

```bash
cd /Volumes/data/Server/auto-darkwark
node scripts/auto.js
```

**Chuyện gì xảy ra:**
1. Kill Chrome cũ
2. Launch Chrome mới
3. **DevTools tự động mở** (`devtools: true`)
4. Navigate: Google → Darkwar
5. Ready!

### 🔌 Cách 2: Connect Chrome Đang Chạy

```bash
# Mở Chrome trước
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="./chrome-data"

# Rồi chạy
node scripts/auto.js connect
```

⚠️ **DevTools KHÔNG tự động mở** với connect mode

## 📊 So sánh 2 mode

| Tính năng | `auto.js` (Launch) | `auto.js connect` |
|-----------|-------------------|-------------------|
| DevTools tự động | ✅ **Có** | ❌ Không |
| Session lưu | ✅ Có | ✅ Có |
| Dùng Chrome đang mở | ❌ Không | ✅ Có |

## 🎯 Cách dùng DevTools

### Dock sang phải:
1. DevTools mở (có thể ở dưới)
2. **Kéo** DevTools từ dưới sang phải, **HOẶC**
3. Nhấn **F12** hai lần để toggle dock

### Kiểm tra:
- Mở tab **Console**
- Gõ: `DarkwarHelper`
- Gõ: `DarkwarHelper.getStatus()`

## 📁 Cấu trúc

```
auto-darkwark/
├── scripts/
│   └── auto.js           # ⭐ Script chính
├── chrome-data/          # Session Chrome
└── README.md
```

## 🛠️ Commands

| Command | Mô tả |
|---------|-------|
| `node auto.js` | Launch Chrome + **DevTools tự động** ✅ |
| `node auto.js connect` | Connect Chrome đang chạy |

## 💡 Tips

1. **Lần đầu:** Dùng `node auto.js` để DevTools tự mở
2. **DevTools dock:** Kéo sang phải hoặc F12 x2
3. **Session:** Tự động lưu trong `chrome-data/`
4. **Helper:** Gõ `DarkwarHelper` trong Console

## 🚨 Troubleshooting

**Lỗi:** `The browser is already running`
```bash
pkill -9 "Google Chrome"
# Rồi chạy lại
node auto.js
```

**DevTools không hiện:**
- Đảm bảo dùng `node auto.js` (không có `connect`)
- Flag `devtools: true` chỉ hoạt động với `launch()`
