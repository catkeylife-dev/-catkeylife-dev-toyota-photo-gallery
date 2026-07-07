import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  setPersistence, 
  browserLocalPersistence, 
  browserSessionPersistence, 
  signInWithEmailAndPassword, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, getDocFromServer, setDoc, serverTimestamp } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { auth, db } from '../lib/firebase';


export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  departmentId: string;
  department: string;
  isActive: boolean;
  canDeleteSession: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  loginError: string | null;
  login: (email: string, password: string, rememberMe: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  debugInfo: any;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeDepartment = (deptId: string | undefined | null, dept: string | undefined | null, role?: string): string => {
  const d = (deptId || dept || '').trim().toLowerCase();
  if (role === 'admin' || d === 'admin') return 'admin';
  if (d === 'baohiem' || d === 'bao-hiem' || d === 'insurance' || d === 'bảo hiểm') return 'baohiem';
  if (d === 'dichvu' || d === 'dich-vu' || d === 'service') return 'service';
  return d;
};


export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  // Sync state with authentication changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      setLoginError(null);
      if (firebaseUser) {
        try {
          const currentProjectId = getApp().options.projectId || 'N/A';
          const currentAppName = getApp().name || 'default';
          const dbId = (db as any)._databaseId?.database || '(default)';
          const hostSetting = (db as any)._settings?.host || (db as any)._firestoreClient?.host || 'firestore.googleapis.com';
          const isUsingEmulator = hostSetting.includes('localhost') || hostSetting.includes('127.0.0.1') || !!(db as any)._emulator;
          
          console.log("[AUTH DEBUG]", {
            projectId: currentProjectId,
            appName: currentAppName,
            databaseId: dbId,
            emulator: isUsingEmulator ? 'true' : 'false',
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            userDocPath: `users/${firebaseUser.uid}`
          });

          setDebugInfo({
            appName: currentAppName,
            projectId: currentProjectId,
            databaseId: dbId,
            emulator: isUsingEmulator ? 'true' : 'false',
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            userDocPath: `users/${firebaseUser.uid}`,
            exists: false,
            data: null,
            errorCode: undefined,
            errorMessage: undefined
          });

          const userDocRef = doc(db, 'users', firebaseUser.uid);
          let userDocSnap;
          try {
            userDocSnap = await getDocFromServer(userDocRef);
          } catch (error: any) {
            console.error("[USER PROFILE ERROR]", error.code, error.message);
            setUser(null);
            setDebugInfo((prev: any) => ({
              ...prev,
              errorCode: error.code || 'UNKNOWN',
              errorMessage: error.message || String(error)
            }));
            if (error.code === 'permission-denied') {
              setLoginError(`Lỗi phân quyền Firestore (permission-denied). Vui lòng cấu hình Firestore Rules cho project test.`);
            } else if (error.code === 'unavailable' || error.message?.includes('network')) {
              setLoginError("Không thể kết nối Firestore. Vui lòng kiểm tra mạng và thử lại.");
            } else {
              setLoginError(`Lỗi tải cấu hình người dùng [${error.code || 'UNKNOWN'}]: ${error.message}`);
            }
            setLoading(false);
            return;
          }

          console.log("[USER DOC DEBUG]", {
            exists: userDocSnap.exists(),
            data: userDocSnap.exists() ? userDocSnap.data() : null
          });

          setDebugInfo((prev: any) => ({
            ...prev,
            exists: userDocSnap.exists(),
            data: userDocSnap.exists() ? userDocSnap.data() : null
          }));

          if (!userDocSnap.exists()) {
            setUser(null);
            setLoginError("Tài khoản này chưa được cấp quyền sử dụng hệ thống.");
            setLoading(false);
            return;
          }

          const userData = userDocSnap.data() as Omit<AppUser, 'uid'>;
          
          if (userData.isActive !== true) {
            setUser(null);
            setLoginError("Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");
            setLoading(false);
            return;
          }

          const resolvedDept = normalizeDepartment((userData as any).departmentId, (userData as any).department, userData.role);
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email || userData.email || '',
            displayName: userData.displayName || firebaseUser.displayName || 'Kỹ thuật viên',
            role: userData.role || 'user',
            departmentId: resolvedDept,
            department: resolvedDept,
            isActive: userData.isActive,
            canDeleteSession: userData.canDeleteSession ?? false,
            createdAt: userData.createdAt,
            updatedAt: userData.updatedAt
          });
        } catch (error: any) {
          console.error("Auth status verification failed:", error);
          setUser(null);
          setDebugInfo((prev: any) => ({
            ...prev,
            errorCode: error.code || 'UNKNOWN',
            errorMessage: error.message || String(error)
          }));
          if (error.code === 'unavailable' || error.message?.includes('network')) {
            setLoginError("Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.");
          } else {
            setLoginError("Tài khoản này chưa được cấp quyền sử dụng hệ thống.");
          }
        }
      } else {
        setUser(null);
        setDebugInfo(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string, rememberMe: boolean): Promise<boolean> => {
    setLoading(true);
    setLoginError(null);
    setDebugInfo(null);
    try {
      // Set persistence based on rememberMe checkbox
      const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
      await setPersistence(auth, persistenceType);

      // Sign in with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const firebaseUser = userCredential.user;

      const currentProjectId = getApp().options.projectId || 'N/A';
      const currentAppName = getApp().name || 'default';
      const dbId = (db as any)._databaseId?.database || '(default)';
      const hostSetting = (db as any)._settings?.host || (db as any)._firestoreClient?.host || 'firestore.googleapis.com';
      const isUsingEmulator = hostSetting.includes('localhost') || hostSetting.includes('127.0.0.1') || !!(db as any)._emulator;

      console.log("[AUTH DEBUG]", {
        projectId: currentProjectId,
        appName: currentAppName,
        databaseId: dbId,
        emulator: isUsingEmulator ? 'true' : 'false',
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        userDocPath: `users/${firebaseUser.uid}`
      });

      setDebugInfo({
        appName: currentAppName,
        projectId: currentProjectId,
        databaseId: dbId,
        emulator: isUsingEmulator ? 'true' : 'false',
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        userDocPath: `users/${firebaseUser.uid}`,
        exists: false,
        data: null,
        errorCode: undefined,
        errorMessage: undefined
      });

      // Fetch user profile from Firestore user collection to complete validation
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      let userDocSnap;
      try {
        userDocSnap = await getDocFromServer(userDocRef);
      } catch (error: any) {
        console.error("[USER PROFILE ERROR]", error.code, error.message);
        setUser(null);
        setDebugInfo((prev: any) => ({
          ...prev,
          errorCode: error.code || 'UNKNOWN',
          errorMessage: error.message || String(error)
        }));
        if (error.code === 'permission-denied') {
          setLoginError(`Lỗi phân quyền Firestore (permission-denied). Vui lòng cấu hình Firestore Rules cho project test.`);
        } else if (error.code === 'unavailable' || error.message?.includes('network')) {
          setLoginError("Không thể kết nối Firestore. Vui lòng kiểm tra mạng và thử lại.");
        } else {
          setLoginError(`Lỗi tải cấu hình người dùng [${error.code || 'UNKNOWN'}]: ${error.message}`);
        }
        setLoading(false);
        return false;
      }

      console.log("[USER DOC DEBUG]", {
        exists: userDocSnap.exists(),
        data: userDocSnap.exists() ? userDocSnap.data() : null
      });

      setDebugInfo((prev: any) => ({
        ...prev,
        exists: userDocSnap.exists(),
        data: userDocSnap.exists() ? userDocSnap.data() : null
      }));

      if (!userDocSnap.exists()) {
        setUser(null);
        setLoginError("Tài khoản này chưa được cấp quyền sử dụng hệ thống.");
        setLoading(false);
        return false;
      }

      const userData = userDocSnap.data() as Omit<AppUser, 'uid'>;
      if (userData.isActive !== true) {
        setUser(null);
        setLoginError("Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");
        setLoading(false);
        return false;
      }

      const resolvedDept = normalizeDepartment((userData as any).departmentId, (userData as any).department, userData.role);
      setUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email || userData.email || '',
        displayName: userData.displayName || firebaseUser.displayName || 'Kỹ thuật viên',
        role: userData.role || 'user',
        departmentId: resolvedDept,
        department: resolvedDept,
        isActive: userData.isActive,
        canDeleteSession: userData.canDeleteSession ?? false,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt
      });
      setLoading(false);
      return true;
    } catch (error: any) {
      console.error("Login process error:", error);
      setUser(null);
      setDebugInfo({
        projectId: getApp().options.projectId || 'N/A',
        uid: null,
        email: email.trim(),
        userDocPath: 'N/A (đăng nhập thất bại)',
        exists: false,
        data: null,
        errorCode: error.code || 'UNKNOWN',
        errorMessage: error.message || String(error)
      });

      const errorCode = error.code;
      if (
        errorCode === 'auth/invalid-email' || 
        errorCode === 'auth/user-not-found' || 
        errorCode === 'auth/wrong-password' ||
        errorCode === 'auth/invalid-credential'
      ) {
        setLoginError("Email hoặc mật khẩu chưa đúng.");
      } else if (errorCode === 'auth/network-request-failed' || error.message?.includes('network')) {
        setLoginError("Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.");
      } else if (errorCode === 'auth/user-disabled') {
        setLoginError("Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");
      } else {
        setLoginError(`Chưa thể đăng nhập: ${error.message || 'Lỗi không xác định'}`);
      }

      setLoading(false);
      return false;
    }
  };

  const logout = async () => {
    setLoading(true);
    setLoginError(null);
    setDebugInfo(null);
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginError, login, logout, debugInfo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
