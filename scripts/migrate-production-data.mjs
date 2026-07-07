import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from 'fs';
import path from 'path';

// --- ARGUMENT PARSING ---
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply || process.argv.includes('--dry-run');

console.log(`===========================================================`);
console.log(`   TIẾN TRÌNH CHUẨN HÓA DỮ LIỆU SẢN XUẤT (PRODUCTION MIGRATION) `);
console.log(`===========================================================`);
console.log(`Chế độ: ${isApply ? 'APPLY (Cập nhật dữ liệu thật)' : 'DRY-RUN (Thử nghiệm rà soát - Mặc định)'}`);

// Helper Class to safe bundle batches under 400 operations
class SafeBatcher {
  constructor(databaseInstance) {
    this.db = databaseInstance;
    this.batch = databaseInstance.batch();
    this.writeCount = 0;
    this.totalCommitted = 0;
  }

  async set(docRef, data, options) {
    if (options) {
      this.batch.set(docRef, data, options);
    } else {
      this.batch.set(docRef, data);
    }
    this.writeCount++;
    await this.checkCommit();
  }

  async update(docRef, data) {
    this.batch.update(docRef, data);
    this.writeCount++;
    await this.checkCommit();
  }

  async delete(docRef) {
    this.batch.delete(docRef);
    this.writeCount++;
    await this.checkCommit();
  }

  async checkCommit() {
    if (this.writeCount >= 400) {
      await this.commit();
    }
  }

  async commit() {
    if (this.writeCount > 0) {
      console.log(`[BATCH] Đang ghi Batch #${Math.floor(this.totalCommitted / 400) + 1} (${this.writeCount} thao tác)...`);
      await this.batch.commit();
      this.totalCommitted += this.writeCount;
      this.batch = this.db.batch();
      this.writeCount = 0;
    }
  }

  async finalize() {
    if (this.writeCount > 0) {
      await this.commit();
    }
    console.log(`[BATCH HOÀN TẤT] Đồng bộ Firestore thành công. Tổng cộng ${this.totalCommitted} thao tác đã ghi.`);
  }
}

