import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Check, Loader2, RotateCcw, Search, Trash2, CameraOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { db, storage } from '@/src/lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, limit, orderBy, doc, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { cn } from '@/src/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { getSearchFields } from '@/src/lib/searchUtils';
import { useAuth } from '@/src/context/AuthContext';
import { PlateRecognitionResult, PlateRecognitionUiStatus } from '@/src/types';
import { preprocessImageForRecognition, callRecognizeVehiclePlate } from '@/src/lib/plateRecognition';
import { getBrowserCompatibilityInfo } from '@/src/lib/browserCompatibility';



interface BgUploadItem {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  progress: number;
  url?: string;
  storagePath?: string;
}

export default function PhotoCapture() {
  const { user } = useAuth();
  const [plate, setPlate] = useState('');
  const [ro, setRo] = useState('');
  const [note, setNote] = useState('');
  const [images, setImages] = useState<{ file: File; preview: string; id: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);

  const [browserWarnings, setBrowserWarnings] = useState<string[]>([]);

  useEffect(() => {
    const info = getBrowserCompatibilityInfo();
    if (info.warnings && info.warnings.length > 0) {
      setBrowserWarnings(info.warnings);
    }
  }, []);


  // Dynamic active departments list
  const [activeDepts, setActiveDepts] = useState<{ id: string; name: string }[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('service');
  const [allDeptsMap, setAllDeptsMap] = useState<Record<string, string>>({
    service: 'Dịch vụ',
    baohiem: 'Bảo hiểm',
    phukien: 'Phụ kiện'
  });
  const [deptError, setDeptError] = useState<string | null>(null);

  useEffect(() => {
    setDeptError(null);
    const q = query(collection(db, 'departments'));
    const unsubscribe = onSnapshot(q, (snap) => {
      try {
        const list: { id: string; name: string }[] = [];
        const fullMap: Record<string, string> = {
          service: 'Dịch vụ',
          baohiem: 'Bảo hiểm',
          phukien: 'Phụ kiện'
        };

        snap.forEach((doc) => {
          const data = doc.data();
          const rawId = doc.id;
          fullMap[rawId] = data.name || rawId;

          const isDeptActive = data.active ?? data.isActive ?? true;
          if (rawId !== 'admin' && isDeptActive) {
            list.push({ id: rawId, name: data.name || rawId });
          }
        });

        setActiveDepts(list);
        setAllDeptsMap(fullMap);

        if (list.length === 0) {
          setDeptError("Không tìm thấy bộ phận hoạt động nào trên hệ thống.");
        } else {
          setDeptError(null);
        }
      } catch (err: any) {
        console.error("Lỗi đồng bộ bộ phận:", err);
        setDeptError("Không thể tải danh sách bộ phận. Vui lòng kiểm tra quyền truy cập hoặc kết nối.");
      }
    }, (err) => {
      console.error("onSnapshot error:", err);
      setDeptError("Lỗi đồng bộ bộ phận từ máy chủ.");
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      if (user.role === 'admin') {
        const hasService = activeDepts.some(d => d.id === 'service');
        if (hasService) {
          setSelectedDepartment('service');
        } else {
          setSelectedDepartment(activeDepts[0]?.id || '');
        }
      } else {
        setSelectedDepartment(user.departmentId || user.department || 'service');
      }
    }
  }, [user, activeDepts]);

  // States for choice menu modal
  const [isOptionModalOpen, setIsOptionModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string>('');

  // General camera states
  const [cameraMode, setCameraMode] = useState<'continuous' | 'upload_now' | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraRotationOffset, setCameraRotationOffset] = useState<number>(0);

  // Continuous capture local list
  const [localCapturedImages, setLocalCapturedImages] = useState<{ file: File; preview: string; id: string }[]>([]);

  // Native camera states
  const [nativeCapturedImages, setNativeCapturedImages] = useState<{ id: string; file: File; preview: string }[]>([]);
  const [isNativeCameraActive, setIsNativeCameraActive] = useState(false);
  const [showCancelNativeConfirm, setShowCancelNativeConfirm] = useState(false);

  // "Chụp & tải ngay" background processing state
  const [bgUploadItems, setBgUploadItems] = useState<BgUploadItem[]>([]);
  const [tempSessionDocId, setTempSessionDocId] = useState<string | null>(null);
  const [isCompletingBg, setIsCompletingBg] = useState(false);

  // Plate Recognition states and refs
  const [recognitionStatus, setRecognitionStatus] = useState<PlateRecognitionUiStatus>('idle');
  const [recognitionResult, setRecognitionResult] = useState<PlateRecognitionResult | null>(null);

  interface PendingPlateRecognition {
    fingerprint: string;
    status: "processing" | "accepted" | "review" | "not_detected" | "technical_error";
    result: PlateRecognitionResult | null;
    runId: number;
  }

  const [pendingRecognition, setPendingRecognition] = useState<PendingPlateRecognition | null>(null);
  const isNativeCameraActiveRef = useRef<boolean>(false);

  const runIdRef = useRef<number>(0);
  const recognizedFingerprintRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const plateRef = useRef<string>('');

  // Automatic automatic license plate recognition for "Chụp & tải ngay" configurations
  const MAX_PENDING_INSTANT_FILES = 3;
  type InstantPlateStatus =
    | "idle"
    | "processing"
    | "accepted"
    | "review"
    | "not_detected"
    | "technical_error"
    | "manual_ready"
    | "creating_session"
    | "flushing";

  const [instantPlateStatus, setInstantPlateStatus] = useState<InstantPlateStatus>("idle");
  const [showManualPlateSheet, setShowManualPlateSheet] = useState<boolean>(false);
  const instantRecognitionRunIdRef = useRef(0);
  const instantRecognitionFingerprintRef = useRef<string | null>(null);
  const instantSessionInitializingRef = useRef(false);
  const instantQueueFlushingRef = useRef(false);
  const instantPlateConfirmedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isNativeCameraActiveRef.current = isNativeCameraActive;
  }, [isNativeCameraActive]);

  useEffect(() => {
    plateRef.current = plate;
  }, [plate]);

  const normalizePlateForInput = (value?: string | null): string => {
    if (!value) return "";
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  };

  const isPlateValueValid = (val: string) => {
    if (!val) return false;
    const hasLetter = /[A-Z]/.test(val);
    const hasNumber = /[0-9]/.test(val);
    return hasLetter && hasNumber;
  };

  const hasPending = bgUploadItems.some(item => item.status === 'pending');
  const hasUploading = bgUploadItems.some(item => item.status === 'uploading');
  const isCreatingSession = instantPlateStatus === 'creating_session';
  const isProcessingPlate = instantPlateStatus === 'processing';
  const hasNoTempSession = !tempSessionDocId;
  const isPlateInvalid = !isPlateValueValid(normalizePlateForInput(plate));
  const hasNoCompletedImages = bgUploadItems.filter(item => item.status === 'completed').length === 0;

  const isDoneDisabled = cameraMode === 'upload_now' && (
    hasPending ||
    hasUploading ||
    isCreatingSession ||
    isProcessingPlate ||
    isCompletingBg
  );

  let doneButtonReason = "";
  if (cameraMode === 'upload_now') {
    if (isProcessingPlate) {
      doneButtonReason = "Đang xác định biển số...";
    } else if (hasUploading || hasPending) {
      doneButtonReason = "Đang tải ảnh... vui lòng chờ";
    } else if (isCreatingSession) {
      doneButtonReason = "Đang tạo phiên chụp...";
    } else if (isCompletingBg) {
      doneButtonReason = "Đang lưu...";
    }
  }

  const logClientError = async (stage: string, error: any, extraInfo: Record<string, any> = {}) => {
    try {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack || '' : '';
      
      const summary = {
        pending: bgUploadItems.filter(i => i.status === 'pending').length,
        uploading: bgUploadItems.filter(i => i.status === 'uploading').length,
        completed: bgUploadItems.filter(i => i.status === 'completed').length,
        error: bgUploadItems.filter(i => i.status === 'error').length,
      };

      await addDoc(collection(db, 'client_error_logs'), {
        createdAt: serverTimestamp(),
        source: "PhotoCapture.upload_now",
        stage,
        message: errorMsg,
        stack: errorStack,
        uid: user?.uid || '',
        email: user?.email || '',
        plate: plate || '',
        tempSessionDocId: tempSessionDocId || '',
        cameraMode: cameraMode || '',
        bgUploadSummary: summary,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        ...extraInfo
      });
      console.log(`[logClientError] Logged error in stage ${stage}`);
    } catch (e) {
      console.error("[logClientError] Failed logging to Firestore:", e);
    }
  };

  // Helper function to create Firestore temporary document
  const initializeInstantUploadSession = async (plateValue: string): Promise<string | null> => {
    if (instantSessionInitializingRef.current) return null;
    if (tempSessionDocId) return tempSessionDocId;

    instantSessionInitializingRef.current = true;
    try {
      const cleanPlate = plateValue.toUpperCase();
      const cleanNormalized = cleanPlate.replace(/[^A-Z0-9]/g, '');
      const searchFields = getSearchFields(cleanPlate, ro);

      const sessionRef = await addDoc(collection(db, 'cars'), {
        plateNumber: cleanPlate,
        plateNumberNormalized: cleanNormalized,
        roNumber: ro,
        note,
        createdAt: Date.now(),
        imageCount: 0,
        thumbnailUrl: '',
        imageUrls: [],
        storagePaths: [],
        status: 'uploading',
        department: selectedDepartment,
        departmentId: selectedDepartment,
        createdByUid: user?.uid || '',
        createdByEmail: user?.email || '',
        createdByName: user?.displayName || '',
        uploadedByUid: user?.uid || '',
        uploadedByEmail: user?.email || '',
        uploadedByName: user?.displayName || '',
        ...searchFields
      });

      setTempSessionDocId(sessionRef.id);
      console.log("Firestore temporary session document initialized:", sessionRef.id);
      return sessionRef.id;
    } catch (err: any) {
      console.error("Firestore temporary document creation failed:", err);
      setError("Lỗi khởi tạo phiên Firestore: " + (err.message || err));
      return null;
    } finally {
      instantSessionInitializingRef.current = false;
    }
  };

  // Helper to trigger plate recognition on first file captured in 'Chụp & tải ngay' mode
  const performInstantPlateRecognition = async (file: File) => {
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    if (instantRecognitionFingerprintRef.current === fingerprint) {
      return;
    }

    instantRecognitionFingerprintRef.current = fingerprint;
    instantRecognitionRunIdRef.current += 1;
    const currentRunId = instantRecognitionRunIdRef.current;

    setInstantPlateStatus("processing");

    try {
      const processed = await preprocessImageForRecognition(file);

      if (instantRecognitionRunIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }

      const uuid = Math.random().toString(36).substring(2, 15);
      const result = await callRecognizeVehiclePlate(processed.imageBase64, uuid);

      if (instantRecognitionRunIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }

      // If user manually filled while we were processing, do NOT overwrite and do NOT proceed
      if (instantPlateConfirmedRef.current) {
        return;
      }

      const normalized = normalizePlateForInput(result.plateNormalized || result.plateDisplay);
      const isValidPlate = isPlateValueValid(normalized);

      if (result.classification === "accepted" && isValidPlate) {
        setPlate(normalized);
        plateRef.current = normalized;
        setInstantPlateStatus("accepted");
        instantPlateConfirmedRef.current = true;
        await initializeInstantUploadSession(normalized);
      } else if (result.classification === "review" && isValidPlate) {
        setPlate(normalized);
        plateRef.current = normalized;
        setInstantPlateStatus("review");
      } else {
        setInstantPlateStatus("not_detected");
      }
    } catch (err: any) {
      if (instantRecognitionRunIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }
      console.error("[Instant Recognition] Error calling service:", err);
      setInstantPlateStatus("technical_error");
    }
  };

  // Handle manual correction and clicking "Tiếp tục tải"
  const handleContinueInstantUpload = async () => {
    const normalized = normalizePlateForInput(plate);
    const isValid = isPlateValueValid(normalized);

    if (!isValid) {
      alert("Biển số xe không hợp lệ. Vui lòng nhập biển số xe đầy đủ có cả chữ và số.");
      return;
    }

    setPlate(normalized);
    plateRef.current = normalized;
    setInstantPlateStatus("creating_session");
    instantPlateConfirmedRef.current = true;

    const sessionDocId = await initializeInstantUploadSession(normalized);
    if (sessionDocId) {
      setInstantPlateStatus("accepted");
    } else {
      setInstantPlateStatus("technical_error");
      instantPlateConfirmedRef.current = false;
    }
  };

  const startPendingRecognitionForFirstFile = async (file: File) => {
    const currentPlate = plateRef.current.trim();
    if (currentPlate) {
      return;
    }

    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;

    if (pendingRecognition && pendingRecognition.fingerprint === fingerprint) {
      return;
    }

    runIdRef.current += 1;
    const currentRunId = runIdRef.current;

    setPendingRecognition({
      fingerprint,
      status: 'processing',
      result: null,
      runId: currentRunId
    });

    try {
      const processed = await preprocessImageForRecognition(file);

      if (runIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }

      const uuid = Math.random().toString(36).substring(2, 15);
      const result = await callRecognizeVehiclePlate(processed.imageBase64, uuid);

      if (runIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }

      const normalizedPlate = normalizePlateForInput(
        result.plateNormalized || result.plateDisplay
      );

      let status: PendingPlateRecognition['status'] = 'not_detected';
      if (result.classification === 'accepted') {
        status = 'accepted';
      } else if (result.classification === 'review') {
        status = 'review';
      }

      setPendingRecognition({
        fingerprint,
        status,
        result,
        runId: currentRunId
      });

      if (!isNativeCameraActiveRef.current || recognitionStatus === 'processing') {
        if (!plateRef.current.trim()) {
          setRecognitionResult(result);
          if (status === 'accepted') {
            if (normalizedPlate) {
              setPlate(normalizedPlate);
              plateRef.current = normalizedPlate;
              setRecognitionStatus('accepted');
            } else {
              setRecognitionStatus('not_detected');
            }
          } else if (status === 'review') {
            if (normalizedPlate) {
              setPlate(normalizedPlate);
              plateRef.current = normalizedPlate;
            }
            setRecognitionStatus('review');
          } else {
            setRecognitionStatus('not_detected');
          }
        }
      }
    } catch (error) {
      if (runIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }
      console.warn("[PlateRecognition] Pendant call failed safely:", error);
      setPendingRecognition({
        fingerprint,
        status: 'technical_error',
        result: null,
        runId: currentRunId
      });

      if (!isNativeCameraActiveRef.current || recognitionStatus === 'processing') {
        setRecognitionStatus('technical_error');
      }
    }
  };

  const startRecognitionForFirstFile = async (firstFile: File | undefined, currentImagesList: any[]) => {
    if (!firstFile) {
      runIdRef.current += 1;
      recognizedFingerprintRef.current = null;
      setRecognitionStatus('idle');
      setRecognitionResult(null);
      return;
    }

    const currentPlate = plateRef.current.trim();
    if (currentPlate) {
      runIdRef.current += 1;
      recognizedFingerprintRef.current = null;
      setRecognitionStatus('idle');
      setRecognitionResult(null);
      return;
    }

    const fingerprint = `${firstFile.name}:${firstFile.size}:${firstFile.lastModified}`;

    if (recognizedFingerprintRef.current === fingerprint) {
      return;
    }

    runIdRef.current += 1;
    const currentRunId = runIdRef.current;
    
    recognizedFingerprintRef.current = fingerprint;
    setRecognitionStatus('processing');
    setRecognitionResult(null);

    try {
      const processed = await preprocessImageForRecognition(firstFile);

      if (runIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }

      const uuid = Math.random().toString(36).substring(2, 15);
      const result = await callRecognizeVehiclePlate(processed.imageBase64, uuid);

      if (runIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }

      const normalizedPlate = normalizePlateForInput(
        result.plateNormalized || result.plateDisplay
      );

      setRecognitionResult(result);

      if (result.classification === "accepted") {
        if (normalizedPlate) {
          setPlate(normalizedPlate);
          plateRef.current = normalizedPlate;
          setRecognitionStatus('accepted');
        } else {
          setRecognitionStatus('not_detected');
        }
      } else if (result.classification === "review") {
        if (normalizedPlate) {
          setPlate(normalizedPlate);
          plateRef.current = normalizedPlate;
        }
        setRecognitionStatus('review');
      } else if (result.classification === "not_detected") {
        setRecognitionStatus('not_detected');
      }
    } catch (error: any) {
      if (runIdRef.current !== currentRunId || !isMountedRef.current) {
        return;
      }
      console.warn("[PlateRecognition] call failed, catching safely:", error);
      setRecognitionStatus('technical_error');
    }
  };

  const handlePlateChange = (newVal: string) => {
    setPlate(newVal);
    plateRef.current = newVal;

    if (newVal.trim() && recognitionStatus === 'processing') {
      runIdRef.current += 1;
      setRecognitionStatus('idle');
      setRecognitionResult(null);
    }

    if (cameraMode === 'upload_now') {
      instantRecognitionRunIdRef.current += 1;
      if (!instantPlateConfirmedRef.current) {
        setInstantPlateStatus("manual_ready");
      }
    }
  };

  // Clean up device stream when component unmounts
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.error("Error stopping streaming track on cleanup", e);
          }
        });
      }
    };
  }, [stream]);

  // Queue runner for BG upload mode (uploads 1-by-1 sequentially to prevent lag/overflows)
  useEffect(() => {
    if (cameraMode !== 'upload_now') return;

    // Guard checks when plate is initially empty
    if (!plateRef.current.trim()) return;
    if (!tempSessionDocId) return;
    if (instantPlateStatus === "processing") return;
    if (instantPlateStatus === "review") return;
    if (instantPlateStatus === "not_detected") return;
    if (instantPlateStatus === "technical_error") return;
    if (instantPlateStatus === "manual_ready") return;
    if (instantPlateStatus === "creating_session") return;

    // Is there any active uploads currently processing?
    const isUploadingAny = bgUploadItems.some(item => item.status === 'uploading');
    if (isUploadingAny) return;

    // Find first waiting queue item
    const nextPendingIndex = bgUploadItems.findIndex(item => item.status === 'pending');
    if (nextPendingIndex !== -1) {
      processBgUpload(nextPendingIndex);
    }
  }, [bgUploadItems, cameraMode, tempSessionDocId, instantPlateStatus]);

  // Automated trigger to complete the BG upload sessions when user clicked 'Xong' but was waiting for final items
  useEffect(() => {
    if (cameraMode === 'upload_now' && isCompletingBg) {
      const activeOrPending = bgUploadItems.some(item => item.status === 'pending' || item.status === 'uploading');
      if (!activeOrPending) {
        handleBgUploadComplete();
      }
    }
  }, [bgUploadItems, isCompletingBg, cameraMode]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      const newImages = newFiles.map(file => ({
        file,
        preview: URL.createObjectURL(file as Blob),
        id: Math.random().toString(36).substring(2, 9)
      }));
      
      const hasFirstImagePreviously = images.length > 0;
      const combined = [...images, ...newImages];
      if (combined.length > 15) {
        alert('Nên upload tối đa 15 ảnh/lần để app hoạt động ổn định.');
      }
      const finalImages = combined.slice(0, 15);
      setImages(finalImages);

      if (!hasFirstImagePreviously && finalImages.length > 0) {
        startRecognitionForFirstFile(finalImages[0].file, finalImages);
      }
    }
    // Reset file input value so exact same file can be selected again if desired
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleNativeCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      const mapped = newFiles.map(file => ({
        file,
        preview: URL.createObjectURL(file as Blob),
        id: Math.random().toString(36).substring(2, 9)
      }));
      
      const hasFirstImagePreviously = nativeCapturedImages.length > 0;
      const combined = [...nativeCapturedImages, ...mapped];
      setNativeCapturedImages(combined);
      setIsNativeCameraActive(true);

      if (!hasFirstImagePreviously && combined.length > 0) {
        if (!plateRef.current.trim()) {
          startPendingRecognitionForFirstFile(combined[0].file);
        }
      }
    } else {
      // User cancelled camera
      if (nativeCapturedImages.length === 0) {
        setIsNativeCameraActive(false);
      }
    }
    // Always reset value of the input
    if (e.target) {
      e.target.value = '';
    }
  };

  const removeNativeCapturedImage = (id: string) => {
    if (nativeCapturedImages.length === 0) return;
    
    const firstImageIdBeforeRemove = nativeCapturedImages[0]?.id;
    const finalImages = nativeCapturedImages.filter(img => img.id !== id);
    
    // Revoke object URL
    const removedImg = nativeCapturedImages.find(i => i.id === id);
    if (removedImg) {
      URL.revokeObjectURL(removedImg.preview);
    }
    
    setNativeCapturedImages(finalImages);

    if (id === firstImageIdBeforeRemove) {
      runIdRef.current += 1;
      setPendingRecognition(null);

      if (finalImages.length > 0) {
        if (!plateRef.current.trim()) {
          startPendingRecognitionForFirstFile(finalImages[0].file);
        }
      }
    }
  };

  const handleNativeCameraCancelClick = () => {
    if (nativeCapturedImages.length > 0) {
      setShowCancelNativeConfirm(true);
    } else {
      runIdRef.current += 1;
      setPendingRecognition(null);
      setIsNativeCameraActive(false);
    }
  };

  const confirmCancelAndClose = () => {
    nativeCapturedImages.forEach(img => URL.revokeObjectURL(img.preview));
    setNativeCapturedImages([]);
    setShowCancelNativeConfirm(false);
    setIsNativeCameraActive(false);
    runIdRef.current += 1;
    setPendingRecognition(null);
  };

  const handleNativeCameraConfirmClick = () => {
    const hasFirstImagePreviously = images.length > 0;
    const combined = [...images, ...nativeCapturedImages];
    if (combined.length > 15) {
      alert('Nên upload tối đa 15 ảnh/lần để app hoạt động ổn định.');
    }
    const finalImages = combined.slice(0, 15);
    setImages(finalImages);

    // Apply or bridge the pending recognition
    if (!hasFirstImagePreviously && finalImages.length > 0) {
      if (!plateRef.current.trim()) {
        if (pendingRecognition) {
          if (pendingRecognition.status === 'processing') {
            setRecognitionStatus('processing');
            setRecognitionResult(null);
            recognizedFingerprintRef.current = pendingRecognition.fingerprint;
          } else {
            const result = pendingRecognition.result;
            if (result) {
              setRecognitionResult(result);
              const normalizedPlate = normalizePlateForInput(
                result.plateNormalized || result.plateDisplay
              );
              if (pendingRecognition.status === 'accepted') {
                if (normalizedPlate) {
                  setPlate(normalizedPlate);
                  plateRef.current = normalizedPlate;
                  setRecognitionStatus('accepted');
                } else {
                  setRecognitionStatus('not_detected');
                }
              } else if (pendingRecognition.status === 'review') {
                if (normalizedPlate) {
                  setPlate(normalizedPlate);
                  plateRef.current = normalizedPlate;
                }
                setRecognitionStatus('review');
              } else if (pendingRecognition.status === 'not_detected') {
                setRecognitionStatus('not_detected');
              } else if (pendingRecognition.status === 'technical_error') {
                setRecognitionStatus('technical_error');
              }
            } else {
              if (pendingRecognition.status === 'not_detected') {
                setRecognitionStatus('not_detected');
              } else if (pendingRecognition.status === 'technical_error') {
                setRecognitionStatus('technical_error');
              }
            }
          }
        } else {
          startRecognitionForFirstFile(finalImages[0].file, finalImages);
        }
      }
    }

    setNativeCapturedImages([]);
    setPendingRecognition(null);
    isNativeCameraActiveRef.current = false;
    setIsNativeCameraActive(false);
  };

  const removeImage = (id: string) => {
    if (images.length === 0) return;
    
    const firstImageIdBeforeRemove = images[0]?.id;
    const finalImages = images.filter(img => img.id !== id);
    setImages(finalImages);

    if (id === firstImageIdBeforeRemove) {
      runIdRef.current += 1;
      recognizedFingerprintRef.current = null;
      
      if (finalImages.length > 0) {
        startRecognitionForFirstFile(finalImages[0].file, finalImages);
      } else {
        setRecognitionStatus('idle');
        setRecognitionResult(null);
      }
    }
  };

  const resetForm = () => {
    setPlate('');
    setRo('');
    setNote('');
    setImages([]);
    setSuccess(false);
    setError('');
    setBgUploadItems([]);
    setTempSessionDocId(null);
    setIsCompletingBg(false);
    setCameraError(null);
    setModalError('');
    runIdRef.current += 1;
    recognizedFingerprintRef.current = null;
    setRecognitionStatus('idle');
    setRecognitionResult(null);
  };

  // Start back system camera using modern constraint patterns
  const startCamera = async (mode: 'continuous' | 'upload_now') => {
    try {
      setLocalCapturedImages([]);
      setCameraError(null);
      setCameraMode(mode);
      setCameraRotationOffset(0);
      setShowManualPlateSheet(false);

      // Checks for navigator & mediaDevices support in iframe environments
      if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Trình duyệt hoặc môi trường xem trước chưa hỗ trợ quay chụp / mở camera trực tiếp. Vui lòng thử trên điện thoại thật hoặc dùng chức năng Chọn ảnh.");
      }

      // Proactively inspect available media devices to detect if any camera is present
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length === 0) {
          throw new Error("Không tìm thấy thiết bị camera nào được kết nối. Vui lòng cắm camera, sử dụng điện thoại hoặc dùng chức năng Chọn ảnh.");
        }
      } catch (enumErr: any) {
        console.warn("enumerateDevices check skipped or failed:", enumErr);
        if (enumErr?.message && enumErr.message.includes("Không tìm thấy thiết bị camera")) {
          throw enumErr;
        }
      }

      let mediaStream: MediaStream;
      try {
        // Option 1: Ideal environment-facing camera with optimal resolutions
        const constraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        console.warn("Primary camera constraints mismatch, trying fallback 1...", firstErr);
        try {
          // Option 2: Default environment constraint with no specified resolution
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
          });
        } catch (secondErr) {
          console.warn("Fallback 1 failed, trying fallback 2 (any available camera)...", secondErr);
          // Option 3: Standard default camera (any available device stream)
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      }

      setStream(mediaStream);

      // Bind to current preview viewport
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(playErr => {
            console.error("Error starting camera player loop: ", playErr);
          });
        }
      }, 300);
    } catch (err: any) {
      const errName = err?.name || "Error";
      const errMsgVal = err?.message || "";
      console.error("Camera error:", errName, errMsgVal);

      let friendlyMsg = "Không mở được camera. Vui lòng chọn ảnh từ thư viện.";
      if (errName === "NotFoundError" || errName === "DevicesNotFoundError" || errMsgVal.includes("Requested device not found") || errMsgVal.includes("Device not found")) {
        friendlyMsg = "Không tìm thấy camera trên thiết bị này.";
      } else if (errName === "NotAllowedError" || errName === "PermissionDeniedError" || errMsgVal.includes("Permission denied")) {
        friendlyMsg = "Trình duyệt chưa được cấp quyền camera.";
      } else if (errName === "NotReadableError" || errMsgVal.includes("Source unavailable") || errMsgVal.includes("Device in use")) {
        friendlyMsg = "Camera đang được ứng dụng khác sử dụng.";
      } else if (errName === "OverconstrainedError" || errMsgVal.includes("Constraint not satisfied")) {
        friendlyMsg = "Không tìm thấy camera sau, vui lòng thử camera mặc định.";
      } else if (errMsgVal) {
        friendlyMsg = errMsgVal;
      }
      setCameraError(friendlyMsg);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.error("Error stopping streaming track on stop camera", e);
        }
      });
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleVideoLoadedMetadata = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (window.innerHeight > window.innerWidth && (video.videoWidth || 0) > (video.videoHeight || 0)) {
      // Tự động bật xoay ngang (270) nếu màn hình dọc nhưng camera trả video nằm ngang
      setCameraRotationOffset(270);
    } else {
      setCameraRotationOffset(0);
    }
  };

  const takeSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    
    console.log("[CAMERA_CAPTURE_DEBUG]", {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenAngle: screen.orientation?.angle,
      windowOrientation: window.orientation,
      trackSettings: stream?.getVideoTracks?.()[0]?.getSettings?.(),
      rotationOffset: cameraRotationOffset
    });

    try {
      const canvas = document.createElement('canvas');
      const rotationOffset = cameraRotationOffset;

      const videoWidth = video.videoWidth || 1280;
      const videoHeight = video.videoHeight || 720;

      if (rotationOffset === 90 || rotationOffset === 270) {
        canvas.width = videoHeight;
        canvas.height = videoWidth;
      } else {
        canvas.width = videoWidth;
        canvas.height = videoHeight;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (rotationOffset === 90) {
          ctx.translate(canvas.width, 0);
          ctx.rotate((90 * Math.PI) / 180);
        } else if (rotationOffset === 180) {
          ctx.translate(canvas.width, canvas.height);
          ctx.rotate((180 * Math.PI) / 180);
        } else if (rotationOffset === 270) {
          ctx.translate(0, canvas.height);
          ctx.rotate((270 * Math.PI) / 180);
        }

        ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `capture-${Date.now()}-${Math.random().toString(36).substring(2, 6)}.jpg`, { type: 'image/jpeg' });
            const preview = URL.createObjectURL(blob);
            const id = Math.random().toString(36).substring(2, 9);

            if (cameraMode === 'continuous') {
              setLocalCapturedImages(prev => [...prev, { file, preview, id }]);
            } else if (cameraMode === 'upload_now') {
              const isFirstImage = bgUploadItems.length === 0;
              setBgUploadItems(prev => [...prev, {
                id,
                file,
                preview,
                status: 'pending',
                progress: 0
              }]);

              if (isFirstImage && !instantPlateConfirmedRef.current) {
                performInstantPlateRecognition(file);
              }
            }
          }
        }, 'image/jpeg', 0.95);
      }
    } catch (err) {
      console.error("Snapshot canvas context capture failure", err);
    }
  };

  // Continuous Camera cancel execution
  const handleCameraCancel = async () => {
    if (cameraMode === 'continuous') {
      if (localCapturedImages.length > 0) {
        const confirmCancel = window.confirm("Bạn muốn hủy các ảnh vừa chụp?");
        if (!confirmCancel) return;
      }
      setLocalCapturedImages([]);
      stopCamera();
      setCameraMode(null);
    } else if (cameraMode === 'upload_now') {
      const totalCaptured = bgUploadItems.length;
      const completedItems = bgUploadItems.filter(item => item.status === 'completed');

      // Helper function to perform cancel clean up steps
      const performCancelCleanup = () => {
        instantRecognitionRunIdRef.current += 1;
        setInstantPlateStatus("idle");
        instantRecognitionFingerprintRef.current = null;
        if (!instantPlateConfirmedRef.current) {
          setPlate('');
          plateRef.current = '';
        }
        instantPlateConfirmedRef.current = false;

        bgUploadItems.forEach(item => {
          if (item.preview) {
            try {
              URL.revokeObjectURL(item.preview);
            } catch (e) {
              console.warn("Revoking object URL skipped", e);
            }
          }
        });
      };

      if (totalCaptured === 0) {
        performCancelCleanup();
        stopCamera();
        setCameraMode(null);
        setUploading(true);
        setError("Đang hủy bỏ...");
        try {
          if (tempSessionDocId) {
            const docRef = doc(db, 'cars', tempSessionDocId);
            await deleteDoc(docRef).catch(console.error);
          }
        } catch (err) {
          console.error("Error deleting temp document:", err);
        } finally {
          setBgUploadItems([]);
          setTempSessionDocId(null);
          setUploading(false);
          setError('');
        }
        return;
      }

      // Đã chụp ảnh nhưng chưa có ảnh nào hoàn thành upload thành công
      if (completedItems.length === 0) {
        const confirmCancel = window.confirm("Bạn muốn hủy các ảnh vừa chụp?");
        if (!confirmCancel) return;

        performCancelCleanup();
        stopCamera();
        setCameraMode(null);
        setUploading(true);
        setError("Đang hủy bỏ...");
        try {
          if (tempSessionDocId) {
            const docRef = doc(db, 'cars', tempSessionDocId);
            await deleteDoc(docRef).catch(console.error);
          }
        } catch (err) {
          console.error("Error deleting temp document:", err);
        } finally {
          setBgUploadItems([]);
          setTempSessionDocId(null);
          setUploading(false);
          setError('');
        }
        return;
      }

      // Đã có ít nhất 1 ảnh upload thành công
      const confirmDelete = window.confirm("Một số ảnh đã được tải lên. Bạn có muốn xóa các ảnh này không?");
      if (!confirmDelete) return;

      performCancelCleanup();
      stopCamera();
      setCameraMode(null);
      setUploading(true);
      setError("Đang hủy bỏ phiên và dọn dẹp bộ nhớ...");

      try {
        // Delete all successfully uploaded storage objects
        for (const item of completedItems) {
          if (item.storagePath) {
            const imageRef = ref(storage, item.storagePath);
            await deleteObject(imageRef).catch(err => {
              console.warn("Could not delete file item on cancel rollback:", err);
            });
          }
        }

        // Delete temporary session document in firestore
        if (tempSessionDocId) {
          const docRef = doc(db, 'cars', tempSessionDocId);
          await deleteDoc(docRef).catch(console.error);
        }
      } catch (err) {
        console.error("Error rollbacking temporary uploads:", err);
      } finally {
        setBgUploadItems([]);
        setTempSessionDocId(null);
        setUploading(false);
        setError('');
      }
    }
  };

  // End system camera capture mode cleanly
  const handleCameraDone = () => {
    if (cameraMode === 'continuous') {
      // Push Continuous outputs back to primary editor
      const hasFirstImagePreviously = images.length > 0;
      const combined = [...images, ...localCapturedImages];
      if (combined.length > 15) {
        alert("Nên upload tối đa 15 ảnh/lần để app hoạt động ổn định.");
      }
      const finalImages = combined.slice(0, 15);
      setImages(finalImages);

      if (!hasFirstImagePreviously && finalImages.length > 0) {
        startRecognitionForFirstFile(finalImages[0].file, finalImages);
      }

      setLocalCapturedImages([]);
      stopCamera();
      setCameraMode(null);
    } else if (cameraMode === 'upload_now') {
      if (isDoneDisabled) {
        alert("Không thể hoàn tất phiên chụp lúc này: " + (doneButtonReason || "Đang xử lý"));
        return;
      }
      if (!instantPlateConfirmedRef.current) {
        const val = plateRef.current || plate;
        const normalized = normalizePlateForInput(val);
        const isValid = isPlateValueValid(normalized);

        if (isValid) {
          setPlate(normalized);
          plateRef.current = normalized;
          setInstantPlateStatus("creating_session");
          instantPlateConfirmedRef.current = true;
          
          initializeInstantUploadSession(normalized).then(sessionDocId => {
            if (sessionDocId) {
              setInstantPlateStatus("accepted");
              handleBgUploadComplete();
            } else {
              setInstantPlateStatus("technical_error");
              instantPlateConfirmedRef.current = false;
            }
          });
        } else {
          setShowManualPlateSheet(true);
          alert("Vui lòng nhập biển số để hoàn tất phiên.");
        }
      } else {
        handleBgUploadComplete();
      }
    }
  };

  // Background queue list compression and upload task logic
  const processBgUpload = async (index: number) => {
    const item = bgUploadItems[index];
    if (!item) return;

    setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'uploading', progress: 0 } : img));

    try {
      // Robust normalized plate string resolution
      const activePlate = (plateRef.current || plate || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!activePlate) {
        throw new Error("Không thể tải lên ảnh vì biển số xe chưa được xác định.");
      }

      // Consistent compression options as requested
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1000,
        useWebWorker: true,
        initialQuality: 0.65
      };
      const compressedFile = await imageCompression(item.file, options);

      // Path layout matching existing uploads exactly
      const storagePath = `car-images/${activePlate}/${Date.now()}-${item.id}.jpg`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, compressedFile);

      uploadTask.on('state_changed',
        (snapshot) => {
          const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, progress: pct } : img));
        },
        async (upErr) => {
          console.error("Storage upload item failure:", upErr);
          setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'error' } : img));
          await logClientError("processBgUpload.uploadTask", upErr, { itemId: item.id, activePlate });
        },
        async () => {
          try {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            setBgUploadItems(prev => prev.map((img, i) => i === index ? {
              ...img,
              status: 'completed',
              progress: 100,
              url: downloadUrl,
              storagePath
            } : img));
          } catch (err: any) {
            console.error("Error getting download URL for background Item:", err);
            setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'error' } : img));
            await logClientError("processBgUpload.getDownloadURL", err, { itemId: item.id, activePlate });
          }
        }
      );
    } catch (compErr: any) {
      console.error("Compression/Upload component error on background item:", compErr);
      setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'error' } : img));
      await logClientError("processBgUpload.compression", compErr, { itemId: item.id });
    }
  };

  const retryBgUpload = (id: string) => {
    setBgUploadItems(prev => prev.map(item => item.id === id ? { ...item, status: 'pending', progress: 0 } : item));
  };

  const removeBgUploadItem = async (id: string) => {
    const item = bgUploadItems.find(img => img.id === id);
    if (!item) return;

    // Delete from Storage if it had succeeded
    if (item.status === 'completed' && item.storagePath) {
      try {
        const imageRef = ref(storage, item.storagePath);
        await deleteObject(imageRef).catch(err => {
          console.warn("Storage deletion silent ignore:", err);
        });
      } catch (err) {
        console.error("Firebase Storage delete failure:", err);
      }
    }

    setBgUploadItems(prev => prev.filter(img => img.id !== id));
  };

  const handleBgUploadComplete = async () => {
    try {
      const activeOrPending = bgUploadItems.some(item => item.status === 'pending' || item.status === 'uploading');
      if (activeOrPending) {
        setIsCompletingBg(true);
        return;
      }

      setIsCompletingBg(true);
      setUploading(true);
      setError('');

      const completedItems = bgUploadItems.filter(item => item.status === 'completed');
      if (completedItems.length === 0) {
        // Discard empty temporary session
        if (tempSessionDocId) {
          const docRef = doc(db, 'cars', tempSessionDocId);
          await deleteDoc(docRef).catch(console.error);
        }
        alert("Vui lòng chụp ít nhất 1 ảnh hoặc bấm Hủy để quay lại.");
        stopCamera();
        setCameraMode(null);
        resetForm();
        return;
      }

      // Safeguard: Ensure no undefined or null values are included to prevent Firestore from throwing uncaught errors
      const urls = completedItems.map(i => i.url).filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
      const paths = completedItems.map(i => i.storagePath).filter((p): p is string => typeof p === 'string' && p.trim().length > 0);

      if (urls.length === 0) {
        throw new Error("Không có đường dẫn ảnh hợp lệ nào đã hoàn tất để lưu.");
      }

      if (!tempSessionDocId) {
        throw new Error("Không tìm thấy ID phiên (Session ID) lưu tạm thời trên máy chủ.");
      }

      const activePlate = (plateRef.current || plate || '').trim();
      const normalizedPlate = normalizePlateForInput(activePlate);
      if (!isPlateValueValid(normalizedPlate)) {
        throw new Error("Biển số xe chưa hợp lệ hoặc thiếu chữ/số. Vui lòng kiểm tra lại.");
      }

      // Save complete session data structure onto Firestore
      const docRef = doc(db, 'cars', tempSessionDocId);
      await updateDoc(docRef, {
        imageUrls: urls,
        storagePaths: paths,
        imageCount: urls.length,
        thumbnailUrl: urls[0] || '',
        status: 'active', // Sets to active to publish session fully
        uploadedByUid: user?.uid || '',
        uploadedByEmail: user?.email || '',
        uploadedByName: user?.displayName || ''
      });

      // ONLY stop camera and close modal on successful save!
      stopCamera();
      setCameraMode(null);
      setSuccess(true);
    } catch (err: any) {
      console.error("Failing update background session details:", err);
      
      // Log diagnostics safely
      await logClientError("handleBgUploadComplete", err, {
        plate,
        tempSessionDocId,
        bgUploadCount: bgUploadItems.length,
        completedCount: bgUploadItems.filter(item => item.status === 'completed').length,
        pendingCount: bgUploadItems.filter(item => item.status === 'pending').length,
        uploadingCount: bgUploadItems.filter(item => item.status === 'uploading').length,
        errorCount: bgUploadItems.filter(item => item.status === 'error').length,
      });

      alert(
        "Chưa thể hoàn tất phiên. Ảnh đã chụp vẫn đang giữ trên máy, vui lòng thử bấm Xong lại hoặc kiểm tra kết nối mạng.\nChi tiết lỗi: " + 
        (err.message || err)
      );
    } finally {
      setUploading(false);
      setIsCompletingBg(false);
    }
  };

  // Option select triggering execution
  const triggerOptSelection = async (option: 'continuous' | 'upload_now' | 'capture_native' | 'pick_files') => {
    setModalError('');

    if (option === 'pick_files') {
      setIsOptionModalOpen(false);
      fileInputRef.current?.click();
    } else if (option === 'capture_native') {
      setIsOptionModalOpen(false);
      setNativeCapturedImages([]);
      setIsNativeCameraActive(true);
      setTimeout(() => {
        nativeCameraInputRef.current?.click();
      }, 100);
    } else if (option === 'continuous') {
      console.log("click continuous capture");
      setIsOptionModalOpen(false);
      await startCamera('continuous');
    } else if (option === 'upload_now') {
      console.log("click instant upload");
      console.log("open instant upload mode");

      // Reset all sticking background upload states to prevent getting stuck
      setUploading(false);
      setIsCompletingBg(false);
      setProgress(0);
      setBgUploadItems([]);
      setLocalCapturedImages([]);
      setNativeCapturedImages([]);
      setIsNativeCameraActive(false);
      setCameraError(null);

      setIsOptionModalOpen(false);
      setError('');

      const existingPlate = plate.trim();

      try {
        // Start camera immediately to give instant UI feedback
        await startCamera('upload_now');

        if (existingPlate) {
          // License plate is already completed/inputted beforehand!
          instantPlateConfirmedRef.current = true;
          setInstantPlateStatus("accepted");
          // Create temporary Firestore document right away
          await initializeInstantUploadSession(existingPlate);
        } else {
          // License plate is empty. We wait for capture and automatic recognition!
          instantPlateConfirmedRef.current = false;
          setInstantPlateStatus("idle");
          instantRecognitionFingerprintRef.current = null;
        }
      } catch (err: any) {
        console.error("Failed to start instant upload camera:", err);
        setError("Lỗi mở camera Chụp & tải ngay: " + (err.message || err));
      }
    }
  };

  const handleUpload = async () => {
    let currentStage = 'validate_form';
    
    // Check network connectivity first
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('Thiết bị đang mất kết nối mạng. Vui lòng kiểm tra kết nối internet rồi thử lại.');
      return;
    }

    if (!plate) {
      setError('Vui lòng nhập biển số xe');
      return;
    }
    if (images.length === 0) {
      setError('Vui lòng chọn ít nhất 1 ảnh');
      return;
    }

    if (uploading) return; // Prevent concurrent duplicate submissions

    setUploading(true);
    setProgress(0);
    setError('');

    const uploadUrls: string[] = [];
    const uploadPaths: string[] = [];
    const totalSteps = images.length;

    try {
      currentStage = 'prepare_images';
      console.log(`[handleUpload] Starting upload for plate: ${plate} with ${images.length} images.`);

      for (let i = 0; i < images.length; i++) {
        const item = images[i];
        let fileToUpload: File | Blob = item.file;

        // 1. Compression
        currentStage = 'compress_image';
        try {
          const options = {
            maxSizeMB: 1,
            maxWidthOrHeight: 1000,
            useWebWorker: true,
            initialQuality: 0.65
          };
          fileToUpload = await imageCompression(item.file, options);
        } catch (compressErr: any) {
          console.warn(`[handleUpload] Compression failed for image index ${i}, falling back to original file`, compressErr);
          
          // Log compression failure warning silently
          await logClientError('compress_image_warning', compressErr, {
            source: 'PhotoCapture.normal_upload',
            fileName: item.file.name,
            fileSize: item.file.size,
            fileType: item.file.type,
            index: i,
            totalImages: images.length
          });

          // Safeguard: Check if the original image size exceeds reasonable upload limits
          const MAX_SIZE_LIMIT = 15 * 1024 * 1024; // 15MB
          if (item.file.size > MAX_SIZE_LIMIT) {
            throw new Error(`Ảnh thứ ${i + 1} quá lớn (${(item.file.size / (1024 * 1024)).toFixed(1)}MB) và không thể nén được trên thiết bị này. Vui lòng chụp ảnh độ phân giải thấp hơn hoặc thử lại trên máy tính.`);
          }

          fileToUpload = item.file;
        }

        // 2. Storage Upload
        currentStage = 'upload_storage';
        const storagePath = `car-images/${plate.toUpperCase().replace(/[^A-Z0-9]/g, '')}/${Date.now()}-${item.id}.jpg`;
        const storageRef = ref(storage, storagePath);
        const uploadTask = uploadBytesResumable(storageRef, fileToUpload);

        await new Promise((resolve, reject) => {
          uploadTask.on('state_changed',
            (snapshot) => {
              const currentProgress = (i / totalSteps) * 100 + (snapshot.bytesTransferred / snapshot.totalBytes) * (100 / totalSteps);
              setProgress(currentProgress);
            },
            (error) => {
              reject(error);
            },
            async () => {
              try {
                currentStage = 'get_download_url';
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                uploadUrls.push(url);
                uploadPaths.push(storagePath);
                resolve(null);
              } catch (err) {
                reject(err);
              }
            }
          );
        });
      }

      // 3. Firestore entry
      currentStage = 'create_firestore_session';
      const searchFields = getSearchFields(plate, ro);
      await addDoc(collection(db, 'cars'), {
        plateNumber: plate.toUpperCase(),
        plateNumberNormalized: plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        roNumber: ro,
        note,
        createdAt: Date.now(),
        imageCount: uploadUrls.length,
        thumbnailUrl: uploadUrls[0],
        imageUrls: uploadUrls,
        storagePaths: uploadPaths,
        status: 'active',
        department: selectedDepartment,
        departmentId: selectedDepartment,
        createdByUid: user?.uid || '',
        createdByEmail: user?.email || '',
        createdByName: user?.displayName || '',
        uploadedByUid: user?.uid || '',
        uploadedByEmail: user?.email || '',
        uploadedByName: user?.displayName || '',
        ...searchFields
      });

      // 4. Success cleanup
      currentStage = 'reset_form_after_success';
      setPlate('');
      setRo('');
      setNote('');
      setImages([]);
      setError('');

      setSuccess(true);
    } catch (err: any) {
      console.error(`[handleUpload] Crash at stage [${currentStage}]:`, err);

      let friendlyMessage = 'Chưa thể tải ảnh lên trên thiết bị này. Vui lòng kiểm tra mạng, thử lại bằng Chrome mới nhất hoặc chụp ít ảnh hơn.';
      
      const compInfo = getBrowserCompatibilityInfo();
      if (compInfo.isLikelyInAppBrowser || compInfo.isLikelyAndroidWebView || compInfo.isLikelyIOSWebView) {
        friendlyMessage += '\n\nTrình duyệt hiện tại có thể không tương thích tốt. Vui lòng mở bằng Chrome hoặc cập nhật Android System WebView.';
      }
      
      setError(friendlyMessage);

      // Log the exact error and current stage to Firestore
      await logClientError(currentStage, err, {
        source: 'PhotoCapture.normal_upload',
        imageCount: images.length,
        plate,
        ro,
        imageDetails: images.map(img => ({
          size: img.file.size,
          type: img.file.type,
          name: img.file.name
        }))
      });
    } finally {
      setUploading(false);
      setProgress(0);
      setIsCompletingBg(false);
    }
  };

  const checkExisting = async () => {
    if (!plate) return;
    setUploading(true);
    try {
      const q = query(
        collection(db, 'cars'),
        where('plateNumber', '==', plate.toUpperCase()),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const latest = snap.docs[0].data();
        setRo(latest.roNumber || '');
        setNote(latest.note || '');
        alert('Đã tìm thấy phiên gần nhất của xe này.');
      } else {
        alert('Không tìm thấy phiên cũ của xe này.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600 animate-bounce">
          <Check size={40} strokeWidth={3} />
        </div>
        <h2 className="text-2xl font-black text-slate-900 mb-2">UPLOAD THÀNH CÔNG!</h2>
        <p className="text-slate-500 mb-8">Phiên chụp đã được lưu vào hệ thống hoàn tất.</p>
        <button
          onClick={resetForm}
          className="w-full max-w-xs py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200 active:scale-95 transition-transform cursor-pointer"
        >
          BẮT ĐẦU XE MỚI
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 pb-32 space-y-6 max-w-md mx-auto relative">
      <section className="bg-white rounded-[32px] overflow-hidden shadow-sm border border-gray-100 flex flex-col">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <h2 className="text-lg font-bold text-toyota-navy flex items-center gap-2">
            <span className="w-2 h-6 bg-toyota-red rounded-full"></span>
            Tạo Phiên Chụp Mới
          </h2>
          <p className="text-xs text-gray-500 mt-1 italic font-medium">Quản lý ảnh xe dịch vụ theo từng phiên chụp</p>
        </div>

        {browserWarnings.length > 0 && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 animate-fade-in text-left">
            <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
            <div className="space-y-1">
              <p className="text-[10px] text-amber-800 font-extrabold uppercase tracking-wide">Lưu ý Trình duyệt</p>
              {browserWarnings.map((warning, idx) => (
                <p key={idx} className="text-[10px] text-amber-700 font-bold leading-normal">
                  • {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Biển số xe *</label>
              <div className="relative group">
                <input
                  type="text"
                  placeholder="Vd: 30A-123.45"
                  className="w-full p-4 bg-gray-100 rounded-2xl font-mono text-base font-bold border-2 border-transparent focus:border-toyota-red outline-none transition-all placeholder:text-gray-300"
                  value={plate}
                  onChange={(e) => handlePlateChange(e.target.value)}
                />
                <button
                  onClick={checkExisting}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-toyota-navy opacity-40 hover:opacity-100 transition-opacity"
                >
                  <Search size={18} />
                </button>
              </div>

              {/* Plate Recognition Status Section */}
              {recognitionStatus !== 'idle' && (
                <div className="text-[11px] font-sans font-bold flex flex-col gap-1 text-left mt-1.5 animate-fadeIn">
                  {recognitionStatus === 'processing' && (
                    <div className="flex items-center gap-1.5 text-amber-600 animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang đọc biển số…</span>
                    </div>
                  )}
                  {recognitionStatus === 'accepted' && (
                    <div className="text-green-600 flex items-center gap-1">
                      <span>✓ Đã nhận diện biển số</span>
                    </div>
                  )}
                  {recognitionStatus === 'review' && (
                    <div className="text-amber-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                      <span>Kết quả cần kiểm tra</span>
                    </div>
                  )}
                  {recognitionStatus === 'not_detected' && (
                    <div className="text-gray-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                      <span>Không nhận diện được – vui lòng nhập thủ công</span>
                    </div>
                  )}
                  {recognitionStatus === 'technical_error' && (
                    <div className="text-orange-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                      <span>Dịch vụ nhận diện đang tạm thời không ổn định</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Lệnh (RO)</label>
              <input
                type="text"
                placeholder="RO-1234"
                className="w-full p-4 bg-gray-100 rounded-2xl font-mono text-base font-bold border-2 border-transparent focus:border-toyota-navy outline-none transition-all placeholder:text-gray-300"
                value={ro}
                onChange={(e) => setRo(e.target.value)}
              />
            </div>
          </div>

          {user?.role === 'admin' ? (
            <div className="space-y-2 animate-fadeIn font-sans text-left">
              <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Bộ phận nhận dạng phiên *</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full p-4 bg-gray-100 rounded-2xl font-bold text-sm border-2 border-transparent focus:border-toyota-navy outline-none transition-all placeholder:text-gray-300 cursor-pointer"
              >
                <option value="" disabled>-- Chọn bộ phận --</option>
                {activeDepts.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2 animate-fadeIn font-sans text-left">
              <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">Bộ phận của bạn</label>
              <input
                type="text"
                disabled
                className="w-full p-4 bg-gray-150 rounded-2xl font-bold text-sm text-gray-500 border-2 border-transparent cursor-not-allowed outline-none"
                value={allDeptsMap[user?.departmentId || user?.department || 'service'] || user?.departmentId || user?.department || 'Dịch vụ'}
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Ghi chú phiên chụp</label>
            <textarea
              placeholder="Mô tả tình trạng xe..."
              className="w-full p-4 bg-gray-100 rounded-2xl h-24 resize-none outline-none border-2 border-transparent focus:border-gray-300 transition-all font-medium text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Hình ảnh (Tối đa 15)</label>
              <span className="text-[10px] text-gray-400 font-bold italic font-mono">Tự động nén (0.65 quality)</span>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={() => { setModalError(''); setIsOptionModalOpen(true); }}
                className="aspect-square bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center text-gray-400 hover:bg-gray-100 hover:border-gray-400 transition-all active:scale-95 cursor-pointer"
              >
                <Camera size={24} strokeWidth={2.5} />
                <span className="text-[9px] font-black mt-1 uppercase">Thêm ảnh</span>
              </button>

              <AnimatePresence>
                {images.map((img) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    key={img.id}
                    className="relative aspect-square"
                  >
                    <img src={img.preview} alt="preview" className="w-full h-full object-cover rounded-2xl shadow-sm border border-gray-100" />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 bg-toyota-red text-white w-5 h-5 rounded-full flex items-center justify-center shadow-lg active:scale-110 transition-transform"
                    >
                      <X size={12} strokeWidth={3} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <input
              type="file"
              multiple
              accept="image/*"
              ref={fileInputRef}
              className="hidden"
              onChange={handleImageSelect}
            />

            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={nativeCameraInputRef}
              className="hidden"
              onChange={handleNativeCameraChange}
            />

            <p className="text-[11px] text-gray-400 font-bold italic mt-2 text-left">
              * Ảnh đầu tiên nên chụp trực diện đầu xe và nhìn rõ biển số.
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 text-toyota-red p-4 rounded-2xl text-[11px] font-bold border border-red-100 flex items-center gap-2 italic"
            >
              <span>⚠️</span> {error}
            </motion.div>
          )}

          {uploading && (
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <div className="flex justify-between text-[11px] font-black uppercase mb-1.5">
                <span className="text-toyota-navy">Đang xử lý ảnh...</span>
                <span className="text-toyota-red">{Math.round(progress)}%</span>
              </div>
              <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-toyota-red"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {deptError && (
          <div className="mx-6 mb-3 p-4 bg-red-50 border border-red-200 text-toyota-red rounded-2xl text-[11px] font-bold text-center leading-relaxed">
            ⚠️ {deptError}
          </div>
        )}

        <div className="p-6 bg-white border-t border-gray-100">
          <button
            disabled={uploading || !!deptError || (user?.role === 'admin' && !selectedDepartment)}
            onClick={handleUpload}
            className={cn(
              "w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-white shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer",
              uploading || !!deptError || (user?.role === 'admin' && !selectedDepartment)
                ? "bg-red-200 shadow-none cursor-not-allowed"
                : "bg-toyota-red hover:opacity-90 shadow-red-200"
            )}
          >
            {uploading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            {uploading ? 'Đang Upload' : 'Upload Phiên'}
          </button>
        </div>
      </section>

      {/* Choice option modal overlay */}
      <AnimatePresence>
        {isOptionModalOpen && (
          <div className="fixed inset-0 bg-toyota-navy/85 backdrop-blur-md z-[90] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="bg-white w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl flex flex-col border border-gray-100 p-6 space-y-4"
            >
              <div className="text-center pb-2 border-b border-gray-50">
                <h3 className="text-base font-black text-toyota-navy uppercase tracking-tight">Chọn cách thêm ảnh</h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vui lòng chọn phương thức thêm ảnh</p>
              </div>

              {modalError && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold border border-red-100 text-center leading-relaxed">
                  ⚠️ {modalError}
                </div>
              )}

              <div className="space-y-2.5">
                {/* Continuous Capture Option (TEMPORARILY HIDDEN) */}
                {false && (
                  <button
                    onClick={() => triggerOptSelection('continuous')}
                    className="w-full p-4 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer"
                  >
                    <div className="bg-red-50 text-toyota-red p-3 rounded-xl group-hover:scale-105 duration-200">
                      <Camera size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-toyota-navy uppercase">Chụp liên tục</h4>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Chụp nhiều ảnh trước, tải sau</p>
                    </div>
                  </button>
                )}

                {/* Chụp & tải ngay Capture Option */}
                <button
                  onClick={() => triggerOptSelection('upload_now')}
                  className="w-full p-4 bg-red-50/40 hover:bg-red-50/80 border border-red-100/60 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer shadow-sm"
                >
                  <div className="bg-toyota-red text-white p-3 rounded-xl group-hover:scale-105 duration-200 relative flex items-center justify-center shadow-sm">
                    <Camera size={20} strokeWidth={2.5} />
                    <div className="absolute -top-1 -right-1 bg-toyota-navy text-white rounded-full p-0.5 shadow-md border border-white">
                      <Upload size={8} strokeWidth={3} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-toyota-navy uppercase">Chụp & tải ngay</h4>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">Phù hợp khi mạng ổn định</p>
                  </div>
                </button>

                {/* Chụp bằng camera thường Option */}
                <button
                  onClick={() => triggerOptSelection('capture_native')}
                  className="w-full p-4 bg-blue-50/30 hover:bg-blue-50/60 border border-blue-100/50 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer shadow-sm"
                >
                  <div className="bg-toyota-navy text-white p-3 rounded-xl group-hover:scale-105 duration-200 shadow-sm">
                    <Camera size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-toyota-navy uppercase">Chụp bằng camera thường</h4>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">Khung hình rộng hơn, phù hợp chỗ chụp hẹp</p>
                  </div>
                </button>

                {/* Library Album Select Option */}
                <button
                  onClick={() => triggerOptSelection('pick_files')}
                  className="w-full p-4 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer"
                >
                  <div className="bg-amber-50 text-amber-600 p-3 rounded-xl group-hover:scale-105 duration-200">
                    <RotateCcw size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-toyota-navy uppercase">Chọn ảnh</h4>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">Chọn ảnh có sẵn</p>
                  </div>
                </button>
              </div>

              <button
                onClick={() => setIsOptionModalOpen(false)}
                className="w-full py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-500 font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 duration-100 cursor-pointer"
              >
                Hủy / Đóng
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Native Camera Screen Overlay */}
      <AnimatePresence>
        {isNativeCameraActive && (
          <div className="fixed inset-0 bg-toyota-navy bg-opacity-95 backdrop-blur-md z-[95] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl flex flex-col border border-gray-100 max-h-[90vh] p-6 relative"
            >
              <div className="text-center pb-3 border-b border-gray-100 flex justify-between items-center">
                <div className="text-left">
                  <h3 className="text-sm font-black text-toyota-navy uppercase tracking-tight">
                    Chụp bằng camera thường
                  </h3>
                  <p className="text-[11px] text-gray-500 font-bold mt-0.5">
                    Đã chụp: <span className="text-toyota-red text-xs font-black">{nativeCapturedImages.length}</span> ảnh
                  </p>
                </div>
                {/* Close/Cancel top icon button */}
                <button
                  onClick={handleNativeCameraCancelClick}
                  className="p-1 z-[1] hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={20} strokeWidth={2.5} />
                </button>
              </div>

              <div className="text-left py-2 border-b border-gray-50">
                <p className="text-[11px] text-gray-400 font-bold italic">
                  * Ảnh đầu tiên sẽ được dùng để tự động nhận diện biển số.
                </p>
              </div>

              {/* Thumbnails list */}
              <div className="flex-1 overflow-y-auto py-4 min-h-[150px]">
                {nativeCapturedImages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-8 space-y-2">
                    <div className="p-4 bg-gray-50 rounded-2xl text-gray-300">
                      <Camera size={36} strokeWidth={1.5} />
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Chưa có ảnh nào được chụp</p>
                    <p className="text-[10px] text-gray-400 max-w-[200px] leading-relaxed">Hãy bấm nút "Chụp tiếp / Bắt đầu" bên dưới để mở camera của máy</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <AnimatePresence>
                      {nativeCapturedImages.map((img) => (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          key={img.id}
                          className="relative aspect-square rounded-2xl overflow-hidden border border-gray-100 group shadow-sm bg-gray-50"
                        >
                          <img
                            src={img.preview}
                            alt="Captured preview"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeNativeCapturedImage(img.id)}
                            className="absolute top-1.5 right-1.5 bg-toyota-red text-white w-6 h-6 rounded-full flex items-center justify-center shadow-md active:scale-110 transition-transform"
                          >
                            <Trash2 size={12} strokeWidth={2.5} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* Temporary Plate Recognition Status Section */}
              {pendingRecognition && (
                <div className="mx-0 mb-3 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-between text-[11px] font-bold">
                  {pendingRecognition.status === 'processing' && (
                    <div className="flex items-center gap-2 text-toyota-navy">
                      <Loader2 className="animate-spin text-toyota-red" size={14} />
                      <span>Đang đọc biển số từ ảnh đầu tiên…</span>
                    </div>
                  )}
                  {pendingRecognition.status === 'accepted' && pendingRecognition.result && (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 className="text-emerald-500" size={14} />
                      <span>Đã nhận diện: {normalizePlateForInput(pendingRecognition.result.plateNormalized || pendingRecognition.result.plateDisplay)}</span>
                    </div>
                  )}
                  {pendingRecognition.status === 'review' && pendingRecognition.result && (
                    <div className="flex items-center gap-2 text-amber-600">
                      <AlertCircle className="text-amber-500" size={14} />
                      <span>Nhận diện được: {normalizePlateForInput(pendingRecognition.result.plateNormalized || pendingRecognition.result.plateDisplay)} – cần kiểm tra</span>
                    </div>
                  )}
                  {pendingRecognition.status === 'not_detected' && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <AlertCircle className="text-gray-400" size={14} />
                      <span>Không nhận diện được biển số từ ảnh đầu tiên</span>
                    </div>
                  )}
                  {pendingRecognition.status === 'technical_error' && (
                    <div className="flex items-center gap-2 text-red-500">
                      <AlertCircle className="text-red-400" size={14} />
                      <span>Lỗi kết nối khi nhận diện biển số</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-100 space-y-2.5">
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="w-full py-4 bg-blue-50 hover:bg-blue-100/80 border border-blue-200 text-toyota-navy rounded-2xl flex items-center justify-center gap-2 font-black text-xs uppercase tracking-wider transition-all active:scale-98 shadow-sm"
                >
                  <Camera size={16} strokeWidth={2.5} className="text-toyota-red" />
                  Chụp tiếp
                </button>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleNativeCameraCancelClick}
                    className="py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 duration-100"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleNativeCameraConfirmClick}
                    disabled={nativeCapturedImages.length === 0}
                    className="py-3 bg-toyota-red hover:opacity-90 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 duration-100 shadow-md"
                  >
                    Xong
                  </button>
                </div>
              </div>

              {/* Inline warning clear confirmation in case already has images */}
              <AnimatePresence>
                {showCancelNativeConfirm && (
                  <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col justify-center items-center p-6 text-center z-10 rounded-[32px]">
                    <div className="p-3 bg-red-50 text-toyota-red rounded-full mb-3">
                      <Trash2 size={24} strokeWidth={2} />
                    </div>
                    <h4 className="text-sm font-black text-toyota-navy uppercase mb-1">Hủy các ảnh vừa chụp?</h4>
                    <p className="text-[11px] text-gray-400 font-bold mb-4 uppercase">Quyết định này không thể hoàn tác</p>
                    <p className="text-[11px] text-gray-500 max-w-[240px] leading-relaxed mb-6">Bạn có muốn hủy bỏ toàn bộ <span className="font-extrabold text-toyota-red">{nativeCapturedImages.length}</span> ảnh đã chụp bằng camera thường?</p>
                    <div className="grid grid-cols-2 gap-3 w-full">
                      <button
                        type="button"
                        onClick={() => setShowCancelNativeConfirm(false)}
                        className="py-2.5 border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all active:scale-95"
                      >
                        Quay lại
                      </button>
                      <button
                        type="button"
                        onClick={confirmCancelAndClose}
                        className="py-2.5 bg-toyota-red text-white hover:opacity-90 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all active:scale-95 shadow-md"
                      >
                        Đồng ý Hủy
                      </button>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fullscreen camera capture overlay */}
      <AnimatePresence>
        {cameraMode && (
          <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col justify-between overflow-hidden">
            {/* Header portion */}
            <div className="p-4 flex justify-between items-center bg-black/60 backdrop-blur-md border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-toyota-red rounded-full animate-pulse" />
                <span className="text-[11px] text-white font-black uppercase tracking-wider">
                  {cameraMode === 'continuous' ? 'Chụp liên tục' : 'Chụp & tải ngay'}
                </span>
              </div>
              {cameraMode === 'upload_now' && (
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-[10px] px-3 py-0.5 rounded-full font-black uppercase tracking-widest border transition-all duration-150",
                    instantPlateStatus === 'processing'
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse"
                      : plate.trim()
                        ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30"
                  )}>
                    {instantPlateStatus === 'processing' 
                      ? 'BS: ĐANG XÁC ĐỊNH...' 
                      : plate.trim() 
                        ? `BS: ${plate.toUpperCase()}` 
                        : 'BS: CHƯA CÓ'
                    }
                  </span>
                  {!instantPlateConfirmedRef.current && !showManualPlateSheet && (
                    <button
                      type="button"
                      onClick={() => setShowManualPlateSheet(true)}
                      className="px-2.5 py-1 bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold text-[9px] uppercase tracking-wider rounded-lg transition-all border border-white/5 cursor-pointer"
                    >
                      Nhập biển số
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={handleCameraCancel}
                className="p-1.5 px-3.5 bg-white/10 hover:bg-white/20 active:scale-95 text-[10px] font-black uppercase tracking-wider text-white duration-150 rounded-xl cursor-pointer"
              >
                Hủy
              </button>
            </div>

            {cameraError ? (
              <div className="flex-1 bg-slate-900 flex flex-col items-center justify-center p-6 text-center space-y-6">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 animate-pulse">
                  <CameraOff size={32} />
                </div>
                <div className="space-y-3 max-w-sm">
                  <h3 className="text-white font-bold text-base uppercase leading-snug">
                    Không tìm thấy camera hoặc trình duyệt chưa cấp quyền camera.
                  </h3>
                  <p className="text-gray-400 text-xs font-semibold leading-relaxed">
                    Vui lòng thử trên điện thoại, kiểm tra quyền camera hoặc chọn ảnh từ thư viện.
                  </p>
                  <div className="text-[10px] text-gray-500 font-mono bg-black/40 border border-white/5 py-1.5 px-3 rounded-lg inline-block select-all mt-2">
                    Chi tiết: {cameraError}
                  </div>
                </div>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button
                    onClick={() => {
                      stopCamera();
                      setCameraMode(null);
                      setCameraError(null);
                      fileInputRef.current?.click();
                    }}
                    className="w-full py-4 bg-toyota-red text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                  >
                    Chọn ảnh thay thế
                  </button>
                  <button
                    onClick={() => {
                      stopCamera();
                      setCameraMode(null);
                      setCameraError(null);
                    }}
                    className="w-full py-3 bg-white/10 text-white/80 rounded-2xl font-bold text-xs uppercase tracking-wider hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
                  >
                    Quay lại
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Viewfinder live video */}
                <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                    onLoadedMetadata={handleVideoLoadedMetadata}
                  />

                  {/* Box frame target boundary overlay */}
                  <div className="absolute inset-8 border-2 border-dashed border-white/20 rounded-3xl pointer-events-none flex items-center justify-center">
                    <span className="text-[9px] text-white/25 font-black uppercase tracking-widest bg-black/50 px-3.5 py-1 rounded-full border border-white/5">
                      Đặt xe vào khung hình
                    </span>
                  </div>

                  {/* Compact horizontal plate failure bar (appears near the bottom of camera frame, non-blocking) */}
                  {cameraMode === 'upload_now' && 
                    bgUploadItems.length > 0 && 
                    !instantPlateConfirmedRef.current && 
                    !showManualPlateSheet && (
                      instantPlateStatus === 'not_detected' || 
                      instantPlateStatus === 'technical_error' || 
                      instantPlateStatus === 'review' || 
                      (instantPlateStatus === 'idle' && !plate.trim())
                    ) && (
                    <div className="absolute bottom-16 left-4 right-4 bg-slate-900/95 backdrop-blur-md border border-amber-500/25 px-4 py-2.5 rounded-xl z-25 flex items-center justify-between gap-3 text-left shadow-2xl max-w-sm mx-auto pointer-events-auto">
                      <p className="text-[10px] text-amber-200 font-bold leading-normal flex-1">
                        ⚠️ Chưa nhận diện được biển số. Có thể chụp tiếp hoặc nhập biển số.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowManualPlateSheet(true)}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-[9px] uppercase tracking-wider rounded-lg transition-all shadow cursor-pointer whitespace-nowrap"
                      >
                        Nhập biển số
                      </button>
                    </div>
                  )}

                  {/* Instant Upload Plate Recognition Bottom Sheet (Only shows when user clicks Nhập biển số or fails validation on Done click) */}
                  {cameraMode === 'upload_now' && showManualPlateSheet && !instantPlateConfirmedRef.current && (
                    <div className="absolute bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur-md border-t border-white/15 px-5 py-4 rounded-t-[24px] z-30 space-y-3.5 shadow-2xl pointer-events-auto text-left animate-fadeIn">
                      {/* Top drag bar visual indicator */}
                      <div className="w-10 h-1 bg-white/20 rounded-full mx-auto" />
                      
                      {/* Header row with title and close button */}
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-toyota-red rounded-full" />
                          Nhập Biển Số Xe Thủ Công
                        </h4>
                        <button
                          type="button"
                          onClick={() => setShowManualPlateSheet(false)}
                          className="p-1 text-white/55 hover:text-white hover:bg-white/10 active:scale-95 duration-100 rounded-lg cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      {/* Diagnostic Status Box */}
                      <div className="flex items-center gap-2 text-[10px] font-semibold text-white/80 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                        {instantPlateStatus === 'processing' && (
                          <div className="flex items-center gap-1.5 text-amber-400 animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Đang đọc biển số từ ảnh vừa chụp…</span>
                          </div>
                        )}
                        {instantPlateStatus === 'review' && (
                          <div className="flex items-center gap-1.5 text-amber-500">
                            <AlertCircle className="w-3 h-3" />
                            <span>Kết quả nhận diện cần kiểm tra lại</span>
                          </div>
                        )}
                        {instantPlateStatus === 'not_detected' && (
                          <div className="flex items-center gap-1.5 text-gray-300">
                            <AlertCircle className="w-3 h-3 text-gray-400" />
                            <span>Không nhận diện được biển số từ ảnh vừa chụp</span>
                          </div>
                        )}
                        {instantPlateStatus === 'technical_error' && (
                          <div className="flex items-center gap-1.5 text-orange-400">
                            <AlertCircle className="w-3 h-3" />
                            <span>Hệ thống nhận diện biển số tự động đang quá tải</span>
                          </div>
                        )}
                        {(instantPlateStatus === 'idle' || instantPlateStatus === 'manual_ready') && (
                          <div className="flex items-center gap-1.5 text-sky-400">
                            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
                            <span>Vui lòng nhập biển số xe chính xác</span>
                          </div>
                        )}
                        {instantPlateStatus === 'creating_session' && (
                          <div className="flex items-center gap-1.5 text-emerald-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Đang tạo phiên làm việc mới trên máy chủ…</span>
                          </div>
                        )}
                      </div>

                      {/* Plate input container */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Biển số xe (Bắt buộc)</label>
                        <input
                          type="text"
                          placeholder="Vd: 30A12345"
                          className="w-full p-2.5 bg-white/5 border border-white/15 rounded-xl font-mono text-xs font-bold text-white focus:border-toyota-red focus:bg-white/10 outline-none transition-all placeholder:text-white/20 uppercase"
                          value={plate}
                          onChange={(e) => handlePlateChange(e.target.value)}
                          autoFocus
                        />
                      </div>

                      {/* Display warning text when 3 images captured & AI is still processing */}
                      {bgUploadItems.length >= MAX_PENDING_INSTANT_FILES && instantPlateStatus === 'processing' && (
                        <p className="text-[10px] text-amber-300 font-extrabold leading-normal bg-amber-950/40 p-2 rounded-xl border border-amber-900/30 text-center">
                          ⚠️ Đang xác định biển số, 3 ảnh sẽ được tải lên ngay sau khi hoàn tất…
                        </p>
                      )}

                      {/* Buttons Action Area */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowManualPlateSheet(false)}
                          className="py-2.5 border border-white/15 hover:bg-white/5 text-white/80 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all active:scale-95 text-center cursor-pointer"
                        >
                          Đóng / Hủy
                        </button>
                        <button
                          type="button"
                          disabled={instantPlateStatus === 'creating_session'}
                          onClick={async () => {
                            const normalized = normalizePlateForInput(plate);
                            const isValid = isPlateValueValid(normalized);
                            if (!isValid) {
                              alert("Biển số xe không hợp lệ. Vui lòng nhập biển số xe đầy đủ có cả chữ và số.");
                              return;
                            }
                            await handleContinueInstantUpload();
                            if (instantPlateConfirmedRef.current) {
                              setShowManualPlateSheet(false);
                            }
                          }}
                          className="py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-black text-[10px] uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1 shadow-lg cursor-pointer"
                        >
                          <Check size={12} strokeWidth={3} />
                          Xác nhận biển số
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Rotation tip banner */}
                  <div className="absolute top-4 left-4 right-4 text-center pointer-events-none z-10">
                    <span className={cn(
                      "text-[9px] font-bold px-3.5 py-1.5 rounded-full border transition-all inline-block shadow-md leading-relaxed",
                      cameraRotationOffset === 270 
                        ? "bg-amber-500 text-slate-950 border-amber-400 font-extrabold animate-pulse" 
                        : "bg-black/50 text-white/60 border-white/5"
                    )}>
                      {cameraRotationOffset === 270 
                        ? "💡 Đang bật xoay ngang ảnh. Hãy quay ngang điện thoại của bạn." 
                        : "📱 Bật \"Xoay ngang\" khi cầm máy ngang."
                      }
                    </span>
                  </div>

                  {/* Continuous count trackers */}
                  <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center pointer-events-none">
                    {cameraMode === 'continuous' ? (
                      <span className="bg-black/60 border border-white/5 text-white/90 font-black text-[10px] px-3.5 py-1.5 rounded-full backdrop-blur-md uppercase tracking-wider">
                        Đã chụp: <strong className="text-toyota-red font-black">{localCapturedImages.length}</strong> ảnh
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <span className="bg-black/60 border border-white/5 text-white/90 font-black text-[10px] px-3.5 py-1.5 rounded-full backdrop-blur-md uppercase tracking-wider self-start">
                          Đã chụp: <strong className="text-toyota-red font-black">{bgUploadItems.length}</strong> ảnh
                        </span>
                        <span className="bg-black/60 border border-white/5 text-white/90 font-black text-[10px] px-3.5 py-1.5 rounded-full backdrop-blur-md uppercase tracking-wider self-start font-mono">
                          Đã lưu: <strong className="text-green-500 font-extrabold">{bgUploadItems.filter(i => i.status === 'completed').length}</strong> ảnh
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom thumbnail strip and camera click controls */}
                <div className="flex flex-col bg-black/65 border-t border-white/5 flex-shrink-0 py-6 px-4 gap-4 z-10">
                  {/* Captured continuous elements strip list */}
                  {cameraMode === 'continuous' ? (
                    localCapturedImages.length > 0 && (
                      <div className="flex gap-2.5 overflow-x-auto pb-1 max-h-20 scroller whitespace-nowrap">
                        {localCapturedImages.map((img) => (
                          <div key={img.id} className="relative w-12 h-12 flex-shrink-0 animate-scale-up">
                            <img src={img.preview} className="w-full h-full object-cover rounded-xl border border-white/10" alt="thumb" />
                            <button
                              type="button"
                              onClick={() => setLocalCapturedImages(prev => prev.filter(item => item.id !== img.id))}
                              className="absolute -top-1 -right-1 bg-toyota-red text-white w-4.5 h-4.5 rounded-full flex items-center justify-center shadow-lg active:scale-95 duration-100 cursor-pointer"
                            >
                              <X size={10} strokeWidth={3} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    bgUploadItems.length > 0 && (
                      <div className="flex gap-2.5 overflow-x-auto pb-1 max-h-24 scroller whitespace-nowrap">
                        {bgUploadItems.map((img) => (
                          <div key={img.id} className="relative w-14 h-14 flex-shrink-0 rounded-xl overflow-hidden border border-white/10">
                            <img src={img.preview} className="w-full h-full object-cover" alt="thumb" />
                            
                            {/* Status overlays */}
                            <div className={cn(
                              "absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white text-[8px] font-bold text-center p-0.5",
                              img.status === 'completed' && "bg-green-950/80",
                              img.status === 'error' && "bg-red-950/85"
                            )}>
                              {img.status === 'pending' && <span className="text-amber-300 font-black animate-pulse">Chờ tải</span>}
                              {img.status === 'uploading' && (
                                <div className="flex flex-col items-center">
                                  <Loader2 size={10} className="animate-spin text-toyota-red" />
                                  <span className="text-[7px] font-mono mt-0.5">{Math.round(img.progress)}%</span>
                                </div>
                              )}
                              {img.status === 'completed' && <Check size={14} className="text-green-400" strokeWidth={3} />}
                              {img.status === 'error' && (
                                <button
                                  onClick={() => retryBgUpload(img.id)}
                                  className="bg-toyota-red/90 px-1 py-0.5 rounded text-[8px] font-black cursor-pointer active:scale-95 duration-100"
                                >
                                  Thử lại
                                </button>
                              )}
                            </div>

                            {/* Trash clear bubble */}
                            <button
                              type="button"
                              onClick={() => removeBgUploadItem(img.id)}
                              className="absolute top-0 right-0 bg-red-600 hover:bg-red-700 text-white w-4.5 h-4.5 rounded-bl flex items-center justify-center font-bold shadow-sm duration-100 cursor-pointer"
                            >
                              <X size={10} strokeWidth={3} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  )}

                  {/* Done Button Helper Warning / Progress Reason */}
                  {cameraMode === 'upload_now' && doneButtonReason && (
                    <div className="text-center text-amber-400 font-bold text-[11px] leading-relaxed animate-pulse mb-1.5 px-4 py-2 bg-amber-950/45 rounded-xl max-w-sm mx-auto border border-amber-900/35">
                      ⚠️ {doneButtonReason}
                    </div>
                  )}

                  {/* Shutter capture loop row */}
                  <div className="flex justify-between items-center px-6">
                    <button
                      type="button"
                      onClick={() => {
                        setCameraRotationOffset((prev) => (prev === 270 ? 0 : 270));
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center active:scale-95 transition-all duration-150 cursor-pointer w-20 py-2 rounded-xl text-center border font-medium",
                        cameraRotationOffset === 270
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                      )}
                    >
                      <RefreshCw size={16} className={cn("mb-1 transition-transform", cameraRotationOffset === 270 && "rotate-180 text-amber-300")} />
                      <span className="text-[9px] font-black uppercase tracking-wider block">
                        {cameraRotationOffset === 270 ? "Đang xoay" : "Xoay ngang"}
                      </span>
                    </button>

                    {/* Shutter capture trigger button */}
                    <button
                      disabled={cameraMode === 'upload_now' && !instantPlateConfirmedRef.current && bgUploadItems.length >= MAX_PENDING_INSTANT_FILES && instantPlateStatus === 'processing'}
                      onClick={takeSnapshot}
                      className={cn(
                        "w-16 h-16 rounded-full border-4 flex items-center justify-center p-1 transition-transform bg-transparent cursor-pointer",
                        (cameraMode === 'upload_now' && !instantPlateConfirmedRef.current && bgUploadItems.length >= MAX_PENDING_INSTANT_FILES && instantPlateStatus === 'processing')
                          ? "border-gray-750 cursor-not-allowed opacity-50"
                          : "border-white active:scale-90"
                      )}
                    >
                      <div className={cn(
                        "w-full h-full rounded-full transition-colors",
                        (cameraMode === 'upload_now' && !instantPlateConfirmedRef.current && bgUploadItems.length >= MAX_PENDING_INSTANT_FILES && instantPlateStatus === 'processing')
                          ? "bg-slate-700"
                          : "bg-red-600 hover:bg-red-700"
                      )} />
                    </button>

                    {/* Xong action */}
                    <button
                      type="button"
                      disabled={isDoneDisabled}
                      onClick={handleCameraDone}
                      className={cn(
                        "px-5 py-2.5 font-black text-xs uppercase tracking-wider rounded-xl duration-100 flex items-center gap-1 min-w-[70px] justify-center transition-all",
                        isDoneDisabled
                          ? "bg-slate-800 text-gray-500 border border-slate-700 cursor-not-allowed opacity-50"
                          : "bg-green-600 text-white hover:bg-green-700 active:scale-95 cursor-pointer shadow-lg"
                      )}
                    >
                      {isCompletingBg ? (
                        <>
                          <Loader2 size={14} className="animate-spin text-white" />
                          <span className="text-[10px]">Đang lưu...</span>
                        </>
                      ) : (
                        <>
                          <Check size={14} strokeWidth={3} />
                          <span>Xong</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </AnimatePresence>

      {/* General Blocking Fullscreen Completed upload status wait states */}
      {uploading && (
        <div className="fixed inset-0 bg-toyota-navy/60 backdrop-blur-md z-[110] flex items-center justify-center p-8">
          <div className="bg-white w-full max-w-sm rounded-[40px] p-10 text-center space-y-6 shadow-2xl">
            <div className="relative w-28 h-28 mx-auto">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="56" cy="56" r="48"
                  className="stroke-gray-100 fill-none"
                  strokeWidth="10"
                />
                <circle
                  cx="56" cy="56" r="48"
                  className="stroke-toyota-red fill-none transition-all duration-300"
                  strokeWidth="10"
                  strokeDasharray={2 * Math.PI * 48}
                  strokeDashoffset={2 * Math.PI * 48 * (1 - (cameraMode === 'upload_now' ? (bgUploadItems.filter(i => i.status === 'completed').length / Math.max(1, bgUploadItems.length)) * 100 : progress) / 100)}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-black text-2xl text-toyota-navy">
                {cameraMode === 'upload_now' ? Math.round((bgUploadItems.filter(i => i.status === 'completed').length / Math.max(1, bgUploadItems.length)) * 100) : Math.round(progress)}%
              </div>
            </div>
            <div>
              <h3 className="font-black text-lg text-toyota-navy uppercase tracking-tighter">
                {isCompletingBg ? "Đang hoàn tất ảnh còn lại…" : "Đang hoàn tất"}
              </h3>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest leading-normal mt-1">Đừng đóng ứng dụng bạn nhé!</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
