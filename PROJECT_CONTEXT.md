# PROJECT_CONTEXT.md — Ảnh Xe THD

## 0. BẮT BUỘC ĐỌC TRƯỚC KHI SỬA

Trước khi sửa bất kỳ file nào, hãy đọc kỹ file `PROJECT_CONTEXT.md` này và tuân thủ toàn bộ nguyên tắc trong đó. Không sửa lan man ngoài phạm vi yêu cầu. Nếu yêu cầu chưa rõ, hãy hỏi lại trước khi sửa.

Mỗi lần thực hiện task, cần bắt đầu bằng cách xác định:

* Task đang sửa phần nào.
* File nào có khả năng bị ảnh hưởng.
* Có đụng đến Firebase Hosting, Firestore, Storage, Cloud Functions hay không.
* Có rủi ro ảnh hưởng dữ liệu production hay không.

Không tự ý deploy Firebase. Chỉ báo cáo kết quả sửa và build, trừ khi người dùng yêu cầu deploy rõ ràng.

---

## 1. Thông tin project

Tên project: **Ảnh Xe THD**

Domain production:

```text
https://anhxedv.toyotahadong.com.vn
```

Firebase project production:

```text
projectId: anh-xe-thd
authDomain: anh-xe-thd.firebaseapp.com
storageBucket: anh-xe-thd.firebasestorage.app
functions region: asia-southeast1
```

GitHub repository:

```text
catkeylife-dev/-catkeylife-dev-toyota-photo-gallery
```

Lưu ý: tên repository có dấu `-` ở đầu:

```text
-catkeylife-dev-toyota-photo-gallery
```

Không tự ý đổi thành repo khác.


```text

```

---

## 2. Mục tiêu vận hành của app

App dùng cho Toyota Hà Đông để chụp, lưu trữ, tra cứu và chia sẻ ảnh xe dịch vụ.

Các nghiệp vụ chính:

* Tạo phiên chụp ảnh xe theo biển số.
* Lưu ảnh lên Firebase Storage.
* Lưu thông tin phiên vào Firestore.
* Tìm kiếm theo biển số, lệnh RO, ghi chú.
* Xem xe hôm nay.
* Chia sẻ ảnh qua Zalo/iOS/Android.
* Tải ảnh về máy.
* Phân quyền theo tài khoản/bộ phận.
* Nhận diện biển số tự động bằng Gemini qua Cloud Function.
* Chụp & tải ngay để nhân viên thao tác nhanh.

---

## 3. Nguyên tắc sửa code

### 3.1. Không sửa lan man

Chỉ sửa đúng phạm vi người dùng yêu cầu.

Không refactor lớn nếu không được yêu cầu.

Không thay đổi UI/UX ở khu vực khác chỉ vì tiện tay.

Không thay đổi schema dữ liệu nếu không cần thiết.

Không đổi tên collection, field hoặc storage path khi chưa có lý do rõ ràng.

### 3.2. Không làm mất dữ liệu production

Tuyệt đối không:

* Xóa collection.
* Xóa ảnh Storage.
* Ghi đè ảnh gốc.
* Sửa hàng loạt document.
* Reset database.
* Thay đổi Firebase project.
* Thay đổi Rules nếu không được yêu cầu.

### 3.3. Không tự ý sửa Firebase config

Không tự ý sửa:

* `src/lib/firebase.ts`
* `.firebaserc`
* `firebase.json`
* Firestore Rules
* Storage Rules
* Cloud Functions config

Chỉ sửa khi task yêu cầu rõ ràng.

### 3.4. Không tự ý deploy

Sau khi sửa, chỉ cần:

* báo file đã sửa,
* báo logic đã thay đổi,
* chạy build,
* báo kết quả build.

Chỉ deploy khi người dùng nói rõ: “deploy”, “đưa lên bản chính thức”, hoặc tương đương.

Mặc định khi deploy frontend, chỉ dùng:

```powershell
firebase.cmd deploy --only hosting --project anh-xe-thd
```

Không deploy toàn bộ Firebase.

Không deploy Functions nếu task không yêu cầu rõ ràng.

---

## 4. Công nghệ chính

Frontend:

* React
* TypeScript
* Vite
* Firebase Web SDK
* Tailwind / CSS utility
* lucide-react
* browser-image-compression
* date-fns

Backend/Firebase:

* Firebase Hosting
* Firebase Authentication
* Firestore
* Firebase Storage
* Firebase Cloud Functions
* Gemini API qua Cloud Function

---

## 5. Các chức năng quan trọng hiện có

### 5.1. Tạo phiên chụp mới

Người dùng nhập:

* Biển số xe
* Lệnh RO nếu có
* Bộ phận / loại phiên
* Ghi chú
* Ảnh