async function run() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;

  if (projectId !== "anh-xe-thd") {
    throw new Error(`Sai project: ${projectId || "không xác định"}`);
  }

  const normalizedProjectId = projectId; // compatibility for logs

  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: applicationDefault(),
          projectId
        });

  const db = getFirestore(app);
  const auth = getAuth(app);

  // --- TRUY VẤN DỮ LIỆU RÀ SOÁT ---
  console.log("\n[FETCH] Đang tải dữ liệu từ Firestore...");

  // A. Cars
  const carsRef = db.collection('cars');
  const carsSnap = await carsRef.get();
  const totalCarsCount = carsSnap.size;

  let carsToServiceCount = 0;
  let carsToBaohiemCount = 0;
  let carsKeepCount = 0;
  const carUpdates = [];

  carsSnap.forEach((doc) => {
    const data = doc.data();
    const dId = data.departmentId;
    const legacyDept = data.department;

    // 1. Chưa có bộ phận gán "service"
    if (!dId && !legacyDept) {
      carsToServiceCount++;
      carUpdates.push({
        ref: doc.ref,
        payload: { departmentId: 'service' },
        desc: `Car ${doc.id} (RO: ${data.roNumber || 'Khác'}, Plate: ${data.plateNumber || 'Khác'}): Chưa có bộ phận -> Gán "service"`
      });
    }
    // 2. Chuyển đổi "insurance" cũ thành "baohiem"
    else if (dId === 'insurance' || legacyDept === 'insurance') {
      carsToBaohiemCount++;
      const payload = { departmentId: 'baohiem' };
      if (legacyDept !== undefined) {
        payload.department = FieldValue.delete();
      }
      carUpdates.push({
        ref: doc.ref,
        payload,
        desc: `Car ${doc.id} (RO: ${data.roNumber || 'Khác'}, Plate: ${data.plateNumber || 'Khác'}): insurance -> "baohiem"`
      });
    }
    // 3. Đã có bộ phận đúng quy chuẩn, giữ nguyên
    else {
      carsKeepCount++;
    }
  });

  // B. Departments
  const deptRef = db.collection('departments');
  const insDeptSnap = await deptRef.doc('insurance').get();
  const isInsuranceDeptDocPresent = insDeptSnap.exists;

  const targetDepts = [
    { id: 'service', name: 'Dịch vụ' },
    { id: 'baohiem', name: 'Bảo hiểm' },
    { id: 'phukien', name: 'Phụ kiện' }
  ];

  const deptUpdates = [];
  targetDepts.forEach((item) => {
    deptUpdates.push({
      ref: deptRef.doc(item.id),
      payload: {
        id: item.id,
        name: item.name,
        active: true
      },
      desc: `Độc lập ghi/cập nhật bộ phận "${item.id}" thành: { name: "${item.name}", active: true } (Merge: true)`
    });
  });

  // C. Users
  const usersRef = db.collection('users');
  const usersSnap = await usersRef.get();

  const userUpdates = [];
  const missingDeptUsers = [];
  const skippedUsers = []; // Chứa hồ sơ có tài khoản Authentication không còn tồn tại

  for (const doc of usersSnap.docs) {
    const userId = doc.id;
    if (userId.startsWith('pre-auth-')) {
      continue; // Bỏ qua tài khoản bắt đầu bằng pre-auth-
    }

    const uData = doc.data();
    const email = uData.email || 'N/A';
    const role = uData.role || '';

    // Rà soát tài khoản người dùng trong Firebase Authentication trước khi cập nhật
    try {
      await auth.getUser(userId);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        skippedUsers.push({
          uid: userId,
          email,
          role,
          displayName: uData.displayName || 'N/A',
          reason: "Hồ sơ Firestore không còn tài khoản Authentication tương ứng"
        });
        continue; // Bỏ qua document, không cập nhật quyền, không xóa document
      } else {
        // Trong trường hợp lỗi khác, ghi chú lại để an toàn
        skippedUsers.push({
          uid: userId,
          email,
          role,
          displayName: uData.displayName || 'N/A',
          reason: `Lỗi kiểm tra Auth (${err.code || err.message})`
        });
        continue;
      }
    }

    if (role === 'admin') {
      const payload = {};
      const changesDesc = [];

      if (!uData.uid) {
        payload.uid = userId;
        changesDesc.push(`gán uid="${userId}"`);
      }
      if (!uData.departmentId) {
        payload.departmentId = 'admin';
        changesDesc.push(`gán departmentId="admin"`);
      }
      // Bảo toàn trường isActive / active hiện tại. Chỉ ghi isActive = true nếu thiếu.
      if (uData.isActive === undefined && uData.active === undefined) {
        payload.isActive = true;
        changesDesc.push(`gán isActive=true`);
      }
      if (uData.canDeleteSession === undefined) {
        payload.canDeleteSession = true;
        changesDesc.push(`gán canDeleteSession=true`);
      }

      if (Object.keys(payload).length > 0) {
        userUpdates.push({
          ref: doc.ref,
          payload,
          desc: `Admin ${email} (UID: ${userId}): ${changesDesc.join(', ')}`
        });
      }
    } else {
      // User thường: không tự động gán bộ phận, lọc ra để Admin kiểm tra bằng tay
      if (!uData.departmentId && !uData.department) {
        missingDeptUsers.push({
          uid: userId,
          email,
          displayName: uData.displayName || 'N/A'
        });
      }
    }
  }

  // --- HIỂN THỊ BÁO CÁO MẪU (DRY-RUN) ---
  console.log(`\n===========================================================`);
  console.log(`                BÁO CÁO THỐNG KÊ (DRY-RUN)                `);
  console.log(`===========================================================`);
  console.log(`- Project ID: ${normalizedProjectId}`);
  console.log(`- Tổng số cars quét được: ${totalCarsCount}`);
  console.log(`- Số cars sẽ gán sang bộ phận "service" (thiếu bộ phận): ${carsToServiceCount}`);
  console.log(`- Số cars sẽ chuyển đổi từ "insurance" sang "baohiem": ${carsToBaohiemCount}`);
  console.log(`- Số cars hợp quy sẽ giữ nguyên không đổi: ${carsKeepCount}`);

  console.log(`\n- Tình trạng Core Departments cấu trúc:`);
  targetDepts.forEach((d) => {
    console.log(`  + [${d.id}]: "${d.name}" (Active: true) [Sẽ đảm bảo tồn tại]`);
  });

  if (isInsuranceDeptDocPresent) {
    console.log(`  ⚠️  CẢNH BÁO: Phát hiện dư thừa document "departments/insurance" từ hệ thống cũ. (Không tự xóa trong script này, Admin xử lý sau)`);
  } else {
    console.log(`  + Sạch: Không có departments/insurance dư thừa.`);
  }

  console.log(`\n- Số tài khoản ADMIN HỢP LỆ (có Auth) sẽ được đồng bộ/bổ sung trường thiếu: ${userUpdates.length}`);
  userUpdates.forEach((item) => {
    console.log(`  + ${item.desc}`);
  });

  const staleAdmins = skippedUsers.filter(u => u.role === 'admin');
  const staleRegularUsers = skippedUsers.filter(u => u.role !== 'admin');

  console.log(`\n- Danh sách hồ sơ ADMIN CŨ không còn Auth bị BỎ QUA (không cấp quyền): ${staleAdmins.length}`);
  if (staleAdmins.length > 0) {
    staleAdmins.forEach((usr, index) => {
      console.log(`  ${index + 1}. [UID: ${usr.uid}] - Email: ${usr.email} - Tên: ${usr.displayName} (${usr.reason})`);
    });
  } else {
    console.log(`  + Không tìm thấy hồ sơ Admin mồ côi (cũ không còn Auth).`);
  }

  console.log(`\n- Danh sách hồ sơ USER THƯỜNG không còn Auth bị BỎ QUA: ${staleRegularUsers.length}`);
  if (staleRegularUsers.length > 0) {
    staleRegularUsers.forEach((usr, index) => {
      console.log(`  ${index + 1}. [UID: ${usr.uid}] - Email: ${usr.email} - Tên: ${usr.displayName} (${usr.reason})`);
    });
  } else {
    console.log(`  + Không tìm thấy hồ sơ User thường mồ côi (cũ không còn Auth).`);
  }

  console.log(`\n- Danh sách USER THƯỜNG bị thiếu departmentId/department (Cần kiểm tra thủ công): ${missingDeptUsers.length}`);
  if (missingDeptUsers.length > 0) {
    missingDeptUsers.forEach((usr, index) => {
      console.log(`  ${index + 1}. [UID: ${usr.uid}] - Email: ${usr.email} - Tên: ${usr.displayName}`);
    });
  } else {
    console.log(`  + Đẹp: Toàn bộ user thường đã có thông tin bộ phận tương ứng.`);
  }

  // --- TIẾN HÀNH THỰC THI THẬT (APPLY MODE) ---
  if (isApply) {
    if (process.env.CONFIRM_PRODUCTION_MIGRATION !== 'YES') {
      console.log(`\n❌ THAO TÁC BỊ CHẶN: Bạn đang cố gắng ghi dữ liệu thật, nhưng chưa xác nhận biến an toàn.`);
      console.log(`Vui lòng thiết lập biến môi trường CONFIRM_PRODUCTION_MIGRATION=YES trước khi thực thi.`);
      console.log(`Ví dụ:`);
      console.log(`  $env:CONFIRM_PRODUCTION_MIGRATION="YES"; node scripts/migrate-production-data.mjs --apply`);
      process.exit(1);
    }

    console.log(`\n===========================================================`);
    console.log(`              BẮT ĐẦU GHI ENGINE ĐỒNG BỘ THẬT              `);
    console.log(`===========================================================`);

    try {
      const batcher = new SafeBatcher(db);

      // 1. Ghi chuẩn hóa departments
      console.log("\n[APPLY 1/3] Đang ghi đè cập nhật bộ phận...");
      for (const d of deptUpdates) {
        console.log(`  -> Ghi: ${d.payload.id} (${d.payload.name})`);
        await batcher.set(d.ref, d.payload, { merge: true });
      }

      // 2. Ghi chuẩn hóa cars
      console.log("\n[APPLY 2/3] Đang chuẩn hóa bộ phận cho cars...");
      for (const c of carUpdates) {
        console.log(`  -> Cập nhật: ${c.desc}`);
        await batcher.update(c.ref, c.payload);
      }

      // 3. Ghi bổ sung trường cho User Admin
      console.log("\n[APPLY 3/3] Đang cập nhật bổ sung trường cho các Admin...");
      for (const u of userUpdates) {
        console.log(`  -> Cập nhật Admin: ${u.desc}`);
        await batcher.update(u.ref, u.payload);
      }

      // Ghi tất cả số write dư cuối cùng
      await batcher.finalize();

      console.log(`\n🎉 CHÚC MỪNG: Tiến trình migration chuẩn hóa bộ phận trên production hoàn tất xuất sắc và an toàn thành công!`);
    } catch (err) {
      console.error(`\n❌ THẤT BẠI: Lỗi phát sinh trong quá trình ghi batch đồng bộ:`, err.message);
      process.exit(1);
    }
  } else {
    console.log(`\n💡 GỢI Ý: Lệnh hiện tại đang chạy ở chế độ DRY-RUN.`);
    console.log(`Để áp dụng cập nhật chính thức lên production thật, hãy chạy:`);
    console.log(`  PowerShell:  $env:CONFIRM_PRODUCTION_MIGRATION="YES"; node scripts/migrate-production-data.mjs --apply`);
    console.log(`  Bash/MacOS:  CONFIRM_PRODUCTION_MIGRATION=YES node scripts/migrate-production-data.mjs --apply`);
    console.log(`Chi tiết hướng dẫn tích hợp cấu hình và khóa bí mật xem trong scripts/README-production-migration.md.`);
  }
}

run().catch((err) => {
  console.error("❌ Lỗi tiến trình migration hệ thống:", err);
  process.exit(1);
});
