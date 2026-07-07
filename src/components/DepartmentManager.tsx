import React, { useState, useEffect } from 'react';
import { 
  Building, Plus, Edit2, Trash2, Lock, Unlock, Loader2, ArrowLeft, 
  CheckCircle, AlertTriangle, Users, Layers, ShieldAlert 
} from 'lucide-react';
import { db, auth } from '../lib/firebase';
import { 
  collection, onSnapshot, query, orderBy, getDocs, where, 
  doc, setDoc, updateDoc, deleteDoc, serverTimestamp, limit 
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

interface Department {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt?: any;
  updatedAt?: any;
  userCount?: number;
  sessionCount?: number;
}

interface DepartmentManagerProps {
  onBack: () => void;
}

export default function DepartmentManager({ onBack }: DepartmentManagerProps) {
  const { user: currentUser } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Create Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newCode, setNewCode] = useState<string>('');
  const [addLoading, setAddLoading] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // Edit Modal
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editLoading, setEditLoading] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  // Status/Activation/Deletion feedback states
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Deletion Modal States
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [selectedDeleteDept, setSelectedDeleteDept] = useState<Department | null>(null);
  const [deleteConfName, setDeleteConfName] = useState<string>('');
  const [deleteChecking, setDeleteChecking] = useState<boolean>(false);
  const [realtimeUserCount, setRealtimeUserCount] = useState<number>(0);
  const [realtimeSessionCount, setRealtimeSessionCount] = useState<number>(0);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);
  const [deleteModalSuccess, setDeleteModalSuccess] = useState<string | null>(null);
  const [deleteModalLoading, setDeleteModalLoading] = useState<boolean>(false);

  // Load departments dynamically of basic fields, then enrich asynchronously
  useEffect(() => {
    setLoading(true);
    const qParts = query(collection(db, 'departments'));
    
    const unsubscribe = onSnapshot(qParts, (snapshot) => {
      try {
        const list: Department[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const docId = docSnap.id;
          list.push({
            id: docId,
            name: data.name || '',
            code: data.code || docId,
            isActive: data.active ?? data.isActive ?? true,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            userCount: 0,
            sessionCount: 0
          });
        });

        // Sort on frontend: prioritize name, then document ID. Documents missing createdAt are preserved and shown.
        list.sort((a, b) => {
          const valA = (a.name || a.id || '').trim().toLowerCase();
          const valB = (b.name || b.id || '').trim().toLowerCase();
          return valA.localeCompare(valB, 'vi', { sensitivity: 'base' });
        });

        setDepartments(list);
        setError(null);
        setLoading(false);

        // Fetch counts asynchronously is safe and avoids unhandled async rejections in onSnapshot callback
        list.forEach((dept) => {
          // Count users belonging to this department
          const uQuery = query(collection(db, 'users'), where('departmentId', '==', dept.id));
          getDocs(uQuery).then((uSnap) => {
            // Count sessions belonging to this department (by departmentId)
            const sQueryId = query(collection(db, 'cars'), where('departmentId', '==', dept.id), limit(1));
            getDocs(sQueryId).then((sSnapId) => {
              // Backward compatibility check
              const sQueryLegacy = query(collection(db, 'cars'), where('department', '==', dept.id), limit(1));
              getDocs(sQueryLegacy).then((sSnapLegacy) => {
                const hasSessions = !sSnapId.empty || !sSnapLegacy.empty;
                setDepartments(prev => prev.map(d => {
                  if (d.id === dept.id) {
                    return {
                      ...d,
                      userCount: uSnap.size,
                      sessionCount: hasSessions ? 1 : 0
                    };
                  }
                  return d;
                }));
              }).catch(err => console.warn("Error legacy sessions", dept.id, err));
            }).catch(err => console.warn("Error id sessions", dept.id, err));
          }).catch(err => console.warn("Error userCount", dept.id, err));
        });

      } catch (err: any) {
        console.error("Error subscribing to departments:", err);
        setError("Không thể tải danh sách bộ phận: " + err.message);
        setLoading(false);
      }
    }, (err) => {
      console.error("onSnapshot error departments:", err);
      setError("Bạn không có quyền xem cấu hình bộ phận.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Normalize code string helpers (lowercase, no accents, no whitespace)
  const sanitizeCodeInput = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')                     // separates diacritical signs from letters
      .replace(/[\u0300-\u036f]/g, '')     // Strips accents
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9_]/g, '')          // keeps only letters, digits, and underscores
      .trim();
  };

  // Add Department Request
  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = sanitizeCodeInput(newCode);
    const cleanName = newName.trim();

    if (!cleanName) {
      setAddError("Tên bộ phận không được để trống!");
      return;
    }
    if (!cleanCode) {
      setAddError("Mã bộ phận không hợp lệ!");
      return;
    }

    setAddLoading(true);
    setAddError(null);
    setAddSuccess(null);

    try {
      // Check for code duplicates locally & on Firestore
      const docRef = doc(db, 'departments', cleanCode);
      const snap = await getDocs(query(collection(db, 'departments'), where('code', '==', cleanCode), limit(1)));
      
      if (!snap.empty) {
        setAddError("Mã bộ phận này đã tồn tại trong hệ thống!");
        setAddLoading(false);
        return;
      }

      await setDoc(docRef, {
        name: cleanName,
        code: cleanCode,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setAddSuccess("Đã tạo bộ phận mới thành công!");
      setTimeout(() => {
        setShowAddModal(false);
        setNewName('');
        setNewCode('');
        setAddSuccess(null);
      }, 1500);

    } catch (err: any) {
      console.error("Error creating department:", err);
      setAddError("Có lỗi xảy ra: " + err.message);
    } finally {
      setAddLoading(false);
    }
  };

  // Open Edit Dialog
  const handleOpenEdit = (dept: Department) => {
    setEditingDept(dept);
    setEditName(dept.name);
    setEditError(null);
    setEditSuccess(null);
  };

  // Submit Edit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDept) return;
    const cleanName = editName.trim();

    if (!cleanName) {
      setEditError("Tên bộ phận không được bỏ trống!");
      return;
    }

    setEditLoading(true);
    setEditError(null);
    setEditSuccess(null);

    try {
      const docRef = doc(db, 'departments', editingDept.id);
      await updateDoc(docRef, {
        name: cleanName,
        updatedAt: serverTimestamp()
      });

      setEditSuccess("Đã cập nhật tên bộ phận!");
      setTimeout(() => {
        setEditingDept(null);
        setEditSuccess(null);
      }, 1200);

    } catch (err: any) {
      console.error("Error updating department name:", err);
      setEditError("Lỗi cập nhật: " + err.message);
    } finally {
      setEditLoading(false);
    }
  };

  // Toggle activation (Lock/Unlock)
  const handleToggleActive = async (dept: Department) => {
    if (dept.id === 'admin' || dept.code === 'admin') {
      setActionError("Bộ phận Quản trị (admin) là bắt buộc và không thể khóa!");
      setTimeout(() => setActionError(null), 3000);
      return;
    }

    setTogglingId(dept.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      const nextActive = !dept.isActive;
      const docRef = doc(db, 'departments', dept.id);
      await updateDoc(docRef, {
        active: nextActive,
        updatedAt: serverTimestamp()
      });

      setActionSuccess(`Đã ${nextActive ? "kích hoạt lại" : "khóa tạm thời"} bộ phận ${dept.name}.`);
      setTimeout(() => setActionSuccess(null), 2000);
    } catch (err: any) {
      console.error("Error toggling department active state:", err);
      setActionError("Lỗi đổi trạng thái hoạt động: " + err.message);
    } finally {
      setTogglingId(null);
    }
  };

  // Translate secure firestore errors
  const translateFirestoreError = (err: any) => {
    if (!err) return "Đã xảy ra lỗi không xác định.";
    const code = err.code || err.message;
    if (code === 'permission-denied') {
      return "Lỗi phân quyền (permission-denied): Chỉ Admin được kích hoạt và hoạt động có quyền thao tác.";
    }
    if (code === 'not-found') {
      return "Lỗi không tìm thấy (not-found): Bộ phận không tồn tại trên hệ thống.";
    }
    if (code === 'failed-precondition') {
      return "Lỗi điều kiện tiên quyết (failed-precondition): Yêu cầu hệ thống chưa thỏa mãn.";
    }
    return `Lỗi hệ thống Firestore: ${err.message || code}`;
  };

  // Trash click entry point with immediate modal response (non-blocking)
  const handleTrashClick = async (dept: Department) => {
    setActionError(null);
    setActionSuccess(null);

    const isAdminDept = dept.id === 'admin' || dept.code === 'admin';
    const isCurrentAdminDept = dept.id === (currentUser?.departmentId || currentUser?.department) || 
                               dept.code === (currentUser?.departmentId || currentUser?.department);

    if (isAdminDept) {
      setActionError("Bộ phận Quản trị (admin) là mặc định của hệ thống và không thể xóa!");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (isCurrentAdminDept) {
      setActionError("Không được xóa bộ phận của chính tài khoản Admin đang đăng nhập!");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSelectedDeleteDept(dept);
    setDeleteConfName('');
    setDeleteChecking(true);
    setDeleteModalError(null);
    setDeleteModalSuccess(null);
    setDeleteModalLoading(false);
    setShowDeleteModal(true);

    try {
      // Query database counts for both users and sessions in cars
      const [uSnap, sSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('departmentId', '==', dept.id))),
        getDocs(query(collection(db, 'cars'), where('departmentId', '==', dept.id)))
      ]);

      setRealtimeUserCount(uSnap.size);
      setRealtimeSessionCount(sSnap.size);
    } catch (err: any) {
      console.error("Error checking references:", err);
      setDeleteModalError("Lỗi hệ thống: Không thể kết nối để kiểm tra số tài khoản và phiên xe. " + (err.message || err));
    } finally {
      setDeleteChecking(false);
    }
  };

  // Submit secure deletion
  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeleteDept) return;

    if (realtimeUserCount > 0 || realtimeSessionCount > 0) {
      setDeleteModalError(`Không thể xóa bộ phận này vì đang có ${realtimeUserCount} tài khoản và ${realtimeSessionCount} phiên xe. Hãy khóa bộ phận thay vì xóa.`);
      return;
    }

    if (deleteConfName.trim().toLowerCase() !== selectedDeleteDept.name.trim().toLowerCase()) {
      setDeleteModalError("Tên bộ phận xác nhận không khớp!");
      return;
    }

    setDeleteModalLoading(true);
    setDeleteModalError(null);
    setDeleteModalSuccess(null);

    try {
      const docRef = doc(db, 'departments', selectedDeleteDept.id);
      await deleteDoc(docRef);

      setDeleteModalSuccess("Đã xóa bộ phận thành công.");
      setActionSuccess("Đã xóa bộ phận thành công.");
      setTimeout(() => setActionSuccess(null), 3000);

      setTimeout(() => {
        setShowDeleteModal(false);
        setSelectedDeleteDept(null);
        setDeleteConfName('');
      }, 1500);

    } catch (err: any) {
      console.error("Error executing delete:", err);
      const translated = translateFirestoreError(err);
      setDeleteModalError(translated);
    } finally {
      setDeleteModalLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6 px-4 py-2 text-gray-900">
      
      {/* Header back button layout */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="p-2.5 bg-white hover:bg-gray-100 text-gray-700 rounded-2xl border border-gray-150 transition-all cursor-pointer flex items-center justify-center active:scale-95 shadow-sm"
          title="Quay lại cài đặt"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="text-right">
          <h2 className="text-sm font-black text-toyota-navy uppercase tracking-tight flex items-center gap-1.5 justify-end">
            <Building size={14} className="text-toyota-red" />
            Quản Lý Bộ Phận
          </h2>
          <p className="text-[9px] text-gray-400 font-extrabold uppercase tracking-widest">Thiết lập tổ chức doanh nghiệp động</p>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-[24px] p-5 text-center space-y-3">
          <ShieldAlert className="mx-auto text-toyota-red" size={28} />
          <p className="text-xs font-black text-toyota-red uppercase tracking-wider">Lỗi Phân Quyền Hoặc Kết Nối</p>
          <p className="text-[11px] leading-relaxed text-gray-500 font-semibold">{error}</p>
          <button 
            type="button" 
            onClick={onBack} 
            className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-black text-[9px] uppercase tracking-wider hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Quay lại Cài Đặt
          </button>
        </div>
      ) : (
        <div className="space-y-4 animate-fadeIn">
          
          {/* Top Actions: Total and Add Department */}
          <div className="flex justify-between items-center bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
            <div>
              <span className="text-[8px] uppercase font-black text-gray-400 tracking-wider block">Tổng số bộ phận</span>
              <span className="text-lg font-black text-toyota-navy font-mono">{departments.length}</span>
            </div>
            {currentUser?.role === 'admin' && (
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(true);
                  setAddError(null);
                  setAddSuccess(null);
                }}
                className="flex items-center gap-1 px-4 py-2.5 bg-toyota-red hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-sm active:scale-95"
              >
                <Plus size={12} />
                Thêm bộ phận
              </button>
            )}
          </div>

          {/* Toast Feebdack alerts */}
          {actionError && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-2xl text-toyota-red text-[10px] uppercase tracking-wide font-black text-left flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-toyota-red" />
              <span>{actionError}</span>
            </div>
          )}
          {actionSuccess && (
            <div className="p-3 bg-green-50 border border-green-100 rounded-2xl text-green-700 text-[10px] uppercase tracking-wide font-black text-center flex items-center justify-center gap-1.5">
              <CheckCircle size={14} />
              <span>{actionSuccess}</span>
            </div>
          )}

          {/* Department List Grid */}
          {loading ? (
            <div className="py-20 text-center space-y-2">
              <Loader2 className="animate-spin text-toyota-red mx-auto" size={24} />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Đang tải dữ liệu cấu trúc bộ phận...</p>
            </div>
          ) : departments.length === 0 ? (
            <div className="bg-white rounded-[32px] p-10 border border-gray-100 text-center text-gray-400">
              <Layers size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-xs font-bold uppercase tracking-wider">Chưa cấu trúc bộ phận nào</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {departments.map((dept) => {
                const isAdminDept = dept.id === 'admin';
                return (
                  <div 
                    key={dept.id} 
                    className={`bg-white rounded-[24px] border transition-all p-4.5 space-y-3 ${
                      !dept.isActive 
                        ? "border-gray-200 bg-gray-50/50" 
                        : "border-gray-100 hover:border-gray-200 shadow-sm"
                    }`}
                  >
                    {/* Primary Row: Name & ID Code */}
                    <div className="flex items-start justify-between">
                      <div className="text-left space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-black text-toyota-navy uppercase tracking-tight">
                            {dept.name}
                          </h4>
                          {isAdminDept && (
                            <span className="text-[7px] bg-toyota-navy text-white font-black uppercase px-1.5 py-0.5 rounded leading-none">
                              Hệ thống
                            </span>
                          )}
                          {!dept.isActive && (
                            <span className="text-[7px] bg-red-50 text-toyota-red border border-red-100 font-black uppercase px-1.5 py-0.5 rounded leading-none">
                              Đã khóa
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-gray-400 font-mono font-bold tracking-tight">Mã: {dept.code}</p>
                      </div>

                      {/* Right top action switches */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(dept)}
                          className="p-1.5 text-gray-400 hover:text-toyota-navy hover:bg-gray-50 rounded-lg transition-transform cursor-pointer"
                          title="Sửa tên hiển thị"
                        >
                          <Edit2 size={13} />
                        </button>
                        
                        {!isAdminDept && (
                          <button
                            type="button"
                            disabled={togglingId === dept.id}
                            onClick={() => handleToggleActive(dept)}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              dept.isActive 
                                ? "text-gray-400 hover:text-red-600 hover:bg-red-50" 
                                : "text-green-600 hover:bg-green-50"
                            }`}
                            title={dept.isActive ? "Khóa bộ phận" : "Kích hoạt bộ phận"}
                          >
                            {togglingId === dept.id ? (
                              <Loader2 className="animate-spin" size={13} />
                            ) : dept.isActive ? (
                              <Lock size={13} />
                            ) : (
                              <Unlock size={13} />
                            )}
                          </button>
                        )}

                        {!isAdminDept && (
                          <button
                            type="button"
                            onClick={() => handleTrashClick(dept)}
                            className="p-1.5 text-gray-400 hover:text-toyota-red hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Xóa bộ phận"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Meta statistics row */}
                    <div className="flex items-center gap-4 pt-1.5 border-t border-gray-50 text-[10px] text-gray-500 font-semibold font-mono">
                      <div className="flex items-center gap-1">
                        <Users size={12} className="text-gray-400" />
                        <span>Tài khoản: <strong className="text-toyota-navy font-bold font-sans">{dept.userCount || 0}</strong></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Building size={12} className="text-gray-400" />
                        <span>Đã có phiên xe: <strong className="text-toyota-navy font-bold">{dept.sessionCount ? "Có" : "Không"}</strong></span>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}

          {/* Modal helper 1: ADD DEPARTMENT */}
          {showAddModal && (
            <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
              <form onSubmit={handleAddDepartment} className="bg-white rounded-[32px] w-full max-w-sm p-6 space-y-5 shadow-2xl border border-gray-100 animate-scaleUp">
                
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div className="text-left space-y-0.5">
                    <h3 className="text-xs font-black text-toyota-navy uppercase tracking-tight">Thêm Bộ Phận Mới</h3>
                    <p className="text-[9px] uppercase tracking-widest font-black text-gray-400">Kiểm soát phòng ban & phân tách dữ liệu</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setShowAddModal(false)}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full"
                  >
                    <ArrowLeft size={16} />
                  </button>
                </div>

                <div className="space-y-4 text-left">
                  {/* Department Name input */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Tên bộ phận (ví dụ: Đồng sơn)</label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nhập tên bộ phận hiển thị..."
                      className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-toyota-navy rounded-xl text-xs font-bold outline-none"
                    />
                  </div>

                  {/* Department Name code identifier */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Mã bộ phận (lowercase, viết liền, không dấu)</label>
                    <input
                      type="text"
                      required
                      value={newCode}
                      onChange={(e) => setNewCode(sanitizeCodeInput(e.target.value))}
                      placeholder="ví dụ: bodyshop"
                      className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-toyota-navy rounded-xl text-xs font-mono font-bold outline-none"
                    />
                    <p className="text-[8px] text-gray-400 font-semibold italic">Tự động chuyển thành chữ thường, xóa khoảng trắng và ký tự có vết.</p>
                  </div>
                </div>

                {addError && (
                  <div className="p-2.5 bg-red-50 text-toyota-red text-[9px] font-black uppercase tracking-wide rounded-xl border border-red-100 text-center">
                    {addError}
                  </div>
                )}
                {addSuccess && (
                  <div className="p-2.5 bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-wide rounded-xl border border-green-100 text-center flex items-center justify-center gap-1">
                    <CheckCircle size={12} />
                    {addSuccess}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={addLoading}
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-3 border border-gray-200 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer text-center"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={addLoading || !newName.trim() || !newCode.trim()}
                    className="flex-1 py-3 bg-toyota-red hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {addLoading && <Loader2 className="animate-spin" size={10} />}
                    Tạo bộ phận
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Modal helper 2: EDIT DEPARTMENT */}
          {editingDept && (
            <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
              <form onSubmit={handleEditSubmit} className="bg-white rounded-[32px] w-full max-w-sm p-6 space-y-5 shadow-2xl border border-gray-100 animate-scaleUp">
                
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div className="text-left space-y-0.5">
                    <h3 className="text-xs font-black text-toyota-navy uppercase tracking-tight">Sửa Tên Bộ Phận</h3>
                    <p className="text-[9px] uppercase tracking-widest font-black text-gray-400">Điều chỉnh tên gọi hiển thị phòng ban</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setEditingDept(null)}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full"
                  >
                    <ArrowLeft size={16} />
                  </button>
                </div>

                <div className="space-y-4 text-left">
                  {/* Readonly code identifier */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Mã bộ phận (Không thể cấu hình lại)</label>
                    <div className="w-full p-3 bg-gray-150 border border-gray-200 text-gray-400 rounded-xl text-xs font-mono font-black select-all">
                      {editingDept.code}
                    </div>
                  </div>

                  {/* Name value field */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider font-sans">Tên bộ phận mới</label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nhập tên mới..."
                      className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-toyota-navy rounded-xl text-xs font-bold outline-none"
                    />
                  </div>
                </div>

                {editError && (
                  <div className="p-2.5 bg-red-50 text-toyota-red text-[9px] font-black uppercase tracking-wide rounded-xl border border-red-100 text-center">
                    {editError}
                  </div>
                )}
                {editSuccess && (
                  <div className="p-2.5 bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-wide rounded-xl border border-green-100 text-center flex items-center justify-center gap-1">
                    <CheckCircle size={12} />
                    {editSuccess}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={editLoading}
                    onClick={() => setEditingDept(null)}
                    className="flex-1 py-3 border border-gray-200 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer text-center"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={editLoading || !editName.trim()}
                    className="flex-1 py-3 bg-toyota-red hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    {editLoading && <Loader2 className="animate-spin" size={10} />}
                    Cập nhật
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Modal helper: SECURE DELETE DEPARTMENT */}
          {showDeleteModal && selectedDeleteDept && (
            <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
              <form onSubmit={handleConfirmDelete} className="bg-white rounded-[32px] w-full max-w-sm p-6 space-y-5 shadow-2xl border border-gray-100 animate-scaleUp text-gray-950">
                
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div className="text-left space-y-0.5">
                    <h3 className="text-xs font-black text-toyota-navy uppercase tracking-tight flex items-center gap-1.5">
                      <Trash2 size={14} className="text-toyota-red animate-pulse" />
                      Xác nhận xóa bộ phận
                    </h3>
                    <p className="text-[9px] uppercase tracking-widest font-black text-gray-400">Kiểm tra an toàn cấu trúc trước khi xóa</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => {
                      if (!deleteModalLoading) {
                        setShowDeleteModal(false);
                        setSelectedDeleteDept(null);
                      }
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full cursor-pointer"
                  >
                    <ArrowLeft size={16} />
                  </button>
                </div>

                {deleteChecking ? (
                  <div className="py-8 text-center space-y-2">
                    <Loader2 className="animate-spin text-toyota-red mx-auto font-black" size={20} />
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Đang kiểm tra dữ liệu liên quan...</p>
                  </div>
                ) : (
                  <div className="space-y-4 text-left font-sans">
                    
                    {/* Information about selected department */}
                    <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-100 space-y-2 text-xs font-semibold">
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-[10px] uppercase">Tên bộ phận:</span>
                        <span className="font-extrabold text-toyota-navy uppercase">{selectedDeleteDept.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-[10px] uppercase">Mã bộ phận:</span>
                        <span className="font-mono text-toyota-navy font-bold">{selectedDeleteDept.code}</span>
                      </div>
                    </div>

                    {/* Check statistics alerts */}
                    {(realtimeUserCount > 0 || realtimeSessionCount > 0) ? (
                      <div className="p-4 bg-red-50 border border-red-150 rounded-[20px] text-toyota-red space-y-2.5">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-toyota-red" />
                          <p className="text-[11px] font-bold leading-relaxed">
                            {`Không thể xóa bộ phận này vì đang có ${realtimeUserCount} tài khoản và ${realtimeSessionCount} phiên xe. Hãy khóa bộ phận thay vì xóa.`}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-3.5 bg-green-50/60 border border-green-100 rounded-2xl text-green-700 text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1.5 justify-center">
                          <CheckCircle size={14} className="text-green-600" />
                          Bộ phận trống, sẵn sàng xóa an toàn
                        </div>

                        {/* Confirmation name input */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider block">
                            Để xác nhận, vui lòng nhập chính xác tên bộ phận <strong className="text-toyota-navy font-black">"{selectedDeleteDept.name}"</strong>:
                          </label>
                          <input
                            type="text"
                            required
                            value={deleteConfName}
                            onChange={(e) => setDeleteConfName(e.target.value)}
                            placeholder="Nhập tên bộ phận..."
                            className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-toyota-navy rounded-xl text-xs font-bold outline-none"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {deleteModalError && (
                  <div className="p-3 bg-red-50 text-toyota-red text-[10px] font-black uppercase tracking-wide rounded-2xl border border-red-100 text-left">
                    {deleteModalError}
                  </div>
                )}
                {deleteModalSuccess && (
                  <div className="p-3 bg-green-50 text-green-700 text-[10px] font-black uppercase tracking-wide rounded-2xl border border-green-100 text-center flex items-center justify-center gap-1.5">
                    <CheckCircle size={14} className="text-green-600" />
                    {deleteModalSuccess}
                  </div>
                )}

                <div className="flex gap-2.5">
                  <button
                    type="button"
                    disabled={deleteModalLoading}
                    onClick={() => {
                      setShowDeleteModal(false);
                      setSelectedDeleteDept(null);
                    }}
                    className="flex-1 py-3 border border-gray-100 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer text-center"
                  >
                    Hủy bỏ
                  </button>
                  
                  {!(realtimeUserCount > 0 || realtimeSessionCount > 0) && (
                    <button
                      type="submit"
                      disabled={
                        deleteModalLoading || 
                        deleteChecking || 
                        deleteConfName.trim().toLowerCase() !== selectedDeleteDept.name.trim().toLowerCase()
                      }
                      className="flex-1 py-3 bg-toyota-red hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {deleteModalLoading && <Loader2 className="animate-spin" size={10} />}
                      Xác nhận xóa
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
