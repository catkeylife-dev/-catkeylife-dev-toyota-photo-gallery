import { auth, db } from '@/src/lib/firebase';
import { signOut } from 'firebase/auth';
import { useState, useEffect } from 'react';
import { LogOut, User, Mail, Landmark } from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { normalizeDepartmentValue } from '@/src/lib/departmentResolver';

export default function Header() {
  const { user, logout, loading: authLoading } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [deptNames, setDeptNames] = useState<Record<string, string>>({
    admin: 'Quản trị',
    service: 'Dịch vụ',
    baohiem: 'Bảo hiểm'
  });

  // Load department name real-time mapping from Firestore to support custom departments dynamically
  useEffect(() => {
    const q = query(collection(db, 'departments'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const names: Record<string, string> = {
        admin: 'Quản trị',
        service: 'Dịch vụ',
        baohiem: 'Bảo hiểm'
      };
      snap.forEach((doc) => {
        const rawId = doc.id;
        const normalizedId = normalizeDepartmentValue(rawId) || rawId;
        names[normalizedId] = doc.data().name || doc.id;
      });
      setDeptNames(names);
    }, (err) => {
      console.error("Error subscribing to departments in Header:", err);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      setShowDropdown(false);
      await logout();
    } catch (err) {
      console.error("Failed to sign out:", err);
    }
  };

  // Fallback hierarchical logic for displayName
  const getCleanName = () => {
    if (user?.displayName && user.displayName.trim()) {
      return user.displayName.trim();
    }
    if (user?.email) {
      return user.email;
    }
    return "Người dùng";
  };

  const cleanName = getCleanName();

  // Avatar letter logic
  const getFirstLetter = (name: string) => {
    if (!name) return 'N';
    const trimmed = name.trim();
    if (!trimmed) return 'N';
    return trimmed.charAt(0).toUpperCase();
  };

  const firstLetter = getFirstLetter(cleanName);
  const photoURL = auth.currentUser?.photoURL || null;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 sm:px-6 py-3.5 flex justify-between items-center shadow-sm font-sans">
      <div className="flex items-center gap-3">
        {!logoError ? (
          <img 
            src="/logo-thd.png" 
            alt="Logo Toyota Hà Đông" 
            className="w-11 h-11 sm:w-14 sm:h-14 object-contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-toyota-red rounded-full flex items-center justify-center shadow-md">
            <div className="w-5 h-5 border-[3px] border-white rounded-full"></div>
          </div>
        )}
        <div className="leading-tight">
          <h1 className="text-base sm:text-lg font-black text-toyota-navy tracking-tight">Ảnh Xe THD</h1>
          <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-widest font-bold">Toyota Hà Đông Service</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {authLoading ? (
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gray-100 animate-pulse" />
        ) : user ? (
          <div className="flex items-center gap-1 sm:gap-2 relative">
            {/* Clickable user profile area */}
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 sm:gap-3 cursor-pointer select-none py-1 px-1.5 hover:bg-gray-50 active:bg-gray-100 rounded-xl transition-all border border-transparent hover:border-gray-100 align-middle"
            >
              <div className="hidden min-[360px]:block text-right leading-tight max-w-[90px] sm:max-w-[150px] md:max-w-[200px]">
                <p className="text-[8px] sm:text-[9px] font-black tracking-widest text-gray-400 uppercase">ĐÃ ĐĂNG NHẬP</p>
                <p className="text-xs sm:text-sm font-black text-toyota-navy truncate">
                  {cleanName}
                </p>
              </div>

              {/* Avatar display */}
              <div className="relative flex-shrink-0">
                {photoURL && !imageError ? (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 shadow-sm">
                    <img 
                      src={photoURL} 
                      alt="avatar" 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover" 
                      onError={() => setImageError(true)}
                    />
                  </div>
                ) : (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-toyota-red flex items-center justify-center font-black text-white text-xs sm:text-sm shadow-sm">
                    {firstLetter}
                  </div>
                )}
              </div>
            </button>

            {/* Direct logout button shortcut */}
            <button
              type="button"
              onClick={handleLogout}
              title="Đăng xuất"
              className="p-1.5 sm:p-2 text-gray-400 hover:text-toyota-red rounded-xl hover:bg-red-50 transition-all flex-shrink-0 active:scale-95 cursor-pointer border border-transparent hover:border-red-100"
            >
              <LogOut size={16} className="sm:w-[18px] sm:h-[18px]" strokeWidth={2.5} />
            </button>

            {/* Dropdown profile overlay */}
            <AnimatePresence>
              {showDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-40 bg-transparent cursor-default" 
                    onClick={() => setShowDropdown(false)} 
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 w-60 sm:w-64 bg-white rounded-2xl border border-gray-100 shadow-xl p-4 z-50 overflow-hidden text-left"
                    style={{ top: 'calc(100% + 8px)' }}
                  >
                    <h4 className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3 border-b border-gray-100 pb-2">Hồ sơ cá nhân</h4>
                    
                    <div className="space-y-3">
                      {/* Name row */}
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 bg-gray-50 text-gray-500 rounded-lg flex-shrink-0">
                          <User size={14} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none mb-0.5">Họ và tên</p>
                          <p className="text-xs font-bold text-toyota-navy truncate">{cleanName}</p>
                        </div>
                      </div>

                      {/* Email row */}
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 bg-gray-50 text-gray-500 rounded-lg flex-shrink-0">
                          <Mail size={14} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none mb-0.5">Email</p>
                          <p className="text-xs font-bold text-toyota-navy truncate">{user.email || '—'}</p>
                        </div>
                      </div>

                      {/* Department row */}
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 bg-gray-50 text-gray-500 rounded-lg flex-shrink-0">
                          <Landmark size={14} strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none mb-0.5">Tổ / Bộ phận</p>
                          <p className="text-xs font-bold text-toyota-navy truncate">
                            {deptNames[user.departmentId || user.department] || user.departmentId || user.department || 'Chưa phân loại'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full py-2 px-3 bg-red-50 hover:bg-toyota-red text-toyota-red hover:text-white rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                      >
                        <LogOut size={12} strokeWidth={2.5} />
                        Đăng xuất
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        ) : null}
      </div>
    </header>
  );
}
