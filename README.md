# Bot đăng ký học phần UIT

## Dependencies

- Node v20 hoặc hơn

## Bắt đầu

1. Tạo file config

```sh
cp example.dkhp.config.json dkhp.config.json
```

2. Chỉnh sửa nội dung file config

```jsonc
{
  "username": "23520000", // MSSV
  "password": "your extremely secure password", // MK
  "classes": [
    // Mã lớp cần đăng ký
    "SE347.P12",
    "SE347.P12.1",
    "SS006.P18",
    "SS008.P12",
    "or other any class code",
  ],
  "loginTries": 10, // Số lần tự động đăng nhập lại nếu đăng nhập thất bại
  "retryDelay": 3000, // Thời gian cách nhau giữa những lần f5 :)

  "timer": false, // Tính năng tự động hẹn giờ bắt đầu
  // Nếu tự động hẹn giờ bắt đầu được bật thì vào đúng thời gian này bot sẽ bắt đầu chạy
  "startTime": "2024-01-01T00:00:00Z" // 01/01/2024 lúc 00:00:00 (ISO 8601)
}
```

3. Cài đặt các dependencies

Lần lượt chạy các lệnh sau:

```sh
npm install
npx playwright install
```

4. Bắt đầu chạy

```sh
npm run run
```

## Tính năng

- [x] Tự động bắt đầu khi đúng thời gian
- [ ] Tự động exit khi thành công
