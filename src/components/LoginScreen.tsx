import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export default function LoginScreen() {
  const { login, loginError, loading, debugInfo } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError('Vui lòng nhập Email.');
      return;
    }
    if (!password) {
      setFormError('Vui lòng nhập mật khẩu.');
      return;
    }

    const success = await login(trimmedEmail, password, rememberMe);
    if (!success) {
      // loginError will be displayed
    }
  };

  const activeError = formError || loginError;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col justify-between p-6 md:p-8 font-sans antialiased text-gray-800">
      {/* Top Margin/Spacing Spacer */}
      <div className="hidden md:block"></div>

      {/* Main card box container */}
      <div className="w-full max-w-md mx-auto my-auto space-y-8 bg-white p-8 rounded-[36px] shadow-sm border border-gray-100 flex flex-col">
        {/* Brand Header */}
        <div className="text-center space-y-4">
          {/* Logo brand icon */}
          <div className="w-20 h-20 bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-3xl flex items-center justify-center mx-auto shadow-sm text-toyota-red transition-all cursor-pointer">
            <svg className="w-14 h-14" viewBox="0 0 100 100" fill="currentColor">
              {/* Distinctive high-precision modern abstract emblem for Toyota Brand style */}
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6"/>
              <ellipse cx="50" cy="50" rx="36" ry="18" fill="none" stroke="currentColor" strokeWidth="5"/>
              <ellipse cx="50" cy="40" rx="20" ry="24" fill="none" stroke="currentColor" strokeWidth="5"/>
              <line x1="50" y1="16" x2="50" y2="84" stroke="currentColor" strokeWidth="7"/>
            </svg>
          </div>
          
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-[#1A1C1E] uppercase tracking-tighter">Ảnh Xe THD</h1>
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest leading-none">Toyota Hà Đông Service</p>
          </div>
        </div>

        {/* Input Form Fields */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email input wrapper */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block px-1">Email Kỹ thuật viên</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <Mail size={16} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@toyotahadong.com"
                autoComplete="email"
                disabled={loading}
                className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 focus:border-toyota-red focus:bg-white rounded-2xl text-sm focus:outline-none transition-all placeholder:text-gray-300 disabled:opacity-60 text-gray-900 font-medium"
              />
            </div>
          </div>

          {/* Password input wrapper */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block px-1">Mật khẩu</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock size={16} />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
                className="w-full pl-11 pr-11 py-3.5 bg-gray-50 border border-gray-200 focus:border-toyota-red focus:bg-white rounded-2xl text-sm focus:outline-none transition-all placeholder:text-gray-300 disabled:opacity-60 text-gray-900 font-medium"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Remember me toggle */}
          <div className="flex items-center justify-between px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
                className="rounded text-toyota-red focus:ring-0 border-gray-200 w-4 h-4 accent-toyota-red cursor-pointer"
              />
              <span className="text-xs font-bold text-gray-500 group-hover:text-gray-700 transition-colors">Ghi nhớ đăng nhập</span>
            </label>
          </div>

          {/* Error Feedbacks */}
          {activeError && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-red-50 text-toyota-red text-xs font-bold uppercase tracking-wide rounded-2xl text-center border border-red-100/50 leading-relaxed font-sans"
            >
              {activeError}
            </motion.div>
          )}

          {/* Diagnostic Info Box (Disabled for production transition) */}
          {false && debugInfo && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-neutral-900 text-neutral-200 p-4 rounded-2xl text-[11px] font-mono border border-neutral-800 space-y-2 mt-2 leading-relaxed"
            >
              <div className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-2 border-b border-neutral-800 pb-1.5 flex justify-between">
                <span>🔍 THÔNG TIN KIỂM TRA</span>
                <span className="text-gray-500 font-normal">DEBUG MODE</span>
              </div>
              <div className="grid grid-cols-3 gap-y-1 gap-x-2 text-left">
                <span className="text-neutral-500 font-bold whitespace-nowrap">App Name:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.appName || 'N/A'}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Project:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.projectId}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Database:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.databaseId || '(default)'}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Emulator:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.emulator || 'false'}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Auth UID:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.uid || 'N/A'}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Auth Email:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.email || 'N/A'}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Doc Path:</span>
                <span className="col-span-2 text-neutral-300 break-all">{debugInfo.userDocPath}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Doc Exists:</span>
                <span className={`col-span-2 font-bold ${debugInfo.exists ? 'text-green-400' : 'text-red-400'}`}>
                  {debugInfo.exists ? 'true (Tồn tại)' : 'false (Không tồn tại)'}
                </span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Doc Data:</span>
                <span className="col-span-2 text-neutral-300 max-h-24 overflow-y-auto block break-all">
                  {debugInfo.data ? JSON.stringify(debugInfo.data) : 'null'}
                </span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Error Code:</span>
                <span className="col-span-2 text-amber-500 break-all">{debugInfo.errorCode || 'NONE'}</span>

                <span className="text-neutral-500 font-bold whitespace-nowrap">Error Msg:</span>
                <span className="col-span-2 text-red-400 break-all">{debugInfo.errorMessage || 'NONE'}</span>
              </div>

              {debugInfo.uid && !debugInfo.exists && (
                <div className="pt-2 border-t border-neutral-800 text-[10px] text-amber-300 leading-snug">
                  💡 Mẹo: UID ở Auth là <strong>{debugInfo.uid}</strong> nhưng Firestore chưa có document trùng tên này ở <code>/users/{debugInfo.uid}</code>. Hãy tạo một doc ở collection <code>users</code> với Document ID chính xác là UID này!
                </div>
              )}
            </motion.div>
          )}

          {/* Login submission trigger button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-toyota-red text-white hover:bg-red-700 active:scale-[0.98] transition-all rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-red-900/10 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                <span>ĐANG ĐĂNG NHẬP...</span>
              </>
            ) : (
              <span>ĐĂNG NHẬP HỆ THỐNG</span>
            )}
          </button>
        </form>

        {/* Informative Guidance */}
        <div className="text-center pt-2">
          <p className="text-[10px] text-gray-400 font-bold tracking-tight">
            Đăng nhập bằng tài khoản được Toyota Hà Đông cấp.
          </p>
        </div>
      </div>

      {/* Footer Powered Info */}
      <div className="text-center">
        <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
          Powered by Google AI Studio
        </p>
      </div>
    </div>
  );
}
