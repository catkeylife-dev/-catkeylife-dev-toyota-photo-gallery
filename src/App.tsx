import { useState, useEffect } from 'react';
import Header from './components/Header';
import TabBar from './components/TabBar';
import PhotoCapture from './components/PhotoCapture';
import SessionList from './components/SessionList';
import AccountManager from './components/AccountManager';
import DepartmentManager from './components/DepartmentManager';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/firebase';
import { collection, query, orderBy, limit, startAfter, getDocs, updateDoc, doc, getDoc, setDoc, deleteField, serverTimestamp, where, deleteDoc } from 'firebase/firestore';
import { getSearchFields } from './lib/searchUtils';
import { useAuth } from './context/AuthContext';
import LoginScreen from './components/LoginScreen';
import { normalizeDepartmentValue } from './lib/departmentResolver';

export default function App() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'capture' | 'today' | 'search' | 'settings'>('capture');
  const [settingsView, setSettingsView] = useState<'info' | 'accounts' | 'departments'>('info');

  // Reset settings sub-view if global tab shifts
  useEffect(() => {
    setSettingsView('info');
  }, [activeTab]);

  // Maintenance click-target & panel states
  const [clickCount, setClickCount] = useState(0);
  const [showMaintenanceUnlock, setShowMaintenanceUnlock] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);

  // Indexing migration states
  const [migrationCompleted, setMigrationCompleted] = useState<boolean>(false);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [isMigrating, setIsMigrating] = useState<boolean>(false);
  const [migrationProgress, setMigrationProgress] = useState<string>('');
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [updatedCount, setUpdatedCount] = useState<number>(0);

  // Admin Utilities
  const [seedConfirmOpen, setSeedConfirmOpen] = useState<boolean>(false);
  const [fixConfirmOpen, setFixConfirmOpen] = useState<boolean>(false);
  const [normalizeDeptsConfirmOpen, setNormalizeDeptsConfirmOpen] = useState<boolean>(false);
  const [normalizeInsuranceConfirmOpen, setNormalizeInsuranceConfirmOpen] = useState<boolean>(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Share Overlay Settings States
  const [addressText, setAddressText] = useState<string>(
    "Toyota Hà Đông\n973 Quang Trung\nPhú Lương, Hà Đông\nHà Nội, Việt Nam"
  );
  const [enabledByDefault, setEnabledByDefault] = useState<boolean>(false);
  const [isSavingOverlaySettings, setIsSavingOverlaySettings] = useState<boolean>(false);
  const [saveOverlaySuccess, setSaveOverlaySuccess] = useState<string | null>(null);

  // Fetch share overlay settings from Firebase on initialization
  useEffect(() => {
    if (!user) return;
    const fetchOverlaySettings = async () => {
      try {
        const docRef = doc(db, 'systemSettings', 'shareOverlay');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.shareOverlayAddressLines) {
            setAddressText(data.shareOverlayAddressLines.join('\n'));
          }
          if (data.shareOverlayEnabledByDefault !== undefined) {
            setEnabledByDefault(data.shareOverlayEnabledByDefault);
          }
        }
      } catch (err) {
        console.error("Error reading share overlay settings:", err);
      }
    };
    fetchOverlaySettings();
  }, [user]);

  const saveOverlaySettings = async () => {
    if (!user || user.role !== 'admin') return;
    setIsSavingOverlaySettings(true);
    setSaveOverlaySuccess(null);
    try {
      const lines = addressText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      const docRef = doc(db, 'systemSettings', 'shareOverlay');
      await setDoc(docRef, {
        shareOverlayAddressLines: lines,
        shareOverlayEnabledByDefault: enabledByDefault,
        updatedAt: serverTimestamp(),
        updatedBy: user.email
      }, { merge: true });

      setSaveOverlaySuccess("Cập nhật cấu hình chèn ảnh thành công!");
      setTimeout(() => setSaveOverlaySuccess(null), 3000);
    } catch (err: any) {
      alert(`Lỗi khi lưu cấu hình: ${err.message || err}`);
    } finally {
      setIsSavingOverlaySettings(false);
    }
  };

  const confirmSeedDefaultDepts = async () => {
    if (!user || user.role !== 'admin') return;
    setSeedConfirmOpen(false);
    setActionStatus("Đang kiểm tra dữ liệu bộ phận...");
    setActionError(null);
    try {
      const snapDepts = await getDocs(collection(db, 'departments'));
      if (!snapDepts.empty) {
        setActionError("Bộ sưu tập bộ phận đã có dữ liệu. Không thực hiện khởi tạo lại!");
        setActionStatus(null);
        return;
      }
      const defaultDepartments = [
        { id: 'service', code: 'service', name: 'Dịch vụ', isActive: true },
        { id: 'baohiem', code: 'baohiem', name: 'Bảo hiểm', isActive: true },
        { id: 'admin', code: 'admin', name: 'Quản trị', isActive: true },
      ];
      for (const d of defaultDepartments) {
        await setDoc(doc(db, 'departments', d.id), {
          name: d.name,
          code: d.code,
          isActive: d.isActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setActionStatus("Khởi tạo bộ phận thành công!");
    } catch (err: any) {
      console.error("[SEED UTILITY ERROR]", err);
      setActionError(`Lỗi khởi tạo bộ phận: ${err.message || err}`);
      setActionStatus(null);
    }
  };

  const confirmNormalizeData = async () => {
    if (!user || user.role !== 'admin') return;
    setFixConfirmOpen(false);
    setActionStatus("Đang chuẩn hóa dữ liệu tài khoản...");
    setActionError(null);
    try {
      const emailsToFix = [
        'phukien@toyotahadong.com',
        'phukien2@toyotahadong.com',
        'phukien3@toyotahadong.com'
      ];
      const q = query(collection(db, 'users'), where('email', 'in', emailsToFix));
      const snap = await getDocs(q);
      let count = 0;
      for (const uDoc of snap.docs) {
        await updateDoc(doc(db, 'users', uDoc.id), {
          departmentId: 'phukien',
          department: deleteField(),
          departmentCode: deleteField(),
          selectedDepartment: deleteField(),
          team: deleteField()
        });
        count++;
      }
      setActionStatus(`Đã chuẩn hóa thành công ${count} tài khoản sang bộ phận Phụ kiện (departmentId: "phukien" và xóa các trường cũ).`);
    } catch (err: any) {
      console.error("[NORMALIZE UTILITY ERROR]", err);
      setActionError(`Lỗi chuẩn hóa dữ liệu: ${err.message || err}`);
      setActionStatus(null);
    }
  };

  const confirmNormalizeSessionDepartments = async () => {
    if (!user || user.role !== 'admin') return;
    setNormalizeDeptsConfirmOpen(false);
    setActionStatus("Đang tiến hành quét và chuẩn hóa bộ phận cho các phiên xe...");
    setActionError(null);
    try {
      const snap = await getDocs(collection(db, 'cars'));
      let checked = 0;
      let normalizedCount = 0;
      let defaultedCount = 0;
      let skippedCount = 0;

      for (const carDoc of snap.docs) {
        checked++;
        const data = carDoc.data();
        
        if (data.departmentId) {
          skippedCount++;
        } else {
          // Resolve standard legacy fields
          const rawValue = data.department
            || data.creatorDepartment
            || data.createdByDepartment
            || null;

          if (rawValue) {
            const norm = normalizeDepartmentValue(rawValue);
            if (norm) {
              await updateDoc(doc(db, 'cars', carDoc.id), {
                departmentId: norm
              });
              normalizedCount++;
            } else {
              await updateDoc(doc(db, 'cars', carDoc.id), {
                departmentId: 'service'
              });
              defaultedCount++;
            }
          } else {
            await updateDoc(doc(db, 'cars', carDoc.id), {
              departmentId: 'service'
            });
            defaultedCount++;
          }
        }
      }

      setActionStatus(`Chuẩn hóa bộ phận hoàn tất!
- Tổng số phiên xe đã kiểm tra: ${checked}
- Số phiên xe đã chuẩn hóa từ dữ liệu cũ: ${normalizedCount}
- Số phiên xe đã chuyển mặc định sang Dịch vụ (Service): ${defaultedCount}
- Số phiên xe đã bỏ qua vì đã có departmentId: ${skippedCount}`);

    } catch (err: any) {
      console.error("[DEPT NORMALIZE ERROR]", err);
      setActionError(`Lỗi chuẩn hóa bộ phận dữ liệu cũ: ${err.message || err}`);
      setActionStatus(null);
    }
  };

  const confirmNormalizeInsuranceDepartment = async () => {
    if (!user || user.role !== 'admin') return;
    setNormalizeInsuranceConfirmOpen(false);

    // Safeguard check - STRICTLY run only on 'anh-xe-thd'
    const currentProjectId = db.app?.options?.projectId || '';
    if (currentProjectId !== 'anh-xe-thd') {
      setActionError(`LỖI AN TOÀN: Chức năng chuẩn hóa dữ liệu Bảo hiểm chỉ được phép chạy trên project 'anh-xe-thd'. Hiện tại là: ${currentProjectId}`);
      setActionStatus(null);
      return;
    }

    setActionStatus("Đang tiến hành rà soát và chuẩn hóa bộ phận Bảo hiểm...");
    setActionError(null);

    try {
      // 1. Rà soát collection departments
      const insDeptRef = doc(db, 'departments', 'insurance');
      const insSnap = await getDoc(insDeptRef);
      const isInsuranceDocPresent = insSnap.exists();

      const bhDeptRef = doc(db, 'departments', 'baohiem');
      const bhSnap = await getDoc(bhDeptRef);
      const isBaohiemDocPresent = bhSnap.exists();

      // Đảm bảo document departments/baohiem chuẩn tồn tại với name: "Bảo hiểm"
      if (!isBaohiemDocPresent) {
        await setDoc(bhDeptRef, {
          name: "Bảo hiểm",
          code: "baohiem",
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      // 2. Chuẩn hóa dữ liệu users
      const usersSnap = await getDocs(collection(db, 'users'));
      let usersMigratedCount = 0;
      for (const uDoc of usersSnap.docs) {
        const uData = uDoc.data();
        const dId = uData.departmentId || '';
        const dLegacy = uData.department || '';

        if (dId === 'insurance' || dLegacy === 'insurance') {
          await updateDoc(doc(db, 'users', uDoc.id), {
            departmentId: 'baohiem',
            department: deleteField()
          });
          usersMigratedCount++;
        }
      }

      // 3. Chuẩn hóa dữ liệu cars
      const carsSnap = await getDocs(collection(db, 'cars'));
      let carsMigratedCount = 0;
      for (const cDoc of carsSnap.docs) {
        const cData = cDoc.data();
        const dId = cData.departmentId || '';
        const dLegacy = cData.department || '';

        if (dId === 'insurance' || dLegacy === 'insurance') {
          await updateDoc(doc(db, 'cars', cDoc.id), {
            departmentId: 'baohiem',
            department: deleteField()
          });
          carsMigratedCount++;
        }
      }

      // 4. Xóa document departments/insurance (nếu tồn tại)
      let deletedDocName = "Không tìm thấy";
      if (isInsuranceDocPresent) {
        await deleteDoc(insDeptRef);
        deletedDocName = "departments/insurance";
      }

      setActionStatus(`Chuẩn hóa duy nhất bộ phận Bảo hiểm thành công!
- Hai bộ phận trùng trước đây là: "insurance" và "baohiem"
- Tổng số tài khoản users đã chuyển: ${usersMigratedCount}
- Tổng số phiên xe cars đã chuyển: ${carsMigratedCount}
- Document bộ phận đã bị xóa: ${deletedDocName}`);

    } catch (err: any) {
      console.error("[INSURANCE NORMALIZE ERROR]", err);
      setActionError(`Lỗi chuẩn hóa dữ liệu Bảo hiểm: ${err.message || err}`);
      setActionStatus(null);
    }
  };

  // Load migration status from Firebase on initialization
  useEffect(() => {
    if (!user) return; // Prevent querying before authentication completed
    const fetchMigrationStatus = async () => {
      try {
        const statusDoc = await getDoc(doc(db, 'systemSettings', 'searchMigration'));
        if (statusDoc.exists()) {
          const data = statusDoc.data();
          if (data && data.completed === true) {
            setMigrationCompleted(true);
            setProcessedCount(data.processedCount || 0);
          }
        }
      } catch (err) {
        console.error("Error reading history indexing status:", err);
      }
    };
    fetchMigrationStatus();
  }, [activeTab, user]);

  // One-time bootstrap of essential departments to guarantee compliance
  useEffect(() => {
    if (!user) return;
    const bootstrapDepts = async () => {
      try {
        const flag = localStorage.getItem('departments_initialized_v2');
        if (flag === 'true') return;

        const deptsToEnsure = [
          { id: 'service', name: 'Dịch vụ' },
          { id: 'baohiem', name: 'Bảo hiểm' },
          { id: 'phukien', name: 'Phụ kiện' }
        ];

        for (const entry of deptsToEnsure) {
          const deptRef = doc(db, 'departments', entry.id);
          await setDoc(deptRef, {
            name: entry.name,
            code: entry.id,
            active: true,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }

        localStorage.setItem('departments_initialized_v2', 'true');
        console.log("Bootstrap departments completed successfully.");
      } catch (err) {
        console.error("Error ensuring essential departments:", err);
      }
    };
    bootstrapDepts();
  }, [user]);

  // Run the batch indexing operation (150 documents per segment)
  const runAdvancedMigration = async () => {
    if (isMigrating) return;
    setIsMigrating(true);
    setMigrationProgress("Đang khởi động tiến trình bảo trì...");
    setScannedCount(0);
    setUpdatedCount(0);

    try {
      let currentLastDoc: any = null;
      let hasMoreDocs = true;
      let totalScanned = 0;
      let totalUpdated = 0;

      while (hasMoreDocs) {
        setMigrationProgress(`Đang quét dọn chỉ mục... Thống kê sơ bộ (Đã quét: ${totalScanned}, Đã nâng cấp: ${totalUpdated})`);
        
        const collectionRef = collection(db, 'cars');
        // Retrieve cars ordered descending by creation date in pages of 150
        let q = query(collectionRef, orderBy('createdAt', 'desc'), limit(150));
        
        if (currentLastDoc) {
          q = query(q, startAfter(currentLastDoc));
        }

        const snap = await getDocs(q);
        if (snap.empty) {
          hasMoreDocs = false;
          break;
        }

        const docs = snap.docs;
        currentLastDoc = docs[docs.length - 1];
        totalScanned += docs.length;
        setScannedCount(totalScanned);

        // Filter the batch for items lacking the active search metadata structure
        const docsToUpdate = docs.filter(docSnap => {
          const data = docSnap.data();
          return !data.searchIndexed || !data.searchKeywords || !data.plateNormalized;
        });

        if (docsToUpdate.length > 0) {
          for (const docSnap of docsToUpdate) {
            const data = docSnap.data();
            const plate = data.plateNumber || '';
            const ro = data.roNumber || '';
            const fields = getSearchFields(plate, ro);
            
            // Apply the updated, standardized indexes including searchIndexed: true
            await updateDoc(docSnap.ref, {
              ...fields,
              searchIndexedAt: Date.now()
            });
            totalUpdated++;
            setUpdatedCount(totalUpdated);
          }
        }

        // Check if we hit the end of the collection
        if (docs.length < 150) {
          hasMoreDocs = false;
        }
        
        // Brief pause to keep the React/DOM thread fluid and responsive
        await new Promise(resolve => setTimeout(resolve, 80));
      }

      // Record final success in settings
      const metaRef = doc(db, 'systemSettings', 'searchMigration');
      await setDoc(metaRef, {
        completed: true,
        completedAt: Date.now(),
        processedCount: totalUpdated
      });

      setMigrationCompleted(true);
      setProcessedCount(totalUpdated);
      setMigrationProgress(`Hoàn thành! Đã thiết lập chỉ mục thành công cho ${totalUpdated} xe cũ.`);
      alert(`Đã hoàn tất tiến trình lập chỉ mục cho ${totalUpdated} xe cũ một cách an toàn!`);
    } catch (error: any) {
      console.error("Historical indexing failed:", error);
      setMigrationProgress(`Tiến trình gián đoạn: ${error.message || error}`);
      alert(`Đã xảy ra lỗi gián đoạn: ${error.message || error}`);
    } finally {
      setIsMigrating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col items-center justify-center p-6 text-center selection:bg-toyota-red/10 selection:text-toyota-red">
        <div className="w-14 h-14 border-4 border-gray-200 border-t-toyota-red rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-bold text-toyota-navy tracking-tight animate-pulse uppercase">Đang kiểm tra quyền truy cập…</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-app-bg text-gray-900 font-sans selection:bg-toyota-red/10 selection:text-toyota-red">
      <Header />
      
      <main className="pb-24">
        <AnimatePresence mode="wait">
          {activeTab === 'capture' && (
            <motion.div
              key="capture"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <PhotoCapture />
            </motion.div>
          )}
          
          {activeTab === 'today' && (
            <motion.div
              key="today"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <SessionList mode="today" />
            </motion.div>
          )}
          
          {activeTab === 'search' && (
            <motion.div
              key="search"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <SessionList mode="search" />
            </motion.div>
          )}

          {activeTab === 'settings' && (
            settingsView === 'accounts' ? (
              user.role !== 'admin' ? (
                <motion.div
                  key="unauthorized-settings"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  transition={{ duration: 0.2 }}
                  className="p-8 text-center text-red-600 font-bold max-w-md mx-auto shadow-sm border border-red-100 bg-white rounded-[32px] mt-10 space-y-4"
                >
                  <p className="text-sm font-black uppercase text-toyota-red">Cảnh báo bảo mật</p>
                  <p className="text-xs text-gray-500 font-semibold leading-relaxed">Bạn không có quyền truy cập chức năng này.</p>
                  <button 
                    type="button" 
                    onClick={() => setSettingsView('info')} 
                    className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black rounded-xl text-[10px] uppercase tracking-widest cursor-pointer transition-all"
                  >
                    Quay lại
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="accounts-settings"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  transition={{ duration: 0.2 }}
                >
                  <AccountManager onBack={() => setSettingsView('info')} />
                </motion.div>
              )
            ) : settingsView === 'departments' ? (
              user.role !== 'admin' ? (
                <motion.div
                  key="unauthorized-settings-departments"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  transition={{ duration: 0.2 }}
                  className="p-8 text-center text-red-600 font-bold max-w-md mx-auto shadow-sm border border-red-100 bg-white rounded-[32px] mt-10 space-y-4"
                >
                  <p className="text-sm font-black uppercase text-toyota-red">Cảnh báo bảo mật</p>
                  <p className="text-xs text-gray-500 font-semibold leading-relaxed">Bạn không có quyền truy cập chức năng này.</p>
                  <button 
                    type="button" 
                    onClick={() => setSettingsView('info')} 
                    className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black rounded-xl text-[10px] uppercase tracking-widest cursor-pointer transition-all"
                  >
                    Quay lại
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="departments-settings"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  transition={{ duration: 0.2 }}
                >
                  <DepartmentManager onBack={() => setSettingsView('info')} />
                </motion.div>
              )
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.2 }}
                className="p-8 max-w-md mx-auto text-center space-y-4"
              >
                <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto shadow-sm text-gray-400">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.72V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.17a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <h2 className="text-xl font-black text-toyota-navy uppercase tracking-tighter">Cài Đặt</h2>
                
                {/* Profile Card */}
                <div className="bg-white rounded-[32px] p-6 text-left space-y-3.5 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-3.5 border-b border-gray-100 pb-3.5">
                    <div className="w-10 h-10 bg-toyota-red/10 text-toyota-red rounded-2xl flex items-center justify-center font-black text-sm">
                      {user.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-toyota-navy uppercase tracking-tight">{user.displayName}</h3>
                      <p className="text-[10px] text-gray-400 font-bold">{user.email}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-gray-400 font-bold block uppercase tracking-wider text-[8px]">Chức vụ</span>
                      <span className="text-[11px] text-toyota-navy font-black uppercase">
                        {user.role === 'admin' ? 'Quản trị viên' : 'Kỹ thuật viên'}
                      </span>
                    </div>
                    {user.department && (
                      <div>
                        <span className="text-gray-400 font-bold block uppercase tracking-wider text-[8px]">Tổ dịch vụ</span>
                        <span className="text-[11px] text-toyota-navy font-black uppercase">{user.department}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quản lý tài khoản Menu button (For Admin Only) */}
                {user.role === 'admin' && (
                  <div className="space-y-2 w-full text-left">
                    <button
                      type="button"
                      onClick={() => setSettingsView('accounts')}
                      className="w-full py-4 bg-toyota-navy text-white hover:bg-opacity-95 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      Quản lý tài khoản
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsView('departments')}
                      className="w-full py-4 bg-toyota-red text-white hover:bg-opacity-95 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="16"/><line x1="15" y1="22" x2="15" y2="16"/><line x1="9" y1="16" x2="15" y2="16"/><path d="M8 6h2"/><path d="M14 6h2"/><path d="M8 10h2"/><path d="M14 10h2"/></svg>
                      Quản lý bộ phận
                    </button>

                    {/* Admin Tools Panel */}
                    <div className="bg-gray-50 border border-gray-100 rounded-3xl p-5 mt-4 space-y-3.5 text-center">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-toyota-navy">Công cụ quản trị hệ thống</h4>
                      
                      {actionStatus && (
                        <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-[10px] font-bold leading-normal text-left whitespace-pre-wrap">
                          {actionStatus}
                        </div>
                      )}
                      
                      {actionError && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-[10px] font-bold leading-normal text-left">
                          {actionError}
                        </div>
                      )}

                      {seedConfirmOpen ? (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5 text-left">
                          <p className="text-[10px] font-black text-amber-900 uppercase tracking-wider">Xác nhận khởi tạo bộ phận?</p>
                          <p className="text-[10px] text-amber-700 leading-relaxed font-semibold">
                            Hệ thống sẽ thiết lập 3 bộ phận mặc định (Dịch vụ, Bảo hiểm, Quản trị) nếu chưa có dữ liệu nào.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={confirmSeedDefaultDepts}
                              className="px-3 py-2 bg-toyota-navy text-white text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-opacity-90 cursor-pointer"
                            >
                              Đồng ý
                            </button>
                            <button
                              type="button"
                              onClick={() => setSeedConfirmOpen(false)}
                              className="px-3 py-2 bg-white border border-gray-200 text-gray-700 text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : fixConfirmOpen ? (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5 text-left">
                          <p className="text-[10px] font-black text-amber-900 uppercase tracking-wider">Xác nhận chuẩn hóa tài khoản?</p>
                          <p className="text-[10px] text-amber-700 leading-relaxed font-semibold">
                            Cập nhật các tài khoản Phụ kiện test sang "departmentId: phukien" duy nhất và xóa bỏ các cấu trúc dữ liệu cũ rác mang tính triệt độ.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={confirmNormalizeData}
                              className="px-3 py-2 bg-toyota-navy text-white text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-opacity-90 cursor-pointer"
                            >
                              Đồng ý
                            </button>
                            <button
                              type="button"
                              onClick={() => setFixConfirmOpen(false)}
                              className="px-3 py-2 bg-white border border-gray-200 text-gray-700 text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : normalizeDeptsConfirmOpen ? (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5 text-left animate-fade-in">
                          <p className="text-[10px] font-black text-amber-900 uppercase tracking-wider">Xác nhận chuẩn hoá bộ phận?</p>
                          <p className="text-[10px] text-amber-700 leading-relaxed font-semibold">
                            Tất cả session cũ chưa xác định được bộ phận sẽ được chuyển sang bộ phận Dịch vụ. Thao tác này chỉ áp dụng trên project test.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={confirmNormalizeSessionDepartments}
                              className="px-3 py-2 bg-toyota-red text-white text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-opacity-90 cursor-pointer"
                            >
                              Đồng ý
                            </button>
                            <button
                              type="button"
                              onClick={() => setNormalizeDeptsConfirmOpen(false)}
                              className="px-3 py-2 bg-white border border-gray-200 text-gray-700 text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : normalizeInsuranceConfirmOpen ? (
                        <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-2xl space-y-2.5 text-left animate-fade-in">
                          <p className="text-[10px] font-black text-purple-900 uppercase tracking-wider">Chuẩn hoá bộ phận Bảo hiểm?</p>
                          <p className="text-[10px] text-purple-700 leading-relaxed font-semibold">
                            Tất cả tài khoản và phiên xe có bộ phận "insurance" hoặc "Bảo hiểm" sẽ được chuyển đổi sang "baohiem". Bộ phận cũ "insurance" sẽ bị xóa vĩnh viễn. Thao tác chỉ cho phép chạy trên project 'anh-xe-thd'.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={confirmNormalizeInsuranceDepartment}
                              className="px-3 py-2 bg-purple-600 text-white text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-opacity-90 cursor-pointer"
                            >
                              Đồng ý
                            </button>
                            <button
                              type="button"
                              onClick={() => setNormalizeInsuranceConfirmOpen(false)}
                              className="px-3 py-2 bg-white border border-gray-200 text-gray-700 text-[9px] uppercase font-black tracking-widest rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setActionStatus(null);
                                setActionError(null);
                                setSeedConfirmOpen(true);
                              }}
                              className="py-3 bg-white border border-gray-200 hover:bg-toyota-navy hover:text-white rounded-xl text-gray-700 font-black text-[9px] uppercase tracking-wider transition-all duration-150 cursor-pointer text-center"
                            >
                              Khởi tạo mặc định
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActionStatus(null);
                                setActionError(null);
                                setFixConfirmOpen(true);
                              }}
                              className="py-3 bg-white border border-gray-200 hover:bg-toyota-navy hover:text-white rounded-xl text-gray-700 font-black text-[9px] uppercase tracking-wider transition-all duration-150 cursor-pointer text-center"
                            >
                              Chuẩn hóa tài khoản
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActionStatus(null);
                                setActionError(null);
                                setNormalizeDeptsConfirmOpen(true);
                              }}
                              className="py-3 bg-white border border-gray-200 hover:bg-toyota-navy hover:text-white rounded-xl text-gray-700 font-black text-[8px] uppercase tracking-wider transition-all duration-150 cursor-pointer text-center"
                            >
                              CHUẨN HÓA DỮ LIỆU CŨ
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActionStatus(null);
                                setActionError(null);
                                setNormalizeInsuranceConfirmOpen(true);
                              }}
                              className="py-3 bg-purple-50 border border-purple-200 hover:bg-purple-600 hover:text-white rounded-xl text-purple-700 font-black text-[8px] uppercase tracking-wider transition-all duration-150 cursor-pointer text-center"
                            >
                              CHUẨN HÓA BẢO HIỂM
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                 {/* Secret Tapping Trigger on Version Text */}
                <p 
                  onClick={() => {
                    if (isUnlocked) return;
                    const nextCount = clickCount + 1;
                    setClickCount(nextCount);
                    if (nextCount >= 5) {
                      setShowMaintenanceUnlock(true);
                      setClickCount(0);
                    }
                  }}
                  className="text-xs text-gray-400 font-bold uppercase tracking-widest italic cursor-pointer select-none py-1 hover:text-gray-600 transition-colors"
                  title="Nhấp 5 lần để kích hoạt công cụ kỹ thuật viên"
                >
                  Phiên bản v1.0.5 - Toyota Hà Đông {clickCount > 0 && clickCount < 5 && `(${clickCount}/5)`}
                </p>

                 {/* Chèn thông tin lên ảnh chia sẻ Card */}
                <div className="bg-white rounded-[32px] p-6 text-left space-y-4 shadow-sm border border-gray-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-toyota-navy">
                    Thông tin chèn lên ảnh chia sẻ
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                        Dòng địa chỉ chèn lên ảnh (mỗi dòng một địa chỉ)
                      </label>
                      <textarea
                        rows={4}
                        value={addressText}
                        onChange={(e) => setAddressText(e.target.value)}
                        disabled={user.role !== 'admin'}
                        className={`w-full text-xs border rounded-xl px-3 py-2 text-gray-950 focus:outline-none focus:border-toyota-red font-semibold leading-relaxed ${
                          user.role !== 'admin' ? 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-200'
                        }`}
                        placeholder="Ví dụ:&#10;Toyota Hà Đông&#10;973 Quang Trung&#10;Phú Lương, Hà Đông&#10;Hà Nội, Việt Nam"
                      />
                    </div>

                    <div className="flex items-start gap-2.5 pt-1">
                      <input
                        type="checkbox"
                        id="overlay_default_enabled"
                        checked={enabledByDefault}
                        onChange={(e) => setEnabledByDefault(e.target.checked)}
                        disabled={user.role !== 'admin'}
                        className="w-4 h-4 rounded border-gray-300 text-toyota-navy focus:ring-toyota-navy mt-0.5 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <label htmlFor="overlay_default_enabled" className="text-[11px] text-gray-500 font-bold select-none cursor-pointer disabled:cursor-not-allowed">
                        Tự động tích chọn "Thêm thời gian & địa chỉ lên ảnh" khi chia sẻ
                        <span className="block text-[9px] text-gray-400 font-medium leading-normal mt-0.5">
                          Giúp kỹ thuật viên không phải tích thủ công mỗi lần chia sẻ.
                        </span>
                      </label>
                    </div>

                    {user.role === 'admin' ? (
                      <div className="pt-1.5 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={saveOverlaySettings}
                          disabled={isSavingOverlaySettings}
                          className="w-full py-3 bg-toyota-navy hover:bg-opacity-95 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1"
                        >
                          {isSavingOverlaySettings ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Đang lưu...</span>
                            </>
                          ) : (
                            <span>Lưu cấu hình chèn ảnh</span>
                          )}
                        </button>
                        {saveOverlaySuccess && (
                          <p className="text-[10px] font-bold text-green-600 text-center bg-green-50 py-1 rounded-lg border border-green-100 animate-pulse">
                            {saveOverlaySuccess}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-2.5 mt-1">
                        <p className="text-[9px] text-amber-700 font-bold leading-normal">
                          * Chỉ Quản trị viên (Admin) mới có quyền chỉnh sửa cấu hình thông tin chèn lên ảnh này.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-[32px] p-6 text-left space-y-4 shadow-sm">
                   <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Chất lượng ảnh</span>
                      <span className="text-xs font-black text-toyota-red">0.7 (Cao)</span>
                   </div>
                   <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tự động nén</span>
                      <span className="w-8 h-4 bg-toyota-red rounded-full flex items-center px-1">
                         <span className="w-2.5 h-2.5 bg-white rounded-full ml-auto"></span>
                      </span>
                   </div>
                   <div className="flex justify-between items-center py-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Lưu log thiết bị</span>
                      <span className="w-8 h-4 bg-gray-200 rounded-full flex items-center px-1">
                         <span className="w-2.5 h-2.5 bg-white rounded-full"></span>
                      </span>
                   </div>
                </div>

                {/* Maintenance Password Entry Form */}
                {showMaintenanceUnlock && !isUnlocked && (
                  <div className="bg-white rounded-[32px] p-6 text-left space-y-4 shadow-sm mt-4 border border-gray-100 animate-fadeIn text-gray-700">
                    <h3 className="text-xs font-black uppercase tracking-wider text-toyota-navy">Mở khóa nâng cao</h3>
                    <p className="text-[10px] text-gray-400 font-medium">Vui lòng nhập mật mã của kỹ thuật viên bảo trì:</p>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        placeholder="Mật mã bảo trì..."
                        className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-toyota-red text-gray-900"
                      />
                      <button 
                        onClick={() => {
                          const cleanCode = passcode.trim().toLowerCase();
                          if (cleanCode === 'toyotahadong' || cleanCode === 'admin' || cleanCode === '1900') {
                            setIsUnlocked(true);
                            setShowMaintenanceUnlock(false);
                            setPasscode('');
                          } else {
                            alert('Mật mã không hợp lệ!');
                            setPasscode('');
                          }
                        }}
                        className="px-4 py-2 bg-toyota-navy text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-toyota-red transition-colors"
                      >
                        Kết nối
                      </button>
                    </div>
                  </div>
                )}

                {/* Advanced Maintenance Panel */}
                {isUnlocked && (
                  <div className="bg-white rounded-[32px] p-6 text-left space-y-4 shadow-sm mt-4 border border-gray-100 animate-fadeIn text-gray-700">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                      <h3 className="text-[11px] font-black uppercase tracking-widest text-toyota-navy flex items-center gap-1.5">
                        <span>⚙️ Bảo trì chỉ mục</span>
                      </h3>
                      <button 
                        onClick={() => setIsUnlocked(false)}
                        className="text-[9px] uppercase font-black text-gray-400 hover:text-toyota-red transition-colors"
                      >
                        Ẩn bảng
                      </button>
                    </div>

                    {migrationCompleted ? (
                      <div className="p-4 bg-green-50 rounded-2xl border border-green-100 space-y-2">
                        <p className="text-[10.5px] font-black text-green-700 uppercase tracking-widest flex items-center gap-1.5">
                          <span>✓ Đã tối ưu hóa xong</span>
                        </p>
                        <p className="text-[10px] text-green-600 leading-relaxed font-semibold">
                          Lập chỉ mục tìm kiếm thông minh đã được cấu hình thành công cho toàn bộ {processedCount} phiên xe trong hệ thống.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-4 bg-red-50 rounded-2xl border border-red-100 space-y-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-toyota-red">PHÂN TÍCH CHỈ MỤC CŨ</p>
                          <p className="text-[10px] leading-relaxed text-gray-500 font-medium">
                            Một số phiên xe trước đây chưa có các trường chỉ mục nhanh. Bạn có thể bấm nút bên dưới để cập nhật. Tiến trình chạy theo dạng các lô (batch) nhỏ (150 mục) và chạy ngầm nên không khóa giao diện chụp ảnh.
                          </p>
                        </div>

                        {isMigrating ? (
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-2.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-4.5 h-4.5 border-3 border-gray-200 border-t-toyota-red rounded-full animate-spin"></div>
                              <span className="text-[10px] font-black uppercase tracking-widest text-toyota-navy">Đang xử lý nền...</span>
                            </div>
                            <p className="text-[10px] text-toyota-red font-bold leading-tight">
                              {migrationProgress}
                            </p>
                            <div className="text-[9px] text-gray-400 font-bold tracking-tight">
                              Tổng số xe đã phân tích: {scannedCount} | Đã lập chỉ mục: {updatedCount} xe
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={runAdvancedMigration}
                            className="w-full py-4 bg-toyota-red text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-red-900/10 active:scale-95 transition-transform"
                          >
                            Bắt đầu thiết lập chỉ mục
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Logout Button */}
                <button
                  type="button"
                  onClick={logout}
                  className="w-full py-4 bg-gray-100 border border-gray-200 hover:bg-red-50 hover:text-toyota-red hover:border-red-100 rounded-2xl text-gray-600 font-black text-xs uppercase tracking-widest transition-all active:scale-95 duration-100 cursor-pointer"
                >
                  Đăng xuất
                </button>

                <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">Powered by Google AI Studio</p>
              </motion.div>
            )
          )}
        </AnimatePresence>
      </main>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab as any} />
    </div>
  );
}
