import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, where, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { db, auth, functions, app } from '../lib/firebase';
import { normalizeDepartmentValue } from '../lib/departmentResolver';
import { httpsCallable } from 'firebase/functions';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { 
  Search, UserPlus, Edit2, Key, Lock, Unlock, Check, X, Shield, Users, 
  Clock, ArrowLeft, Loader2, Mail, CheckCircle, Trash2, AlertTriangle
} from 'lucide-react';

interface ManagedUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  department?: string;
  departmentId?: string;
  isActive: boolean;
  canDeleteSession: boolean;
  createdAt: any;
  updatedAt: any;
}

interface AccountManagerProps {
  onBack: () => void;
}

export default function AccountManager({ onBack }: AccountManagerProps) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Dynamic departments states
  const [deptNames, setDeptNames] = useState<Record<string, string>>({
    admin: 'Quản trị',
    service: 'Dịch vụ',
    baohiem: 'Bảo hiểm'
  });
  const [activeDepts, setActiveDepts] = useState<{ id: string; name: string }[]>([]);
  const [dbDeptIds, setDbDeptIds] = useState<string[]>([]);

  // Filters
  const [filterDept, setFilterDept] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'locked'>('all');

  // Modals state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);

  // Form states - Add
  const [addName, setAddName] = useState<string>('');
  const [addEmail, setAddEmail] = useState<string>('');
  const [addPassword, setAddPassword] = useState<string>('');
  const [addDept, setAddDept] = useState<string>('');
  const [addRole, setAddRole] = useState<'admin' | 'user'>('user');
  const [addCanDelete, setAddCanDelete] = useState<boolean>(false);

  // Form states - Edit
  const [editName, setEditName] = useState<string>('');
  const [editDept, setEditDept] = useState<string>('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editCanDelete, setEditCanDelete] = useState<boolean>(false);

  // Submit and feedback states
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Lock/Unlock Custom Dialog states
  const [statusDialogUser, setStatusDialogUser] = useState<ManagedUser | null>(null);
  const [statusDialogSubmitting, setStatusDialogSubmitting] = useState<boolean>(false);
  const [statusDialogError, setStatusDialogError] = useState<string | null>(null);
  const [statusDialogSuccess, setStatusDialogSuccess] = useState<string | null>(null);

  // Delete User Custom Dialog states
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);
  const [deleteDialogLoading, setDeleteDialogLoading] = useState<boolean>(false);
  const [deleteDialogSubmitting, setDeleteDialogSubmitting] = useState<boolean>(false);
  const [deleteHasSessions, setDeleteHasSessions] = useState<boolean>(false);
  const [deleteEmailConfirm, setDeleteEmailConfirm] = useState<string>('');
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);
  const [deleteDialogSuccess, setDeleteDialogSuccess] = useState<string | null>(null);

  // Subscribe to real-time departments to build name map & options
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'departments'), (snap) => {
      const names: Record<string, string> = {
        admin: 'Quản trị',
        service: 'Dịch vụ',
        baohiem: 'Bảo hiểm'
      };
      const activeList: { id: string; name: string }[] = [];
      const ids: string[] = [];
      const seenIds = new Set<string>();

      // Seed default system-known IDs
      seenIds.add('admin');
      seenIds.add('service');
      seenIds.add('baohiem');

      names['service'] = 'Dịch vụ';
      names['baohiem'] = 'Bảo hiểm';

      snap.forEach((doc) => {
        const data = doc.data();
        const rawId = doc.id;
        const normalizedId = normalizeDepartmentValue(rawId) || rawId;

        if (normalizedId === 'admin') return;

        // Populate display names securely
        const displayNameValue = data.name || (normalizedId === 'baohiem' ? 'Bảo hiểm' : normalizedId === 'service' ? 'Dịch vụ' : normalizedId);
        
        // Prevent display of duplicate "Bảo hiểm" buttons with different names
        names[normalizedId] = displayNameValue;

        if (!ids.includes(normalizedId)) {
          ids.push(normalizedId);
        }

        const isDeptActive = data.active ?? data.isActive ?? true;
        if (isDeptActive !== false) {
          if (!activeList.some(item => item.id === normalizedId)) {
            activeList.push({ id: normalizedId, name: displayNameValue });
          }
        }
      });

      // Always ensure service and baohiem exist as standard IDs
      if (!ids.includes('service')) ids.push('service');
      if (!ids.includes('baohiem')) ids.push('baohiem');
      
      if (!activeList.some(item => item.id === 'service')) {
        activeList.push({ id: 'service', name: 'Dịch vụ' });
      }
      if (!activeList.some(item => item.id === 'baohiem')) {
        activeList.push({ id: 'baohiem', name: 'Bảo hiểm' });
      }

      setDeptNames(names);
      setActiveDepts(activeList);
      setDbDeptIds(ids);
    });
    return () => unsubscribe();
  }, []);

  // Sync state helpers when role or active departments list updates
  useEffect(() => {
    if (addRole === 'admin') {
      setAddDept('admin');
    } else if (addDept === 'admin') {
      setAddDept('');
    }
  }, [addRole]);

  useEffect(() => {
    if (editRole === 'admin') {
      setEditDept('admin');
    } else if (editDept === 'admin') {
      setEditDept('');
    }
  }, [editRole]);

  // Subscribe to real-time users collection
  useEffect(() => {
    setLoading(true);
    const usersQuery = query(collection(db, 'users'));
    
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const usersData: ManagedUser[] = [];
      snapshot.forEach((doc) => {
        usersData.push({ uid: doc.id, ...doc.data() as any });
      });
      
      // Sort users by createdAt (newest first)
      usersData.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (typeof a.createdAt === 'number' ? a.createdAt : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (typeof b.createdAt === 'number' ? b.createdAt : 0);
        return timeB - timeA;
      });

      setUsers(usersData);
      setLoading(false);
    }, (error) => {
      console.error("[SYNC USERS ERROR]", error);
      setActionError("Lỗi đồng bộ danh sách tài khoản: " + error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter and search user computation
  const filteredUsers = users.filter((u) => {
    const textMatch = 
      (u.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const userDeptId = normalizeDepartmentValue((u as any).departmentId || u.department) || "";
    const filterDeptNormalized = normalizeDepartmentValue(filterDept) || filterDept;
    const deptMatch = 
      filterDept === 'all' || 
      userDeptId === filterDeptNormalized;

    const statusMatch = 
      filterStatus === 'all' || 
      (filterStatus === 'active' && u.isActive !== false) ||
      (filterStatus === 'locked' && u.isActive === false);

    return textMatch && deptMatch && statusMatch;
  });

  // Handle Create Account (via Firebase Callable functions)
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    if (!addName.trim()) {
      setActionError('Họ và tên không được để trống.');
      return;
    }
    if (!addEmail.trim()) {
      setActionError('Email không được để trống.');
      return;
    }
    if (addPassword.length < 6) {
      setActionError('Mật khẩu tạm thời phải tối thiểu 6 ký tự.');
      return;
    }

    setSubmitting(true);
    try {
      const createManagedUserCallable = httpsCallable(functions, 'createManagedUser');
      const response = await createManagedUserCallable({
        email: addEmail.trim(),
        password: addPassword,
        displayName: addName.trim(),
        role: addRole,
        departmentId: normalizeDepartmentValue(addDept) || addDept,
        canDeleteSession: addCanDelete
      });

      if (response.data) {
        const resData = response.data as { success: boolean; uid: string };
        setActionSuccess('Đã tạo tài khoản thành công.');
        // Reset state
        setAddName('');
        setAddEmail('');
        setAddPassword('');
        setAddDept('');
        setAddRole('user');
        setAddCanDelete(false);
        setTimeout(() => {
          setShowAddModal(false);
          setActionSuccess(null);
        }, 1500);
      }
    } catch (error: any) {
      console.error("[CREATE USER ERROR]", {
        code: error.code,
        message: error.message,
        details: error.details,
        urlOrRegion: "asia-southeast1",
        targetHost: "asia-southeast1-anh-xe-thd.cloudfunctions.net"
      });
      setActionError(error.message || 'Lỗi không xác định khi tạo tài khoản.');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Dialog
  const openEditModal = (u: ManagedUser) => {
    setSelectedUser(u);
    setEditName(u.displayName || '');
    setEditDept(u.departmentId || u.department || '');
    setEditRole(u.role || 'user');
    setEditCanDelete(u.canDeleteSession || false);
    setActionError(null);
    setActionSuccess(null);
    setShowEditModal(true);
  };

  // Handle Edit Account (via Firebase Callable functions)
  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setActionError(null);
    setActionSuccess(null);

    if (!editName.trim()) {
      setActionError('Họ và tên không được để trống.');
      return;
    }

    setSubmitting(true);
    try {
      const updateCallable = httpsCallable(functions, 'updateManagedUser');
      await updateCallable({
        uid: selectedUser.uid,
        displayName: editName.trim(),
        role: editRole,
        departmentId: normalizeDepartmentValue(editDept) || editDept,
        canDeleteSession: editCanDelete,
        isActive: selectedUser.isActive !== false
      });

      setActionSuccess('Cập nhật thông tin tài khoản thành công.');
      setTimeout(() => {
        setShowEditModal(false);
        setActionSuccess(null);
        setSelectedUser(null);
      }, 1500);
    } catch (error: any) {
      console.error("[EDIT USER ERROR]", {
        code: error.code,
        message: error.message,
        details: error.details
      });
      setActionError(error.message || 'Lỗi cập nhật tài khoản.');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle user active status (Lock/Unlock)
  const handleToggleStatus = (user: ManagedUser) => {
    if (user.uid === currentUser?.uid) {
      alert("Bạn không thể tự khóa tài khóa quản trị của chính mình!");
      return;
    }

    setStatusDialogUser(user);
    setStatusDialogError(null);
    setStatusDialogSuccess(null);
    setStatusDialogSubmitting(false);
  };

  const submitToggleStatus = async () => {
    if (!statusDialogUser) return;
    setStatusDialogSubmitting(true);
    setStatusDialogError(null);
    setStatusDialogSuccess(null);

    const actionText = statusDialogUser.isActive === false ? 'mở khóa' : 'khóa';

    try {
      const setStatusCallable = httpsCallable(functions, 'setManagedUserStatus');
      await setStatusCallable({
        uid: statusDialogUser.uid,
        isActive: statusDialogUser.isActive === false
      });

      setStatusDialogSuccess(statusDialogUser.isActive === false ? "Đã mở khóa tài khoản." : "Đã khóa tài khoản.");
      setTimeout(() => {
        setStatusDialogUser(null);
        setStatusDialogSuccess(null);
      }, 1500);
    } catch (error: any) {
      console.error("[TOGGLE STATUS ERROR]", {
        code: error.code,
        message: error.message,
        details: error.details
      });
      setStatusDialogError(error.message || 'Lỗi đổi trạng thái tài khoản.');
    } finally {
      setStatusDialogSubmitting(false);
    }
  };

  // Delete flow methods
  const handleInitiateDelete = async () => {
    if (!selectedUser) return;
    setActionError(null);
    setActionSuccess(null);
    setDeleteDialogLoading(true);
    try {
      const q = query(collection(db, 'cars'), where('createdByUid', '==', selectedUser.uid), limit(1));
      const snap = await getDocs(q);
      const hasSessions = !snap.empty;

      setDeleteHasSessions(hasSessions);
      setDeleteEmailConfirm('');
      setDeleteDialogError(null);
      setDeleteDialogSuccess(null);
      setShowDeleteConfirmModal(true);
    } catch (err: any) {
      console.error("[INITIATE DELETE ERROR]", err);
      setActionError("Không thể chuẩn bị xóa tài khoản: " + err.message);
    } finally {
      setDeleteDialogLoading(false);
    }
  };

  const submitDeleteUser = async () => {
    if (!selectedUser) return;
    if (deleteEmailConfirm.trim().toLowerCase() !== selectedUser.email.toLowerCase()) {
      setDeleteDialogError("Email nhập vào không trùng khớp!");
      return;
    }

    setDeleteDialogSubmitting(true);
    setDeleteDialogError(null);
    try {
      const deleteCallable = httpsCallable(functions, 'deleteManagedUser');
      await deleteCallable({
        targetUid: selectedUser.uid
      });

      setDeleteDialogSuccess("Đã xóa tài khoản. Dữ liệu phiên xe cũ vẫn được giữ lại.");

      // Auto close after 1.5s
      setTimeout(() => {
        setShowDeleteConfirmModal(false);
        setShowEditModal(false);
        setSelectedUser(null);
        setDeleteDialogSuccess(null);
      }, 1500);

    } catch (error: any) {
      console.error("[DELETE USER ERROR]", {
        code: error.code,
        message: error.message,
        details: error.details
      });
      
      let errorMsg = error.message || "Lỗi xóa tài khoản.";
      if (error.details) {
        const detailsStr = typeof error.details === "object" ? JSON.stringify(error.details) : String(error.details);
        errorMsg += ` - Chi tiết: ${detailsStr}`;
      }
      if (error.code) {
        errorMsg += ` [Code: ${error.code}]`;
      }
      setDeleteDialogError(errorMsg);
    } finally {
      setDeleteDialogSubmitting(false);
    }
  };

  // Trigger Send Password Reset Email from Auth
  const handleResetPassword = async (user: ManagedUser) => {
    if (!window.confirm(`Hệ thống sẽ gửi một email đặt lại mật khẩu từ Google Auth tới địa chỉ ${user.email}. Tiếp tục?`)) {
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      alert("Đã gửi email đặt lại mật khẩu thành công.");
    } catch (err: any) {
      console.error("[PASSWORD RESET ERROR]", err);
      alert("Lỗi gửi email đặt lại mật khẩu: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      
      {/* Header layout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-xl transition-all cursor-pointer text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-black text-toyota-navy uppercase tracking-tighter">Quản Lý Tài Khoản</h1>
            <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Danh mục kỹ thuật viên & phân quyền</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setActionError(null);
            setActionSuccess(null);
            setShowAddModal(true);
          }}
          className="flex items-center justify-center gap-1.5 px-4 py-3 bg-toyota-red text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-red-700 active:scale-95 transition-all shadow-md self-start sm:self-auto cursor-pointer"
        >
          <UserPlus size={14} />
          Thêm tài khoản
        </button>
      </div>

      {/* Toolbar - Search & Filters */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
        
        {/* Search */}
        <div className="relative md:col-span-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Search size={16} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên hoặc email..."
            className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-transparent focus:border-red-500 focus:bg-white rounded-xl text-xs font-semibold outline-none transition-all text-gray-950 placeholder:text-gray-400"
          />
        </div>

        {/* Filter Division */}
        <div className="flex flex-wrap items-center gap-1.5 md:col-span-5">
          <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider mr-1">Tổ:</span>
          {['all', ...Object.keys(deptNames)].map((dept) => (
            <button
              key={dept}
              type="button"
              onClick={() => setFilterDept(dept)}
              className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all select-none border cursor-pointer ${
                filterDept === dept
                  ? 'bg-toyota-navy text-white border-toyota-navy shadow-sm'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {dept === 'all' ? 'Tất cả' : (deptNames[dept] || dept)}
            </button>
          ))}
        </div>

        {/* Filter Status */}
        <div className="flex flex-wrap items-center gap-1.5 md:col-span-3">
          <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider mr-1">Trạng thái:</span>
          {(['all', 'active', 'locked'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all select-none border cursor-pointer ${
                filterStatus === st
                  ? 'bg-toyota-navy text-white border-toyota-navy shadow-sm'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {st === 'all' ? 'Tất cả' : st === 'active' ? 'Bật' : 'Khóa'}
            </button>
          ))}
        </div>
      </div>

      {/* Users List Area */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
          <Loader2 className="animate-spin text-toyota-red" size={32} />
          <p className="text-xs font-black uppercase tracking-widest text-toyota-navy font-sans">Đang nạp hồ sơ tài khoản…</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-3xl border border-gray-100 p-8">
          <Users size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-xs font-black uppercase tracking-wider text-toyota-navy mb-1 font-sans">Không tìm thấy tài khoản thích hợp</p>
          <p className="text-[10px] text-gray-400 font-bold font-sans">Hãy thay đổi bộ lọc tìm kiếm hoặc thêm mới tài khoản kỹ thuật viên.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((u) => {
            const isSelf = u.uid === currentUser?.uid;
            const creationDate = u.createdAt 
              ? new Date(u.createdAt.toMillis ? u.createdAt.toMillis() : u.createdAt).toLocaleDateString('vi-VN') 
              : 'N/A';

            const selectedDepartmentId = (u as any).departmentId || u.department || "";
            console.log("[ACCOUNT DEPARTMENT DEBUG]", {
              uid: u.uid,
              savedDepartmentId: (u as any).departmentId,
              legacyDepartment: u.department,
              selectedDepartmentId
            });

            const rawResolvedDeptId = (u as any).departmentId || u.department || "";
            const resolvedDeptId = normalizeDepartmentValue(rawResolvedDeptId) || rawResolvedDeptId;
            const hasDept = resolvedDeptId === "admin" || dbDeptIds.includes(resolvedDeptId);
            const displayedDeptName = deptNames[resolvedDeptId] || (resolvedDeptId ? resolvedDeptId : "Bộ phận không xác định");

            return (
              <div 
                key={u.uid}
                className={`bg-white rounded-3xl p-5 border shadow-sm transition-all duration-150 flex flex-col sm:flex-row justify-between sm:items-center gap-4 ${
                  u.isActive === false 
                    ? 'border-red-100 bg-red-50/10' 
                    : isSelf 
                      ? 'border-toyota-red/20 ring-1 ring-toyota-red/5' 
                      : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                {/* Profile card metadata info */}
                <div className="flex gap-4.5">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm select-none shadow-sm ${
                    u.isActive === false
                      ? 'bg-red-100 text-red-600'
                      : isSelf
                        ? 'bg-toyota-red text-white'
                        : 'bg-gray-100 text-toyota-navy'
                  }`}>
                    {u.displayName ? u.displayName.charAt(0).toUpperCase() : 'U'}
                  </div>

                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-toyota-navy uppercase tracking-tight">{u.displayName}</span>
                      
                      {/* Self Indicator tag */}
                      {isSelf && (
                        <span className="text-[7.5px] uppercase font-black px-1.5 py-0.5 bg-toyota-red text-white rounded">
                          Bạn
                        </span>
                      )}

                      {/* Active / Locked Status Badge */}
                      {u.isActive === false ? (
                        <span className="flex items-center gap-0.5 text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 bg-red-100 text-red-600 rounded-lg">
                          <Lock size={8} /> Khóa
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 bg-green-50 text-green-600 border border-green-100 rounded-lg">
                          <Check size={8} /> Hoạt động
                        </span>
                      )}

                      {/* Admin/User Role Badge */}
                      <span className={`text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded-lg border ${
                        u.role === 'admin' 
                          ? 'bg-red-50 text-red-600 border-red-100' 
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                      }`}>
                        {u.role === 'admin' ? 'Quản trị' : 'KTV'}
                      </span>

                      {/* Department Badge */}
                      <span className={`text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded-lg border ${
                        resolvedDeptId === 'admin' 
                          ? 'bg-zinc-800 text-zinc-100 border-zinc-900' 
                          : resolvedDeptId === 'baohiem' 
                            ? 'bg-purple-50 text-purple-600 border-purple-100' 
                            : hasDept
                              ? 'bg-blue-50 text-blue-600 border-blue-100'
                              : 'bg-amber-50 text-amber-600 border-amber-100'
                      }`}>
                        Tổ: {displayedDeptName} {!hasDept && resolvedDeptId ? "(Không xác định)" : ""}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1 text-[10px] text-gray-400 font-bold">
                      <span className="flex items-center gap-1">
                        <Mail size={12} className="opacity-70 text-gray-400" />
                        {u.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} className="opacity-70 text-gray-400" />
                        Tạo ngày: {creationDate}
                      </span>
                      <span className={`flex items-center gap-1 ${u.canDeleteSession ? 'text-toyota-red' : 'text-gray-400'}`}>
                        <Shield size={12} className="opacity-70" />
                        Xóa xe: {u.canDeleteSession ? 'Cho phép' : 'Khóa'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Operations */}
                <div className="flex items-center gap-1.5 sm:self-center border-t border-gray-50 pt-3.5 sm:pt-0 sm:border-t-0 justify-end">
                  <button
                    type="button"
                    onClick={() => openEditModal(u)}
                    title="Chỉnh sửa thông tin"
                    className="p-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-600 transition-all cursor-pointer"
                  >
                    <Edit2 size={13} />
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handleResetPassword(u)}
                    title="Gửi email đặt lại mật khẩu"
                    className="p-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-600 transition-all cursor-pointer"
                  >
                    <Key size={13} />
                  </button>

                  {!isSelf && (
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(u)}
                      title={u.isActive === false ? "Mở khóa tài khoản" : "Khóa tài khoản"}
                      className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                        u.isActive === false
                          ? 'bg-green-50 hover:bg-green-100 text-green-600'
                          : 'bg-red-50 hover:bg-red-100 text-red-600'
                      }`}
                    >
                      {u.isActive === false ? <Unlock size={13} /> : <Lock size={13} />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: ADD ACCOUNT */}
      {showAddModal && (
        <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
          <div className="bg-white rounded-[32px] w-full max-w-md p-6 md:p-8 space-y-6 shadow-2xl border border-gray-100 animate-scaleUp">
            
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-base font-black text-toyota-navy uppercase tracking-tight font-sans">Thêm tài khoản mới</h3>
                <p className="text-[9px] uppercase tracking-widest font-black text-gray-400 font-sans">Tạo tài khoản Google Auth và Firestore</p>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              
              {/* Họ & Tên */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Họ và tên *</label>
                <input
                  type="text"
                  required
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="E.g. Nguyễn Văn A"
                  className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-red-500 rounded-xl text-xs font-semibold outline-none focus:bg-white transition-colors text-gray-900"
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Email đăng nhập *</label>
                <input
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="username@toyotahadong.com"
                  className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-red-500 rounded-xl text-xs font-semibold outline-none focus:bg-white transition-colors text-gray-900"
                />
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Mật khẩu tạm thời * (tối thiểu 6 ký tự)</label>
                <input
                  type="password"
                  required
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  placeholder="E.g. Hadong123"
                  className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-red-500 rounded-xl text-xs font-semibold outline-none focus:bg-white transition-colors text-gray-900"
                />
              </div>

              {/* Department Option Selector */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Tổ / Bộ phận *</label>
                {addRole === 'admin' ? (
                  <div className="py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border bg-toyota-navy text-white text-center">
                    Quản trị (Bộ phận mặc định)
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {activeDepts.map((dept) => (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => setAddDept(dept.id)}
                        className={`py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all active:scale-95 cursor-pointer ${
                          addDept === dept.id
                            ? "bg-toyota-navy text-white border-toyota-navy shadow-sm"
                            : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {dept.name}
                      </button>
                    ))}
                    {activeDepts.length === 0 && (
                      <div className="col-span-2 text-center text-[10px] font-bold text-toyota-red bg-red-50 p-2.5 rounded-lg">
                        Không có bộ phận nào khả dụng!
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Role Option Selector */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Vai trò phân quyền *</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(['user', 'admin'] as const).map((rl) => (
                    <button
                      key={rl}
                      type="button"
                      onClick={() => setAddRole(rl)}
                      className={`py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all active:scale-95 cursor-pointer ${
                        addRole === rl
                          ? "bg-toyota-navy text-white border-toyota-navy shadow-sm"
                          : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {rl === 'admin' ? 'Quản trị viên' : 'Kỹ thuật viên'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Can Delete Switch toggler */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="space-y-0.5 text-left">
                  <p className="text-[10px] font-black uppercase tracking-wider text-toyota-navy">Quyền xóa phiên xe</p>
                  <p className="text-[9px] text-gray-400 font-bold">KTV có thể xóa vĩnh viễn xe chụp</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAddCanDelete(!addCanDelete)}
                  className={`w-11 h-6 rounded-full flex items-center px-1 transition-colors cursor-pointer ${
                    addCanDelete ? "bg-toyota-red" : "bg-gray-300"
                  }`}
                >
                  <span className={`w-4 h-4 bg-white rounded-full transition-all ${
                    addCanDelete ? "ml-auto" : "ml-0"
                  }`}></span>
                </button>
              </div>

              {/* Feedback messages */}
              {actionError && (
                <div className="p-3 bg-red-50 text-toyota-red text-[11px] font-bold uppercase tracking-wide rounded-xl border border-red-100 text-center font-sans">
                  {actionError}
                </div>
              )}
              {actionSuccess && (
                <div className="p-3 bg-green-50 text-green-700 text-[11px] font-bold uppercase tracking-wide rounded-xl border border-green-100 text-center flex items-center justify-center gap-1.5 animate-pulse font-sans">
                  <CheckCircle size={14} />
                  {actionSuccess}
                </div>
              )}

              {/* Footer buttons */}
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 border border-gray-200 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 transition-all text-center cursor-pointer"
                >
                  Hủy / Đóng
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 bg-toyota-red hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {submitting && <Loader2 className="animate-spin" size={12} />}
                  Xác nhận tạo
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT ACCOUNT */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
          <div className="bg-white rounded-[32px] w-full max-w-md p-6 md:p-8 space-y-6 shadow-2xl border border-gray-100 animate-scaleUp">
            
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-base font-black text-toyota-navy uppercase tracking-tight font-sans">Sửa thông tin tài khoản</h3>
                <p className="text-[9px] uppercase tracking-widest font-black text-gray-400 font-sans">UID: {selectedUser.uid.substring(0, 8)}...</p>
              </div>
              <button 
                onClick={() => setShowEditModal(false)}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEditUser} className="space-y-4">
              
              {/* Họ & Tên */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Họ và tên *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="E.g. Nguyễn Văn A"
                  className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-red-500 rounded-xl text-xs font-semibold outline-none focus:bg-white transition-colors text-gray-900"
                />
              </div>

              {/* Email (Immutable indicator) */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-300 tracking-wider">Email (Không thể thay đổi)</label>
                <div className="p-3 bg-gray-100 text-gray-400 rounded-xl text-xs font-mono select-none border border-gray-200 text-left">
                  {selectedUser.email}
                </div>
              </div>

              {/* Department Option Selector */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Tổ / Bộ phận *</label>
                {editRole === 'admin' ? (
                  <div className="py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border bg-toyota-navy text-white text-center">
                    Quản trị (Bộ phận mặc định)
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {activeDepts.map((dept) => (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => setEditDept(dept.id)}
                        className={`py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all active:scale-95 cursor-pointer ${
                          editDept === dept.id
                            ? "bg-toyota-navy text-white border-toyota-navy shadow-sm"
                            : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {dept.name}
                      </button>
                    ))}
                    {editDept !== 'admin' && !activeDepts.some(d => d.id === editDept) && (
                      <button
                        type="button"
                        disabled
                        className="py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border bg-amber-50 text-amber-700 border-amber-200 cursor-not-allowed col-span-2 text-center"
                      >
                        {dbDeptIds.includes(editDept) 
                          ? `${deptNames[editDept] || editDept} (Bộ phận đã khóa)` 
                          : `${editDept ? `Bộ phận "${editDept}"` : "Bộ phận không xác định"} (Bộ phận không xác định)`}
                      </button>
                    )}
                    {activeDepts.length === 0 && !(!activeDepts.some(d => d.id === editDept)) && (
                      <div className="col-span-2 text-center text-[10px] font-bold text-toyota-red bg-red-50 p-2.5 rounded-lg">
                        Không có bộ phận nào khả dụng!
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Role Option Selector */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Vai trò phân quyền *</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(['user', 'admin'] as const).map((rl) => (
                    <button
                      key={rl}
                      type="button"
                      onClick={() => setEditRole(rl)}
                      className={`py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all active:scale-95 cursor-pointer ${
                        editRole === rl
                          ? "bg-toyota-navy text-white border-toyota-navy shadow-sm"
                          : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {rl === 'admin' ? 'Quản trị viên' : 'Kỹ thuật viên'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Can Delete Switch toggler */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="space-y-0.5 text-left">
                  <p className="text-[10px] font-black uppercase tracking-wider text-toyota-navy">Quyền xóa phiên xe</p>
                  <p className="text-[9px] text-gray-400 font-bold">KTV có thể xóa vĩnh viễn xe chụp</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditCanDelete(!editCanDelete)}
                  className={`w-11 h-6 rounded-full flex items-center px-1 transition-colors cursor-pointer ${
                    editCanDelete ? "bg-toyota-red" : "bg-gray-300"
                  }`}
                >
                  <span className={`w-4 h-4 bg-white rounded-full transition-all ${
                    editCanDelete ? "ml-auto" : "ml-0"
                  }`}></span>
                </button>
              </div>

              {/* Feedback messages */}
              {actionError && (
                <div className="p-3 bg-red-50 text-toyota-red text-[11px] font-bold uppercase tracking-wide rounded-xl border border-red-100 text-center font-sans">
                  {actionError}
                </div>
              )}
              {actionSuccess && (
                <div className="p-3 bg-green-50 text-green-700 text-[11px] font-bold uppercase tracking-wide rounded-xl border border-green-100 text-center flex items-center justify-center gap-1.5 animate-pulse font-sans">
                  <CheckCircle size={14} />
                  {actionSuccess}
                </div>
              )}

              {/* Optional Delete Account Option for Admin */}
              {currentUser?.role === 'admin' && currentUser?.uid !== selectedUser.uid && (
                <div className="pt-3 border-t border-gray-100 flex flex-col space-y-1">
                  <button
                    type="button"
                    disabled={submitting || deleteDialogLoading}
                    onClick={handleInitiateDelete}
                    className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-toyota-red font-black text-[10px] uppercase tracking-widest rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {deleteDialogLoading ? (
                      <Loader2 className="animate-spin" size={12} />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Xóa tài khoản này
                  </button>
                  <p className="text-[8px] text-gray-400 font-extrabold text-center uppercase tracking-wider">
                    Yêu cầu xác thực 2 bước & Kiểm tra lịch sử dữ liệu phát sinh
                  </p>
                </div>
              )}

              {/* Bottom buttons submission */}
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 py-3 border border-gray-200 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 transition-all text-center cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 bg-toyota-red hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {submitting && <Loader2 className="animate-spin" size={12} />}
                  Lưu thay đổi
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CUSTOM LOCK/UNLOCK DIALOG */}
      {statusDialogUser && (
        <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
          <div className="bg-white rounded-[32px] w-full max-w-sm p-6 space-y-6 shadow-2xl border border-gray-100 animate-scaleUp">
            
            <div className="flex items-start gap-3">
              <div className={`p-3 rounded-2xl ${statusDialogUser.isActive === false ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
                {statusDialogUser.isActive === false ? <Unlock size={20} /> : <Lock size={20} />}
              </div>
              <div className="text-left space-y-1">
                <h3 className="text-sm font-black text-toyota-navy uppercase tracking-tight">
                  {statusDialogUser.isActive === false ? "Mở khóa tài khoản" : "Khóa tài khoản"}
                </h3>
                <p className="text-[10px] text-gray-400 font-bold">
                  Thao tác sẽ thay đổi trạng thái hoạt động của {statusDialogUser.displayName}.
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-600 font-medium text-left bg-gray-50 p-4 rounded-2xl border border-gray-100">
              {statusDialogUser.isActive === false ? (
                <span>Người dùng sẽ khôi phục khả năng đăng nhập và thao tác bình thường trên hệ thống.</span>
              ) : (
                <span className="font-bold text-toyota-navy">Bạn có chắc chắn muốn khóa tài khoản này?</span>
              )}
            </div>

            {/* Status Feedback messages */}
            {statusDialogError && (
              <div className="p-3 bg-red-50 text-toyota-red text-[10px] font-black uppercase tracking-wide rounded-xl border border-red-100 text-center">
                {statusDialogError}
              </div>
            )}
            {statusDialogSuccess && (
              <div className="p-3 bg-green-50 text-green-700 text-[10px] font-black uppercase tracking-wide rounded-xl border border-green-100 text-center flex items-center justify-center gap-1">
                <CheckCircle size={12} />
                {statusDialogSuccess}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={statusDialogSubmitting}
                onClick={() => setStatusDialogUser(null)}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer text-center"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={statusDialogSubmitting}
                onClick={submitToggleStatus}
                className={`flex-1 py-2.5 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm ${
                  statusDialogUser.isActive === false
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-toyota-red hover:bg-red-700"
                }`}
              >
                {statusDialogSubmitting && <Loader2 className="animate-spin" size={10} />}
                Xác nhận
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL 4: CUSTOM DELETE TWO-STEP CONFIRM MODAL */}
      {showDeleteConfirmModal && selectedUser && (
        <div className="fixed inset-0 bg-toyota-navy/90 backdrop-blur-md z-[120] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
          <div className="bg-white rounded-[32px] w-full max-w-sm p-6 space-y-5 shadow-2xl border border-red-100 animate-scaleUp">
            
            <div className="flex items-start gap-3 border-b border-gray-50 pb-3">
              <div className="p-2.5 bg-red-50 text-toyota-red rounded-xl">
                <AlertTriangle size={18} />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-black text-toyota-navy uppercase tracking-tight">Xóa vĩnh viễn tài khoản</h3>
                <p className="text-[9px] uppercase tracking-widest font-black text-gray-400">Hành động này không thể khôi phục</p>
              </div>
            </div>

            {/* Warning 1: existing sessions warning */}
            {deleteHasSessions && (
              <div className="p-3 bg-amber-50 border border-amber-200/50 rounded-2xl text-amber-800 text-[10px] font-bold text-left space-y-1">
                <p className="uppercase tracking-wide flex items-center gap-1 font-black">⚠️ Cảnh báo dữ liệu phát sinh</p>
                <p>Tài khoản này đã phát sinh dữ liệu. Nên khóa thay vì xóa.</p>
              </div>
            )}

            {/* Warning 2: general deletion warning */}
            <div className="p-3 bg-red-50 border border-red-100 rounded-2xl text-toyota-red text-[10px] font-semibold text-left space-y-1">
              <p className="font-bold uppercase tracking-wide flex items-center gap-1">🔴 Chú ý đặc biệt</p>
              <p>Tài khoản sẽ bị xóa vĩnh viễn và không thể đăng nhập lại.</p>
            </div>

            {/* Two-step Verification form */}
            <div className="space-y-1 text-left">
              <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider">
                XÁC NHẬN - Nhập chính xác email để xóa:
              </label>
              <div className="p-2 bg-gray-50 text-gray-500 rounded-lg text-[10px] font-mono border border-gray-100 text-center select-all cursor-pointer" title="Click to copy email">
                {selectedUser.email}
              </div>
              <input
                type="text"
                required
                value={deleteEmailConfirm}
                onChange={(e) => setDeleteEmailConfirm(e.target.value)}
                placeholder="Nhập lại email để xác thực"
                className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:border-red-500 rounded-xl text-xs font-mono outline-none focus:bg-white text-gray-900 transition-all text-center"
              />
            </div>

            {/* Delete Dialog Feedback messages */}
            {deleteDialogError && (
              <div className="p-2.5 bg-red-50 text-toyota-red text-[9px] font-black uppercase tracking-wide rounded-lg border border-red-100 text-center">
                {deleteDialogError}
              </div>
            )}
            {deleteDialogSuccess && (
              <div className="p-2.5 bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-wide rounded-lg border border-green-100 text-center flex items-center justify-center gap-1">
                <CheckCircle size={12} />
                {deleteDialogSuccess}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={deleteDialogSubmitting}
                onClick={() => setShowDeleteConfirmModal(false)}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-100 text-gray-700 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer text-center"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={deleteDialogSubmitting || deleteEmailConfirm.trim().toLowerCase() !== selectedUser.email.toLowerCase()}
                onClick={submitDeleteUser}
                className="flex-1 py-2.5 bg-toyota-red hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-toyota-red text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm"
              >
                {deleteDialogSubmitting && <Loader2 className="animate-spin" size={10} />}
                Xác nhận xóa
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