Ảnh được upload lên Storage, metadata phiên được lưu vào Firestore.

### 5.2. Chụp bằng camera thường

Luồng chụp thường cho phép chụp ảnh và tạo phiên sau khi đủ thông tin.

Có nhận diện biển số tự động.

### 5.3. Chọn ảnh

Người dùng chọn ảnh từ thư viện máy.

Có nhận diện biển số tự động.

### 5.4. Chụp & tải ngay

Đây là luồng rất nhạy cảm.

Mục tiêu:

* Mở camera nhanh.
* Nếu đã có biển số thì dùng biển số đã nhập.
* Nếu chưa có biển số thì vẫn cho chụp.
* Ảnh đầu tiên có thể gửi nhận diện biển số.
* Không được để form nhập biển số che màn hình camera ngay khi mới vào.
* Không cho bấm “Xong” quá sớm nếu ảnh chưa upload xong hoặc chưa đủ điều kiện hoàn tất.
* Nếu lỗi, không được làm trắng màn hình.

Các điểm đã xử lý:

* Không tự hiện popup lớn “Nhập biển số để tiếp tục tải ngay” khi `Đã chụp: 0 ảnh`.
* Chỉ mở form nhập biển số khi người dùng bấm “Nhập biển số” hoặc bấm “Xong” khi chưa có biển số.
* Có `client_error_logs` để ghi lỗi frontend liên quan đến luồng này.
* Cần bảo vệ các biến `null/undefined` trong luồng hoàn tất phiên.

Khi sửa `Chụp & tải ngay`, ưu tiên sửa trong:

```text
src/components/PhotoCapture.tsx
```

Không sửa các phần khác nếu không cần.

---

## 6. Nhận diện biển số bằng AI

Nhận diện biển số không gọi trực tiếp từ frontend bằng API key.

Frontend gọi Firebase Callable Function:

```text
recognizeVehiclePlate
```

Cloud Function chạy ở region:

```text
asia-southeast1
```

Model hiện đang dùng theo cấu hình backend, trước đây đã chọn hướng tiết kiệm:

```text
gemini-3.1-flash-lite
```

Không đưa Gemini API key vào frontend.

Không hard-code API key trong source.

Không tự ý đổi model nếu không được yêu cầu.

Nếu cần đổi model, nên đổi qua file cấu hình riêng ở backend, không rải model name nhiều nơi.

---

## 7. Chia sẻ ảnh qua iOS/Zalo

Đã từng có lỗi khi chia sẻ nhiều ảnh trên iOS/Zalo nếu dùng payload:

```ts
navigator.share({
  files,
  title,
  text
})
```

Do đó khi chia sẻ file, ưu tiên chỉ truyền:

```ts
await navigator.share({ files: preparedFiles });
```

Không tự ý thêm `title`, `text`, `url` vào share payload nếu không test kỹ, vì Zalo/iOS có thể lỗi.

Nếu cần đưa thông tin vào ảnh, hãy chèn trực tiếp lên ảnh bằng canvas, không gửi kèm text ngoài.

---

## 8. Chèn thời gian và địa chỉ lên ảnh khi chia sẻ

Yêu cầu hiện tại:

* Có checkbox khi chia sẻ:

  * `Thêm thời gian & địa chỉ lên ảnh`
* Nếu tích checkbox:

  * Tạo bản ảnh tạm bằng canvas.
  * Chèn thời gian phiên chụp và địa chỉ lên ảnh.
  * Dùng ảnh tạm để chia sẻ.
* Nếu không tích:

  * Chia sẻ ảnh gốc như cũ.
* Không sửa ảnh gốc trong Firebase Storage.
* Không upload ảnh đã chèn chữ ngược lại Firebase Storage.

File utility liên quan:

```text
src/lib/shareImageOverlay.ts
```

File tích hợp chính:

```text
src/components/SessionList.tsx
```

Dữ liệu thời gian:

* Lấy theo thời gian phiên chụp.
* Ưu tiên các field như:

  * `capturedAt`
  * `createdAt`
  * `uploadedAt`
  * field thực tế app đang dùng để hiển thị thời gian phiên.
* Format đề xuất:

```text
dd/MM/yyyy HH:mm:ss
```

Dữ liệu địa chỉ:

* Lấy từ Setting, không hard-code cố định trong component chia sẻ.
* Field đề xuất:

```ts
shareOverlayAddressLines: string[]
```

Default hiện dùng:

```text
Toyota Hà Đông
973 Quang Trung
Phú Lương, Hà Đông
Hà Nội, Việt Nam
```

Có thể có setting:

```ts
shareOverlayEnabledByDefault: boolean
```

Mặc định nên là `false` để không thay đổi hành vi cũ đột ngột.

Khi sửa tính năng này, phải test:

* Chia sẻ 1 ảnh không tích checkbox.
* Chia sẻ 1 ảnh có tích checkbox.
* Chia sẻ nhiều ảnh có tích checkbox.
* iOS/Zalo vẫn share `files` only.
* Ảnh gốc trong Storage không thay đổi.

---

## 9. Xe hôm nay và logic hiển thị xe của nhân viên

Đã có tình trạng:

* Nhân viên chụp bằng “Chụp & tải ngay”.
* Sau khi bấm Xong, vào “Xe hôm nay” không thấy xe.
* Bấm “Làm mới danh sách” vẫn không thấy.
* Nhưng admin trên máy khác lại thấy.

Nguyên nhân nghi ngờ:

* Query của nhân viên bị giới hạn theo bộ phận/trạng thái.
* Xe do chính nhân viên tạo nhưng không thỏa điều kiện lọc.
* Phiên có thể đang `uploading`.

Logic mong muốn:

* Admin thấy tất cả xe trong ngày như hiện tại.
* Nhân viên thường thấy:

  * xe thuộc bộ phận của mình,
  * cộng thêm xe do chính mình tạo trong ngày.
* Nếu xe do chính user tạo đang `uploading`, vẫn nên hiển thị để họ biết phiên chưa mất.

File chính:

```text
src/components/SessionList.tsx
```

Các field có thể dùng để xác định xe của user:

* `createdByUid`
* `uploadedByUid`
* `uploadedBy.uid`
* `createdBy.uid`
* `userId`

Khi gộp danh sách:

* Gộp query chính và query “xe của tôi”.
* Loại trùng theo document id.
* Không mở rộng quyền xem xe của bộ phận khác nếu không phải xe do chính user tạo.
* Không sửa Rules chỉ để xử lý UI.

Nút:

```text
Làm mới danh sách
```

Nút này chỉ gọi lại query hiện tại. Nó không sửa dữ liệu, không reload app, không xóa cache.

---

## 10. Settings

App có khu vực Cài đặt.

Khi thêm setting mới:

* Giữ đúng phân quyền hiện tại.
* User thường không được sửa setting admin nếu trước đó không có quyền.
* Không hard-code các cấu hình có thể thay đổi trong component nghiệp vụ nếu đã có Setting.

Các setting liên quan hiện tại / đề xuất:

* Địa chỉ chèn lên ảnh chia sẻ:

```ts
shareOverlayAddressLines: string[]
```

* Mặc định bật chèn overlay khi chia sẻ:

```ts
shareOverlayEnabledByDefault: boolean
```

Không làm mất setting cũ khi thêm setting mới.

---

## 11. Quy tắc về ảnh gốc

Ảnh gốc trong Firebase Storage là dữ liệu nghiệp vụ.

Không được:

* ghi đè,
* nén lại rồi upload đè,
* chèn chữ trực tiếp lên ảnh gốc,
* xóa ảnh gốc,
* đổi storage path,
* tạo bản sao hàng loạt.

Nếu cần biến đổi ảnh cho chia sẻ/tải về, hãy tạo file tạm trên frontend bằng canvas.

---

## 12. Quy tắc về build và deploy

### Build frontend

Dùng:

```powershell
npm.cmd install
npm.cmd run build
```

Nếu build lỗi, dừng lại và báo lỗi.

Không chạy:

```powershell
npm audit fix --force
```

nếu không có yêu cầu riêng, vì có thể phá dependency.

Cảnh báo chunk lớn của Vite không chặn deploy.

### Deploy frontend

Chỉ deploy Hosting khi người dùng yêu cầu rõ:

```powershell
firebase.cmd deploy --only hosting --project anh-xe-thd
```

### Không deploy Functions mặc định

Không dùng:

```powershell
firebase deploy
```

Không dùng:

```powershell
firebase.cmd deploy --only functions
```

trừ khi task yêu cầu sửa Cloud Functions và đã kiểm tra kỹ.

---

## 13. Quy tắc làm việc với GitHub

Repository hiện tại:

```text
catkeylife-dev/-catkeylife-dev-toyota-photo-gallery
```

Khi làm việc với GitHub:

* Không đổi repo nếu không được yêu cầu.
* Không push code chưa build.
* Không commit file chứa secret.
* Không commit `.env` thật.
* Không commit API key.
* Không commit file backup rác, zip build, `node_modules`, `dist` nếu không có chủ đích.

Google AI Studio có thể sync GitHub. Nếu panel báo:

```text
No changes to commit
```

thì không phải lỗi, nghĩa là code hiện tại đã đồng bộ với GitHub.

---

## 14. Checklist trước khi báo hoàn thành task

Trước khi báo task hoàn thành, phải kiểm tra:

