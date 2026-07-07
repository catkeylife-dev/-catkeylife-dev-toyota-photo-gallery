import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

// Helper to assert admin authorization and active status with specific error requirements
async function assertAdminUser(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Phiên đăng nhập không hợp lệ."
    );
  }

  const callerUid = context.auth.uid;
  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();

  if (!callerDoc.exists) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Bạn không có quyền tạo tài khoản."
    );
  }

  const callerData = callerDoc.data();
  if (!callerData || callerData.role !== "admin" || callerData.isActive === false) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Bạn không có quyền tạo tài khoản."
    );
  }

  return { callerUid, callerData };
}

// 1. CREATE MANAGED USER
export const createManagedUser = functions.region("asia-southeast1").https.onCall(async (data, context) => {
  console.log("[CREATE MANAGED USER INVOKED]", {
    callerUid: context.auth?.uid,
    hasAuth: !!context.auth
  });
  try {
    await assertAdminUser(context);

    const { email, password, displayName, role, departmentId, canDeleteSession } = data;

    // Direct validations
    if (!email || !email.trim()) {
      throw new functions.https.HttpsError("invalid-argument", "Email không được để trống.");
    }
    if (!password || password.length < 6) {
      throw new functions.https.HttpsError("invalid-argument", "Mật khẩu phải có tối thiểu 6 ký tự.");
    }
    if (!displayName || !displayName.trim()) {
      throw new functions.https.HttpsError("invalid-argument", "Họ tên không được để trống.");
    }

    console.log("[CREATE USER DEPARTMENT]", {
      email,
      receivedDepartmentId: departmentId
    });

    if (!departmentId) {
      throw new functions.https.HttpsError("invalid-argument", "Bộ phận không được để trống.");
    }

    const departmentSnap = await admin
      .firestore()
      .doc(`departments/${departmentId}`)
      .get();

    if (!departmentSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Bộ phận "${departmentId}" không tồn tại.`);
    }

    const deptData = departmentSnap.data();
    if (deptData && deptData.isActive === false) {
      throw new functions.https.HttpsError("failed-precondition", `Bộ phận "${deptData.name || departmentId}" đã bị vô hiệu hóa.`);
    }

    // Check if user already exists to fail early
    try {
      const existingUser = await admin.auth().getUserByEmail(email.trim().toLowerCase());
      if (existingUser) {
        throw new functions.https.HttpsError("already-exists", "Email này đã được sử dụng.");
      }
    } catch (getErr: any) {
      if (getErr.code !== "auth/user-not-found") {
        throw getErr;
      }
    }

    // Create Firebase Auth user
    let newUser: admin.auth.UserRecord;
    try {
      newUser = await admin.auth().createUser({
        email: email.trim().toLowerCase(),
        password: password,
        displayName: displayName.trim(),
        disabled: false
      });
    } catch (authErr: any) {
      if (authErr.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError("already-exists", "Email này đã được sử dụng.");
      }
      if (authErr.code === "auth/invalid-password") {
        throw new functions.https.HttpsError("invalid-argument", "Mật khẩu phải có tối thiểu 6 ký tự.");
      }
      throw authErr;
    }

    // Create companion document in users collection
    try {
      await admin.firestore().doc(`users/${newUser.uid}`).set({
        uid: newUser.uid,
        email: email.trim().toLowerCase(),
        displayName: displayName.trim(),
        role: role === "admin" ? "admin" : "user",
        departmentId: departmentId,
        isActive: true,
        canDeleteSession: !!canDeleteSession,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (dbErr: any) {
      // If Firestore fails, delete the created auth user as rollback
      try {
        await admin.auth().deleteUser(newUser.uid);
      } catch (delErr) {
        functions.logger.error("Failed to delete user on rollback", delErr);
      }
      throw new functions.https.HttpsError(
        "internal",
        "Lỗi lưu cơ sở dữ liệu. Đã hoàn tác tài khoản để chống dữ liệu dở dang."
      );
    }

    return { success: true, uid: newUser.uid, message: "Đã tạo tài khoản thành công." };

  } catch (error: any) {
    functions.logger.error("[createManagedUser ERROR]", {
      code: error.code || "unknown",
      message: error.message || error.toString(),
      stack: error.stack
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Map other potential unexpected failures
    throw new functions.https.HttpsError(
      "internal",
      "Không thể tạo tài khoản. Vui lòng kiểm tra log Cloud Functions."
    );
  }
});

// 2. UPDATE MANAGED USER
export const updateManagedUser = functions.region("asia-southeast1").https.onCall(async (data, context) => {
  try {
    await assertAdminUser(context);

    const { uid, displayName, role, departmentId, canDeleteSession, isActive } = data;

    if (!uid) {
      throw new functions.https.HttpsError("invalid-argument", "Không xác định được mã UID người dùng cần sửa.");
    }
    if (!displayName || !displayName.trim()) {
      throw new functions.https.HttpsError("invalid-argument", "Họ tên không được để trống.");
    }

    console.log("[UPDATE USER DEPARTMENT]", {
      uid,
      receivedDepartmentId: departmentId
    });

    const userDocRef = admin.firestore().collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Hồ sơ người dùng không tồn tại.");
    }

    // Check if departmentId is valid
    if (departmentId) {
      const deptDoc = await admin.firestore().collection("departments").doc(departmentId).get();
      if (!deptDoc.exists) {
        throw new functions.https.HttpsError("not-found", `Bộ phận "${departmentId}" không tồn tại.`);
      }
      const deptData = deptDoc.data();
      if (deptData && deptData.isActive === false) {
        throw new functions.https.HttpsError("failed-precondition", `Bộ phận "${deptData.name || departmentId}" đã bị vô hiệu hóa.`);
      }
    }

    // Update Auth displayName
    await admin.auth().updateUser(uid, {
      displayName: displayName.trim(),
    });

    // Update Firestore companion document
    await admin.firestore().doc(`users/${uid}`).update({
      displayName: displayName.trim(),
      role: role,
      departmentId: departmentId,
      canDeleteSession: !!canDeleteSession,
      isActive: isActive !== undefined ? !!isActive : true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: "Cập nhật thông tin tài khoản thành công." };

  } catch (error: any) {
    functions.logger.error("[updateManagedUser ERROR]", {
      code: error.code || "unknown",
      message: error.message || error.toString(),
      stack: error.stack
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      "Không thể cập nhật tài khoản. Vui lòng kiểm tra log Cloud Functions."
    );
  }
});

// 3. SET MANAGED USER STATUS (Block/Unblock)
export const setManagedUserStatus = functions.region("asia-southeast1").https.onCall(async (data, context) => {
  try {
    const { callerUid } = await assertAdminUser(context);

    const targetUid = data.uid || data.targetUid;
    const isActive = data.isActive;

    if (!targetUid) {
      throw new functions.https.HttpsError("invalid-argument", "Không xác định được mã UID người dùng cần sửa trạng thái.");
    }

    // Prevent self-locking
    if (callerUid === targetUid && !isActive) {
      throw new functions.https.HttpsError("failed-precondition", "Bạn không thể tự khóa tài khóa quản trị của chính mình!");
    }

    const userDocRef = admin.firestore().collection("users").doc(targetUid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Hồ sơ người dùng không tồn tại.");
    }

    // Update Firebase Auth status
    await admin.auth().updateUser(targetUid, {
      disabled: !isActive
    });

    // Update Firestore isActive status
    await userDocRef.update({
      isActive: !!isActive,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: isActive ? "Đã mở khóa tài khoản thành công." : "Đã khóa tài khoản thành công." };

  } catch (error: any) {
    functions.logger.error("[setManagedUserStatus ERROR]", {
      code: error.code || "unknown",
      message: error.message || error.toString(),
      stack: error.stack
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      "Không thể cập nhật trạng thái tài khoản. Vui lòng kiểm tra log Cloud Functions."
    );
  }
});

// 4. DELETE MANAGED USER
export const deleteManagedUser = functions.region("asia-southeast1").https.onCall(async (data, context) => {
  const request = context;
  const targetUid = data?.targetUid;

  try {
    // 1. Check authentication
    if (!request || !request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Yêu cầu chưa được xác thực. Vui lòng đăng nhập lại."
      );
    }

    const callerUid = request.auth.uid;

    if (!targetUid || typeof targetUid !== "string" || !targetUid.trim()) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Mã UID tài khoản đích (targetUid) không hợp lệ hoặc bị thiếu."
      );
    }

    // 2. Read caller document to verify admin role and active status
    const callerDocRef = admin.firestore().collection("users").doc(callerUid);
    const callerDoc = await callerDocRef.get();

    if (!callerDoc.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Không tìm thấy hồ sơ người yêu cầu trong hệ thống."
      );
    }

    const callerData = callerDoc.data();
    if (!callerData || callerData.role !== "admin") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Chỉ Quản trị viên (admin) mới có quyền xóa tài khoản."
      );
    }

    if (callerData.isActive !== true) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Tài khoản của bạn đã bị khóa hoặc chưa được kích hoạt."
      );
    }

    // 3. Prevent self-deletion
    if (callerUid === targetUid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Bạn không thể tự xóa tài khoản của chính mình!"
      );
    }

    // 4. Read target user document to verify existence
    const targetDocRef = admin.firestore().collection("users").doc(targetUid);
    const targetDoc = await targetDocRef.get();

    if (!targetDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Không tìm thấy hồ sơ tài khoản cần xóa trên Firestore."
      );
    }

    // 5. Delete from Firebase Authentication
    try {
      await admin.auth().deleteUser(targetUid);
    } catch (authErr: any) {
      if (authErr.code === "auth/user-not-found") {
        functions.logger.warn(`Auth user ${targetUid} not found in Firebase Authentication, proceeding to delete Firestore document.`, authErr);
      } else {
        throw new functions.https.HttpsError(
          "internal",
          `Lỗi khi xóa tài khoản khỏi Firebase Authentication: ${authErr.message || authErr.code}`,
          authErr.code || authErr.message
        );
      }
    }

    // 6. Delete document users/{targetUid} from Firestore
    try {
      await targetDocRef.delete();
    } catch (dbErr: any) {
      throw new functions.https.HttpsError(
        "internal",
        `Đã xóa từ Firebase Authentication nhưng gặp lỗi khi xóa hồ sơ Firestore: ${dbErr.message}`,
        dbErr.code || dbErr.message
      );
    }

    return { 
      success: true, 
      message: "Đã xóa tài khoản thành công. Các phiên xe lịch sử của kỹ thuật viên vẫn được giữ nguyên." 
    };

  } catch (error: any) {
    console.error("[DELETE MANAGED USER ERROR]", {
      callerUid: request.auth?.uid,
      targetUid,
      code: error?.code,
      message: error?.message,
      stack: error?.stack
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      `Không thể xóa tài khoản. Chi tiết lỗi hệ thống: ${error.message || error.toString()}`,
      error.code || error.message
    );
  }
});
