# Hướng Dẫn Chạy Script Chuẩn Hóa Dữ Liệu Sản Xuất (Production Migration)

Tài liệu này hướng dẫn cách sử dụng và chạy an toàn script migration tại `scripts/migrate-production-data.mjs` nhằm chuẩn hóa dữ liệu cũ của dự án Firestore `anh-xe-thd` để tương thích hoàn toàn với cấu trúc quản lý bộ phận mới của **Ảnh Xe THD**.

---

## 🔒 Cơ Chế Bảo Vệ An Toàn

Để ngăn chặn tuyệt đối các sai sót ngoài ý muốn khi thao tác trên dữ liệu sản xuất thật, script đã được lập trình ba lớp bảo vệ nghiêm ngặt:

1. **Mặc định là Thử nghiệm (Dry-Run)**: Script luôn chạy ở chế độ **Rà soát & Thống kê** mà không ghi dữ liệu trừ khi truyền tham số `--apply`.
2. **Khóa Project ID**: Script chỉ chấp nhận kết nối chính xác và thực hiện cập nhật nếu Project ID của Firebase Admin SDK là `anh-xe-thd`. Bất kể project thử nghiệm hay project khác đều sẽ bị dừng khẩn cấp ngay bước khởi tạo.
3. **Mã Xác Nhận Môi Trường**: Để chạy chế độ `--apply` thành công, bạn bắt buộc phải thiết lập thêm biến môi trường đầu vào `CONFIRM_PRODUCTION_MIGRATION=YES`.
4. **Không Tạo Ảnh Hưởng Khác**: Script tuyệt đối không can thiệp vào:
   - Các trường thông tin cốt lõi: RO, biển số xe, ngày tạo, ghi chú, searchKeywords, link ảnh,...
   - Không can thiệp hoặc thay đổi các tệp tin lưu trữ vật lý trên Firebase Storage.
   - Không cấu hình, sửa đổi hay tạo mới tài khoản trên Firebase Authentication.
   - Không deploy Rules, Cloud Functions hay Hosting.

---

## 📋 1. Chuẩn Bị Trước Khi Chạy

Bạn cần cài đặt các thư viện cần thiết trước khi chạy script. Chạy dòng lệnh sau trong Terminal của dự án:

```bash
npm install firebase-admin
```

Script sẽ sử dụng cấu hình mặc định Google Application Default Credentials (ADC). Không yêu cầu tệp `service-account.json` cục bộ.

---

## 🚀 2. Cách Thực Thi Trên Windows PowerShell

### Chế Độ Rà Soát & Thử Nghiệm (Dry-Run Mode)

Đây là chế độ an toàn hoàn toàn, chỉ đọc hoặc tải thông tin thống kê xem có bao nhiêu bản ghi sẽ được cập nhật/chuẩn hóa. Các bước lệnh thực hiện trên Windows PowerShell:

```powershell
$env:FIREBASE_PROJECT_ID="anh-xe-thd"
node scripts/migrate-production-data.mjs --dry-run
```

---

### Chế Độ Cập Nhật Ghi Thật (Apply Mode)

Khi đã rà soát và xác thực tất cả thống kê chuẩn chỉnh trên màn hình Dry-Run, chạy khối lệnh sau trên Windows PowerShell để đồng bộ trực tiếp lên hệ thống:

```powershell
# 1. Kích hoạt môi trường xác nhận an toàn và thiết lập dự án
$env:FIREBASE_PROJECT_ID="anh-xe-thd"
$env:CONFIRM_PRODUCTION_MIGRATION="YES"

# 2. Khởi chạy script cập nhật
node scripts/migrate-production-data.mjs --apply
```

---

## 🛠️ 3. Thao Tác Chạy Trên Linux / macOS (Nếu Sử Dụng)

Dành cho các quản trị viên chạy môi trường terminal Bash / zsh:

### Chạy Dry-Run:
```bash
FIREBASE_PROJECT_ID="anh-xe-thd" node scripts/migrate-production-data.mjs --dry-run
```

### Chạy Apply Thật:
```bash
FIREBASE_PROJECT_ID="anh-xe-thd" CONFIRM_PRODUCTION_MIGRATION=YES node scripts/migrate-production-data.mjs --apply
```

---

## ⚡ 4. Các Quy Chuẩn Mà Script Thực Hiện

1. **Chuẩn hóa collection `cars`**:
   - Nếu chiếc xe chưa được chỉ định bộ phận nào (không có `departmentId` lẫn `department`), script sẽ tự động gán bộ phận `service` (Dịch vụ) mặc định.
   - Nếu đang mang nhãn bộ phận `"insurance"` (Bảo hiểm - Tiếng Anh), script đổi sang `"baohiem"` và dọn dẹp biến thừa `department` cũ cho gọn sạch.
   - Các trường thông tin về ảnh xe, biển số, RO, ngày giờ giữ nguyên 100%.

2. **Chuẩn hóa bộ phận `departments`**:
   - Đảm bảo thiết lập hoặc cập nhật 3 bộ phận chuẩn chỉnh sau (Bằng cơ chế merge): 
     * `departments/service` ("Dịch vụ")
     * `departments/baohiem` ("Bảo hiểm")
     * `departments/phukien` ("Phụ kiện")
   - Chỉ in cảnh báo báo cáo nếu phát hiện bộ phận cũ `departments/insurance` còn sót, không tự động xóa để đảo bảo an toàn.

3. **Chuẩn hóa tài khoản `users`**:
   - Bỏ qua các tài khoản chờ phê duyệt có ID bắt đầu với `pre-auth-`.
   - Với những ai là tài khoản Admin (`role = "admin"`):
     * Đồng bộ `uid` bằng chính document ID của tài khoản đó nếu thiếu.
     * Đồng bộ `departmentId = "admin"` nếu thiếu.
     * Tự động thêm `isActive = true` và `canDeleteSession = true` nếu các trường này chưa tồn tại.
     * Không chỉnh sửa trường active (hoặc isActive) cũ đã thiết lập sẵn.
   - Đối với tài khoản nhân viên thường:
     * Tuyệt đối không tự động gán bừa bãi bộ phận; chỉ chi tiết danh sách UID/Email của nhân viên thường còn bị thiếu bộ phận để Admin rà soát thủ công sạch sẽ nhất.