1. Đã sửa đúng file cần sửa.
2. Không sửa lan man.
3. Không đụng ảnh gốc.
4. Không đụng Cloud Function nếu task không yêu cầu.
5. Không đụng Rules nếu task không yêu cầu.
6. Build thành công.
7. Báo rõ file đã sửa.
8. Báo rõ cách test.
9. Nếu có lỗi, báo thật, không nói đã xong khi chưa chắc.

---

## 15. Checklist test các luồng quan trọng

Sau mỗi sửa đổi liên quan đến UI/ảnh/chia sẻ/upload, cần test tối thiểu:

### Tạo phiên

* Tạo phiên bằng chọn ảnh.
* Tạo phiên bằng camera thường.
* Tạo phiên bằng Chụp & tải ngay.

### Nhận diện biển số

* Ảnh có biển rõ.
* Ảnh không có biển.
* Người dùng đã nhập sẵn biển số thì không gọi AI nếu logic yêu cầu vậy.

### Chụp & tải ngay

* Vào camera khi biển số trống.
* Không hiện form nhập biển số lớn che camera khi chưa chụp ảnh.
* Chụp 1 ảnh.
* Chụp 3 ảnh.
* Bấm Xong khi đủ điều kiện.
* Không trắng màn hình.
* Xe xuất hiện trong Xe hôm nay.

### Xe hôm nay

* Admin thấy dữ liệu.
* User thường thấy xe thuộc bộ phận.
* User thường thấy xe do chính mình tạo.
* Nút Làm mới danh sách không làm logout, không reset tìm kiếm.

### Chia sẻ

* Share 1 ảnh.
* Share nhiều ảnh.
* Share iOS/Zalo bằng `files` only.
* Nếu tích overlay, ảnh chia sẻ có thời gian và địa chỉ.
* Nếu không tích overlay, ảnh chia sẻ giữ như cũ.
* Ảnh gốc không đổi.

### Download

* Download ảnh vẫn hoạt động.
* Không bị ảnh hưởng bởi overlay chia sẻ nếu không có yêu cầu.

---

## 16. Các lỗi đã từng gặp và bài học

### Lỗi iOS/Zalo khi share nhiều ảnh

Nguyên nhân:

* Share payload có cả `files`, `title`, `text`.

Cách tránh:

* Chỉ share:

```ts
navigator.share({ files })
```

### Lỗi máy nhân viên không thấy xe

Nguyên nhân nghi ngờ:

* Query theo bộ phận/trạng thái không bao gồm xe do chính user tạo.
* Phiên bị `uploading`.
* Khác biệt quyền giữa admin và user thường.

Cách xử lý:

* Bổ sung query “xe của tôi”.
* Gộp danh sách và loại trùng.
* Không chỉ dựa vào refresh.

### Lỗi popup nhập biển số che camera

Nguyên nhân:

* Form nhập biển số tự động hiện khi biển số trống.

Cách xử lý:

* Không mở form khi mới vào camera.
* Chỉ mở khi user chủ động bấm hoặc khi bấm Xong mà thiếu biển số.

### Lỗi màn hình trắng sau khi bấm Xong

Nguyên nhân nghi ngờ:

* Runtime error trong `handleBgUploadComplete`.
* User bấm Xong khi ảnh chưa upload xong.
* State thiếu `tempSessionDocId`, `plate`, `completedItems`, hoặc `thumbnailUrl`.

Cách xử lý:

* Disable nút Xong khi chưa an toàn.
* Bọc try/catch.
* Ghi `client_error_logs`.
* Không reset dữ liệu nếu hoàn tất thất bại.

---

## 17. Khi viết báo cáo sau task

Báo cáo phải ngắn gọn nhưng đủ ý:

* Đã sửa file nào.
* Sửa logic gì.
* Không sửa gì.
* Build có thành công không.
* Có cần deploy không.
* Cách test nhanh.

Ví dụ:

```text
Đã sửa:
- src/components/SessionList.tsx
- src/lib/shareImageOverlay.ts

Nội dung:
- Thêm checkbox chèn thời gian & địa chỉ khi chia sẻ.
- Tạo ảnh tạm bằng canvas, không sửa ảnh gốc.
- Share vẫn dùng files only.

Không sửa:
- Cloud Function
- Firestore Rules
- Storage Rules
- Upload ảnh
- Nhận diện biển số

Build: thành công.
Chưa deploy Firebase.
```

---

## 18. Nguyên tắc cuối cùng

Ưu tiên ổn định production hơn thêm tính năng nhanh.

Nếu có hai cách:

* Cách nhanh nhưng rủi ro ảnh hưởng dữ liệu.
* Cách chậm hơn nhưng an toàn.

Hãy chọn cách an toàn.

Nếu chưa chắc, hãy hỏi lại người dùng trước khi sửa.
