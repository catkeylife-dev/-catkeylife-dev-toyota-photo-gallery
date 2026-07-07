import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Loader2, Trash2, CameraOff, Check, RotateCcw, RefreshCw } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { db, storage } from '@/src/lib/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { getSearchFields } from '@/src/lib/searchUtils';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '@/src/context/AuthContext';
import ResolvedImage from './ResolvedImage';
import { resolveSessionDepartmentId } from '@/src/lib/departmentResolver';

interface EditSessionModalProps {
  session: {
    id: string;
    plateNumber: string;
    roNumber: string;
    createdAt: any;
    imageCount: number;
    thumbnailUrl: string;
    note?: string;
    imageUrls: string[];
    storagePaths?: string[];
    department?: string;
  };
  isOpen: boolean;
  onClose: () => void;
  onSaveComplete: () => void;
}

export default function EditSessionModal({ session, isOpen, onClose, onSaveComplete }: EditSessionModalProps) {
  const { user } = useAuth();
  const [currentUrls, setCurrentUrls] = useState<string[]>(session.imageUrls || []);
  const [newImages, setNewImages] = useState<{ file: File; id: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);

  // Metadata editor states
  const [plate, setPlate] = useState(session.plateNumber || '');
  const [ro, setRo] = useState(session.roNumber || '');
  const [note, setNote] = useState(session.note || '');
  const [dept, setDept] = useState(resolveSessionDepartmentId(session));

  // Sync state if session changes
  useEffect(() => {
    setCurrentUrls(session.imageUrls || []);
    setNewImages([]);
    setError('');
    setStatusMessage('');
    setPlate(session.plateNumber || '');
    setRo(session.roNumber || '');
    setNote(session.note || '');
    setDept(resolveSessionDepartmentId(session));
  }, [session]);

  // States for choice menu modal
  const [isOptionModalOpen, setIsOptionModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string>('');

  // General camera states
  const [cameraMode, setCameraMode] = useState<'continuous' | 'upload_now' | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraRotationOffset, setCameraRotationOffset] = useState<0 | 270>(0);

  // Continuous captured images (held locally until user clicks Done)
  const [localCapturedImages, setLocalCapturedImages] = useState<{ file: File; preview: string; id: string }[]>([]);

  // Native camera states
  const [nativeCapturedImages, setNativeCapturedImages] = useState<{ id: string; file: File; preview: string }[]>([]);
  const [isNativeCameraActive, setIsNativeCameraActive] = useState(false);
  const [showCancelNativeConfirm, setShowCancelNativeConfirm] = useState(false);

  // Background upload states (for 'upload_now' mode)
  const [bgUploadItems, setBgUploadItems] = useState<{
    id: string;
    file: File;
    preview: string;
    status: 'pending' | 'uploading' | 'completed' | 'error';
    progress: number;
    url?: string;
    storagePath?: string;
  }[]>([]);
  const [isCompletingBg, setIsCompletingBg] = useState(false);

  // Stop camera when modal closes or unmounts
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCameraMode(null);
      setLocalCapturedImages([]);
      setBgUploadItems([]);
      setCameraError(null);
      setModalError('');
      setIsOptionModalOpen(false);
    }
  }, [isOpen]);

  // Stop camera stream when stream changes to null or component unmounts
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.error("Error stopping streaming track", e);
          }
        });
      }
    };
  }, [stream]);

  // Queue runner for BG upload mode (uploads 1-by-1 sequentially to prevent lag/overflows)
  useEffect(() => {
    if (cameraMode !== 'upload_now') return;

    // Is there any active uploads currently processing?
    const isUploadingAny = bgUploadItems.some(item => item.status === 'uploading');
    if (isUploadingAny) return;

    // Find first waiting queue item
    const nextPendingIndex = bgUploadItems.findIndex(item => item.status === 'pending');
    if (nextPendingIndex !== -1) {
      processBgUpload(nextPendingIndex);
    }
  }, [bgUploadItems, cameraMode]);

  // Automated trigger to complete the BG upload sessions when user clicked 'Xong' but was waiting for final items
  useEffect(() => {
    if (cameraMode === 'upload_now' && isCompletingBg) {
      const activeOrPending = bgUploadItems.some(item => item.status === 'pending' || item.status === 'uploading');
      if (!activeOrPending) {
        handleBgUploadComplete();
      }
    }
  }, [bgUploadItems, isCompletingBg, cameraMode]);

  const startCamera = async (mode: 'continuous' | 'upload_now') => {
    try {
      setLocalCapturedImages([]);
      setCameraError(null);
      setCameraMode(mode);
      setCameraRotationOffset(0);

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

      if (rotationOffset === 270) {
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

        if (rotationOffset === 270) {
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
              setBgUploadItems(prev => [...prev, {
                id,
                file,
                preview,
                status: 'pending',
                progress: 0
              }]);
            }
          }
        }, 'image/jpeg', 0.95);
      }
    } catch (err) {
      console.error("Snapshot canvas context capture failure", err);
    }
  };

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

      if (totalCaptured === 0) {
        // Chưa chụp ảnh nào: Lập tức đóng camera không hỏi popup
        stopCamera();
        setCameraMode(null);
        setBgUploadItems([]);
        return;
      }

      if (completedItems.length === 0) {
        const confirmCancel = window.confirm("Bạn muốn hủy các ảnh vừa chụp?");
        if (!confirmCancel) return;

        stopCamera();
        setCameraMode(null);
        setBgUploadItems([]);
        return;
      }

      // Đã có ít nhất 1 ảnh upload thành công
      const confirmDelete = window.confirm("Một số ảnh đã được tải lên. Bạn có muốn xóa các ảnh này không?");
      if (!confirmDelete) return;

      stopCamera();
      setCameraMode(null);
      setUploading(true);
      setError("Đang hủy bỏ và dọn dẹp các tệp tải lên...");

      try {
        // Delete all successfully uploaded storage objects during this camera loop
        for (const item of completedItems) {
          if (item.storagePath) {
            const imageRef = ref(storage, item.storagePath);
            await deleteObject(imageRef).catch(err => {
              console.warn("Could not delete file item on cancel rollback:", err);
            });
          }
        }
      } catch (err) {
        console.error("Error rollbacking temporary uploads:", err);
      } finally {
        setBgUploadItems([]);
        setUploading(false);
        setError('');
      }
    }
  };

  const handleCameraDone = () => {
    if (cameraMode === 'continuous') {
      // Push local captured images to newImages so user can see them in EditSessionModal's thumbnails and click upload
      setNewImages(prev => {
        const combined = [...prev, ...localCapturedImages];
        if (combined.length > 15) {
          alert("Nên upload tối đa 15 ảnh/lần để app hoạt động ổn định.");
        }
        return combined.slice(0, 15);
      });
      setLocalCapturedImages([]);
      stopCamera();
      setCameraMode(null);
    } else if (cameraMode === 'upload_now') {
      handleBgUploadComplete();
    }
  };

  const processBgUpload = async (index: number) => {
    const item = bgUploadItems[index];
    if (!item) return;

    setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'uploading', progress: 0 } : img));

    try {
      // Compression options: maxWidth = 1000, JPEG quality = 0.65
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1000,
        useWebWorker: true,
        initialQuality: 0.65
      };
      const compressedFile = await imageCompression(item.file, options);

      // Path layout matching existing uploads exactly
      const storagePath = `car-images/${session.plateNumber}/${Date.now()}-${item.id}.jpg`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, compressedFile);

      uploadTask.on('state_changed',
        (snapshot) => {
          const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, progress: pct } : img));
        },
        (upErr) => {
          console.error("Storage upload item failure:", upErr);
          setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'error' } : img));
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
          } catch (err) {
            console.error("Error getting download URL for background Item:", err);
            setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'error' } : img));
          }
        }
      );
    } catch (compErr: any) {
      console.error("Compression component error on background item:", compErr);
      setBgUploadItems(prev => prev.map((img, i) => i === index ? { ...img, status: 'error' } : img));
    }
  };

  const handleBgUploadComplete = async () => {
    const activeOrPending = bgUploadItems.some(item => item.status === 'pending' || item.status === 'uploading');
    if (activeOrPending) {
      setIsCompletingBg(true);
      return;
    }

    const completedItems = bgUploadItems.filter(item => item.status === 'completed');
    if (completedItems.length === 0) {
      alert("Vui lòng chụp ít nhất 1 ảnh hoặc bấm Hủy để quay lại.");
      stopCamera();
      setCameraMode(null);
      setIsCompletingBg(false);
      return;
    }

    try {
      setUploading(true);
      setError('');

      const urls = completedItems.map(i => i.url!);
      const finalUrls = [...currentUrls, ...urls];
      const finalThumbnail = session.thumbnailUrl || urls[0] || "";

      // Document update in cars collection
      const sessionDocRef = doc(db, 'cars', session.id);
      const searchFields = getSearchFields(session.plateNumber, session.roNumber);
      await updateDoc(sessionDocRef, {
        imageUrls: finalUrls,
        imageCount: finalUrls.length,
        thumbnailUrl: finalThumbnail,
        updatedByUid: user?.uid || '',
        updatedByEmail: user?.email || '',
        updatedByName: user?.displayName || '',
        updatedAt: Date.now(),
        uploadedByUid: user?.uid || '',
        uploadedByEmail: user?.email || '',
        uploadedByName: user?.displayName || '',
        ...searchFields
      });

      setBgUploadItems([]);
      setCurrentUrls(finalUrls);
      setIsCompletingBg(false);
      stopCamera();
      setCameraMode(null);
      alert(`Đã upload thành công ${completedItems.length} ảnh mới trực tiếp vào phiên!`);
      onSaveComplete();
    } catch (err: any) {
      console.error("Failing update background session details:", err);
      setError("Lỗi khi cập nhật phiên: " + (err.message || err));
    } finally {
      setUploading(false);
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
      if (!session.plateNumber || !session.plateNumber.trim()) {
        setModalError("Không tìm thấy biển số xe hợp lệ cho phiên này.");
        return;
      }

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

      try {
        await startCamera('upload_now');
      } catch (err: any) {
        console.error("Failed to start instant upload camera in modal:", err);
        setError("Lỗi mở camera Chụp & tải ngay: " + (err.message || err));
      }
    }
  };

  if (!isOpen) return null;

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      const mappedImages = selectedFiles.map(file => ({
        file,
        preview: URL.createObjectURL(file as Blob),
        id: Math.random().toString(36).substring(2, 9),
      }));
      setNewImages(prev => [...prev, ...mappedImages].slice(0, 15)); // limit preview to 15 max
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
      setNativeCapturedImages(prev => [...prev, ...mapped]);
      setIsNativeCameraActive(true);
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
    setNativeCapturedImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) {
        URL.revokeObjectURL(img.preview);
      }
      return prev.filter(item => item.id !== id);
    });
  };

  const handleNativeCameraCancelClick = () => {
    if (nativeCapturedImages.length > 0) {
      setShowCancelNativeConfirm(true);
    } else {
      setIsNativeCameraActive(false);
    }
  };

  const confirmCancelAndClose = () => {
    nativeCapturedImages.forEach(img => URL.revokeObjectURL(img.preview));
    setNativeCapturedImages([]);
    setShowCancelNativeConfirm(false);
    setIsNativeCameraActive(false);
  };

  const handleNativeCameraConfirmClick = () => {
    setNewImages(prev => {
      const combined = [...prev, ...nativeCapturedImages];
      if (combined.length > 15) {
        alert('Nên upload tối đa 15 ảnh/lần để app hoạt động ổn định.');
      }
      return combined.slice(0, 15);
    });
    setNativeCapturedImages([]);
    setIsNativeCameraActive(false);
  };

  const removeNewImage = (id: string) => {
    setNewImages(prev => prev.filter(img => img.id !== id));
  };

  const handleDeleteExistingImage = async (url: string) => {
    const userDept = user?.departmentId || user?.department;
    const canDeleteImage = user?.role === 'admin' || (
      user?.canDeleteSession === true && 
      resolveSessionDepartmentId(session) === userDept
    );

    if (!canDeleteImage) {
      alert("Bạn không có quyền xóa ảnh trong phiên xe này!");
      return;
    }

    const isConfirmed = window.confirm(
      "Bạn chắc chắn muốn xóa ảnh này? Thao tác này sẽ xóa ảnh khỏi hệ thống."
    );
    if (!isConfirmed) return;

    try {
      setUploading(true);
      setStatusMessage('Đang xóa ảnh...');
      setError('');

      // 1. Delete from Storage
      const imageRef = ref(storage, url);
      await deleteObject(imageRef).catch(err => {
        console.warn("Could not delete from storage (might already be deleted):", err);
      });

      // 2. Remove from URL filter
      const updatedUrls = currentUrls.filter(u => u !== url);

      // Determine new thumbnail
      let newThumbnail = session.thumbnailUrl;
      if (session.thumbnailUrl === url) {
        newThumbnail = updatedUrls.length > 0 ? updatedUrls[0] : "";
      }

      // 3. Update firestore (cars document)
      const sessionDocRef = doc(db, 'cars', session.id);
      const searchFields = getSearchFields(session.plateNumber, session.roNumber);
      await updateDoc(sessionDocRef, {
        imageUrls: updatedUrls,
        imageCount: updatedUrls.length,
        thumbnailUrl: newThumbnail,
        updatedByUid: user?.uid || '',
        updatedByEmail: user?.email || '',
        updatedByName: user?.displayName || '',
        updatedAt: Date.now(),
        ...searchFields
      });

      setCurrentUrls(updatedUrls);
      setStatusMessage('Đã cập nhật phiên thành công!');
      
      // Trigger parent update
      onSaveComplete();
    } catch (err: any) {
      console.error("Error deleting image:", err);
      setError('Lỗi khi xóa ảnh: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setUploading(false);
      setStatusMessage('');
    }
  };

  const handleUploadNewImages = async () => {
    if (newImages.length === 0) {
      setError('Vui lòng chọn ít nhất 1 ảnh để upload');
      return;
    }

    setUploading(true);
    setError('');
    setProgress(0);

    try {
      const uploadedUrls: string[] = [];
      const totalCount = newImages.length;

      for (let i = 0; i < totalCount; i++) {
        const item = newImages[i];
        setStatusMessage(`Đang upload ảnh ${i + 1}/${totalCount}`);

        // Image compression as requested: maxWidth = 1000, JPEG quality = 0.65
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 1000,
          useWebWorker: true,
          initialQuality: 0.65,
        };
        const compressedFile = await imageCompression(item.file, options);

        // Path structure: car-images/{plate}/{Date.now()}-{id}.jpg (consistently with existing upload path structure)
        const storagePath = `car-images/${session.plateNumber}/${Date.now()}-${item.id}.jpg`;
        const storageRef = ref(storage, storagePath);
        const uploadTask = uploadBytesResumable(storageRef, compressedFile);

        await new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const currentProgress =
                (i / totalCount) * 100 +
                (snapshot.bytesTransferred / snapshot.totalBytes) * (100 / totalCount);
              setProgress(currentProgress);
            },
            (error) => {
              reject(error);
            },
            async () => {
              try {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                uploadedUrls.push(url);
                resolve(null);
              } catch (err) {
                reject(err);
              }
            }
          );
        });
      }

      setStatusMessage('Đang cập nhật phiên...');

      const finalUrls = [...currentUrls, ...uploadedUrls];
      
      // Keep original thumbnail if it exists, otherwise use first newly uploaded image
      const finalThumbnail = session.thumbnailUrl || uploadedUrls[0] || "";

      // Document update in cars collection
      const sessionDocRef = doc(db, 'cars', session.id);
      const searchFields = getSearchFields(session.plateNumber, session.roNumber);
      await updateDoc(sessionDocRef, {
        imageUrls: finalUrls,
        imageCount: finalUrls.length,
        thumbnailUrl: finalThumbnail,
        updatedByUid: user?.uid || '',
        updatedByEmail: user?.email || '',
        updatedByName: user?.displayName || '',
        updatedAt: Date.now(),
        uploadedByUid: user?.uid || '',
        uploadedByEmail: user?.email || '',
        uploadedByName: user?.displayName || '',
        ...searchFields
      });

      // Clear new upload selection
      setNewImages([]);
      setCurrentUrls(finalUrls);
      setStatusMessage('Đã upload x ảnh thành công!');
      alert(`Đã upload thành công ${totalCount} ảnh mới vào phiên!`);
      onSaveComplete();
    } catch (err: any) {
      console.error("Upload error:", err);
      setError('Lỗi khi upload: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setUploading(false);
      setProgress(0);
      setStatusMessage('');
      setIsCompletingBg(false);
    }
  };

  const handleSaveMetadata = async () => {
    const userDept = user?.departmentId || user?.department;
    if (user?.role !== 'admin' && resolveSessionDepartmentId(session) !== userDept) {
      setError("Bạn không có quyền cập nhật phiên xe của bộ phận khác!");
      return;
    }
    if (!plate.trim()) {
      setError("Biển số xe không được để trống!");
      return;
    }
    setUploading(true);
    setError('');
    setStatusMessage('Đang lưu thay đổi...');
    try {
      const sessionDocRef = doc(db, 'cars', session.id);
      const searchFields = getSearchFields(plate.trim().toUpperCase(), ro.trim());
      
      const updatePayload: any = {
        plateNumber: plate.trim().toUpperCase(),
        plateNumberNormalized: plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
        roNumber: ro.trim(),
        note: note.trim(),
        updatedByUid: user?.uid || '',
        updatedByEmail: user?.email || '',
        updatedByName: user?.displayName || '',
        updatedAt: Date.now(),
        ...searchFields
      };

      // Only Admin can update the department
      if (user?.role === 'admin') {
        updatePayload.department = dept;
      }

      await updateDoc(sessionDocRef, updatePayload);

      setStatusMessage('');
      alert("Đã cập nhật thông tin phiên thành công!");
      onSaveComplete();
      onClose();
    } catch (err: any) {
      console.error("Error updating metadata:", err);
      setError("Lỗi cập nhật phiên: " + (err.message || err));
    } finally {
      setUploading(false);
      setStatusMessage('');
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-toyota-navy/80 backdrop-blur-md z-[80] flex items-center justify-center p-4 overflow-y-auto w-full h-full">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl flex flex-col my-8 border border-gray-100"
        >
          {/* Modal Header */}
          <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-toyota-navy tracking-tight uppercase">Sửa phiên chụp</h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs bg-toyota-red text-white px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                  {session.plateNumber}
                </span>
                {session.roNumber && (
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-2.5 py-0.5 rounded-full font-bold">
                    RO: {session.roNumber}
                  </span>
                )}
                <span className="text-[10px] text-gray-400 font-medium">
                  #{session.id.slice(-6).toUpperCase()}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 flex flex-wrap gap-2 items-center">
                <span>Số ảnh hiện tại: <span className="text-toyota-red font-black">{currentUrls.length}</span></span>
                <span className="text-gray-300">•</span>
                <span className="text-gray-500 italic">
                  {(() => {
                    const potentialDates = [
                      (session as any).capturedAt,
                      session.createdAt,
                      (session as any).uploadedAt,
                      (session as any).createdAtText,
                    ];
                    for (const dt of potentialDates) {
                      if (!dt) continue;
                      try {
                        let dateObj: Date;
                        if (typeof dt === 'number') {
                          dateObj = new Date(dt);
                        } else if (dt.seconds !== undefined && dt.nanoseconds !== undefined) {
                          dateObj = new Date(dt.seconds * 1000);
                        } else if (typeof dt.toDate === 'function') {
                          dateObj = dt.toDate();
                        } else {
                          dateObj = new Date(dt);
                        }
                        if (!isNaN(dateObj.getTime())) {
                          const pad = (n: number) => n.toString().padStart(2, '0');
                          return `Ngày chụp: ${pad(dateObj.getDate())}/${pad(dateObj.getMonth() + 1)}/${dateObj.getFullYear()} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                        }
                      } catch (e) {}
                    }
                    return 'Không rõ thời gian chụp';
                  })()}
                </span>
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={uploading}
              className="p-2 bg-gray-100 text-gray-400 hover:text-gray-600 rounded-full transition-colors active:scale-90 disabled:opacity-50"
              aria-label="Đóng"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
          </div>

          {/* Modal Scroll Content */}
          <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6 scroller">
            {/* Section 1: Chọn hoặc chụp thêm ảnh (top zone) */}
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <label className="text-[11px] font-black uppercase text-gray-400 tracking-wider">
                  Chọn hoặc chụp thêm ảnh
                </label>
                <span className="text-[9px] text-gray-400 font-bold italic">Tự động resize (0.65 quality)</span>
              </div>

              <div className="grid grid-cols-4 gap-2.5">
                <button
                  disabled={uploading}
                  onClick={() => { setModalError(''); setIsOptionModalOpen(true); }}
                  className="aspect-square bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center text-gray-400 hover:bg-gray-100 hover:border-gray-400 transition-all active:scale-95 disabled:opacity-50"
                >
                  <Camera size={20} strokeWidth={2.5} />
                  <span className="text-[8px] font-black mt-1 uppercase">Thêm ảnh</span>
                </button>

                <AnimatePresence>
                  {newImages.map((img) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      key={img.id}
                      className="relative aspect-square"
                    >
                      <img
                        src={img.preview}
                        alt="new preview"
                        className="w-full h-full object-cover rounded-2xl shadow-sm border border-gray-100"
                      />
                      <button
                        type="button"
                        onClick={() => removeNewImage(img.id)}
                        className="absolute -top-1.5 -right-1.5 bg-toyota-red text-white w-5 h-5 rounded-full flex items-center justify-center shadow-lg active:scale-110 transition-all"
                      >
                        <X size={10} strokeWidth={3} />
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
                disabled={uploading}
              />

              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={nativeCameraInputRef}
                className="hidden"
                onChange={handleNativeCameraChange}
                disabled={uploading}
              />

              {newImages.length > 0 && (
                <button
                  onClick={handleUploadNewImages}
                  disabled={uploading}
                  className={cn(
                    "w-full py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest text-white shadow-md flex items-center justify-center gap-2 transition-all active:scale-95",
                    uploading ? "bg-red-400" : "bg-toyota-red hover:opacity-90"
                  )}
                >
                  {uploading ? (
                    <Loader2 className="animate-spin" size={12} />
                  ) : (
                    <Upload size={12} />
                  )}
                  Upload ảnh mới ({newImages.length})
                </button>
              )}
            </div>

            {/* Upload Progress & Error states */}
            {uploading && statusMessage && (
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase">
                  <span className="text-toyota-navy">{statusMessage}</span>
                  {progress > 0 && <span className="text-toyota-red">{Math.round(progress)}%</span>}
                </div>
                {progress > 0 && (
                  <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-toyota-red transition-all duration-150"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-toyota-red p-4 rounded-2xl text-[10px] font-bold border border-red-100 flex items-center gap-2 italic">
                <span>⚠️</span>
                <div className="flex-1">{error}</div>
              </div>
            )}

            {/* Section 2: Ảnh đã có trong phiên */}
            <div className="space-y-3 pt-2">
              <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-wider">
                Ảnh đã có trong phiên ({currentUrls.length})
              </h3>

              {currentUrls.length === 0 ? (
                <p className="text-xs text-gray-400 italic font-medium py-4 text-center">Phiên này chưa có ảnh nào</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {currentUrls.map((url, index) => (
                    <div key={index} className="relative aspect-square group">
                      <ResolvedImage
                        url={url}
                        storagePath={session.storagePaths?.[index]}
                        alt={`photo-${index}`}
                        className="w-full h-full object-cover rounded-2xl border border-gray-100 shadow-sm"
                        loading="lazy"
                      />
                      {(user?.role === 'admin' || (user?.canDeleteSession === true && resolveSessionDepartmentId(session) === (user?.departmentId || user?.department))) && (
                        <button
                          disabled={uploading}
                          onClick={() => handleDeleteExistingImage(url)}
                          className="absolute -top-1.5 -right-1.5 bg-gray-950/80 text-white w-6 h-6 rounded-full flex items-center justify-center shadow-lg hover:bg-toyota-red transition-all disabled:opacity-50"
                          title="Xóa ảnh"
                        >
                          <Trash2 size={12} strokeWidth={2.5} />
                        </button>
                      )}
                      <div className="absolute bottom-1 left-1 bg-black/50 text-[8px] text-white font-black px-1.5 py-0.5 rounded-full">
                        #{index + 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 3: Sửa thông tin phiên (Biển số, RO, Ghi chú, Bộ phận) */}
            <div className="space-y-4 pt-4 border-t border-gray-100">
              <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-wider">
                Sửa thông tin phiên xe
              </h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Biển số xe *</label>
                  <input
                    type="text"
                    disabled={uploading}
                    value={plate}
                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                    className="w-full p-3 bg-gray-100 rounded-xl font-mono text-xs font-bold border border-transparent focus:border-red-500 outline-none text-gray-950 focus:bg-white transition-colors"
                    placeholder="E.g. 30F-123.45"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Lệnh RO</label>
                  <input
                    type="text"
                    disabled={uploading}
                    value={ro}
                    onChange={(e) => setRo(e.target.value)}
                    className="w-full p-3 bg-gray-100 rounded-xl font-mono text-xs font-bold border border-transparent focus:border-toyota-navy outline-none text-gray-950 focus:bg-white transition-colors"
                    placeholder="Số lệnh RO"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Ghi chú phiên chụp</label>
                <textarea
                  disabled={uploading}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full p-3 bg-gray-100 rounded-xl text-xs font-medium border border-transparent focus:border-gray-200 outline-none h-18 resize-none text-gray-950 focus:bg-white transition-colors"
                  placeholder="Nhập ghi chú ý kiến..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Bộ phận quản lý *</label>
                {user?.role === 'admin' ? (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => setDept('service')}
                      className={cn(
                        "py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all active:scale-95",
                        dept === 'service'
                          ? "bg-toyota-navy text-white border-toyota-navy shadow-sm"
                          : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      Dịch vụ
                    </button>
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => setDept('baohiem')}
                      className={cn(
                        "py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all active:scale-95",
                        dept === 'baohiem' || dept === 'insurance'
                          ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                          : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      Bảo hiểm
                    </button>
                  </div>
                ) : (
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider select-none">
                    {(dept === 'baohiem' || dept === 'insurance') ? 'Bảo hiểm (Khóa không thể tự sửa)' : 'Dịch vụ (Khóa không thể tự sửa)'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="p-6 bg-gray-50/50 border-t border-gray-100 flex gap-3">
            <button
              onClick={onClose}
              disabled={uploading}
              className="flex-1 py-3.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
            >
              Quay lại / Hủy
            </button>
            <button
              onClick={handleSaveMetadata}
              disabled={uploading}
              className="flex-1 py-3.5 bg-toyota-red hover:opacity-90 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl active:scale-95 transition-transform disabled:opacity-50 shadow-md flex items-center justify-center gap-1.5"
            >
              {uploading && <Loader2 className="animate-spin" size={12} />}
              Lưu thay đổi
            </button>
          </div>
        </motion.div>
      </div>

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
                    type="button"
                    onClick={() => triggerOptSelection('continuous')}
                    className="w-full p-4 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer"
                  >
                    <div className="bg-red-50 text-toyota-red p-3 rounded-xl group-hover:scale-105 duration-200">
                      <Camera size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-toyota-navy uppercase animate-scale-up">Chụp liên tục</h4>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Chụp nhiều ảnh trước, tải sau</p>
                    </div>
                  </button>
                )}

                {/* Chụp & tải ngay Capture Option */}
                <button
                  type="button"
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
                    <h4 className="text-xs font-black text-toyota-navy uppercase animate-scale-up">Chụp & tải ngay</h4>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">Phù hợp khi mạng ổn định</p>
                  </div>
                </button>

                {/* Chụp bằng camera thường Option */}
                <button
                  type="button"
                  onClick={() => triggerOptSelection('capture_native')}
                  className="w-full p-4 bg-blue-50/30 hover:bg-blue-50/60 border border-blue-100/50 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer shadow-sm"
                >
                  <div className="bg-toyota-navy text-white p-3 rounded-xl group-hover:scale-105 duration-200 shadow-sm">
                    <Camera size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-toyota-navy uppercase animate-scale-up">Chụp bằng camera thường</h4>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">Khung hình rộng hơn, phù hợp chỗ chụp hẹp</p>
                  </div>
                </button>

                {/* Library Album Select Option */}
                <button
                  type="button"
                  onClick={() => triggerOptSelection('pick_files')}
                  className="w-full p-4 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-2xl text-left flex items-center gap-4 transition-all active:scale-98 group cursor-pointer"
                >
                  <div className="bg-amber-50 text-amber-600 p-3 rounded-xl group-hover:scale-105 duration-200">
                    <RotateCcw size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-toyota-navy uppercase animate-scale-up">Chọn ảnh</h4>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">Chọn ảnh có sẵn</p>
                  </div>
                </button>
              </div>

              <button
                type="button"
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
                  type="button"
                  onClick={handleNativeCameraCancelClick}
                  className="p-1 z-[1] hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={20} strokeWidth={2.5} />
                </button>
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
              <span className="text-[10px] bg-white/10 text-white/95 px-3 py-0.5 rounded-full font-black uppercase tracking-widest border border-white/5">
                BS: {session.plateNumber.toUpperCase()}
              </span>
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

                  {/* Box frame target boundary overlay */}
                  <div className="absolute inset-8 border-2 border-dashed border-white/20 rounded-3xl pointer-events-none flex items-center justify-center">
                    <span className="text-[9px] text-white/25 font-black uppercase tracking-widest bg-black/50 px-3.5 py-1 rounded-full border border-white/5">
                      Đặt xe vào khung hình
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
                                  type="button"
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

                  {/* Shutter capture trigger button */}
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
                      type="button"
                      onClick={takeSnapshot}
                      className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center p-1 active:scale-90 transition-transform bg-transparent cursor-pointer"
                    >
                      <div className="w-full h-full rounded-full bg-red-600 hover:bg-red-700 transition-colors" />
                    </button>

                    {/* Xong action */}
                    <button
                      type="button"
                      onClick={handleCameraDone}
                      className="px-5 py-2.5 bg-green-600 text-white hover:bg-green-700 font-black text-xs uppercase tracking-wider rounded-xl active:scale-95 duration-100 flex items-center gap-1 cursor-pointer min-w-[70px] justify-center"
                    >
                      <Check size={14} strokeWidth={3} />
                      Xong
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
