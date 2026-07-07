import { useState, useEffect, useRef } from 'react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Search, Loader2, Calendar as CalendarIcon, FilterX, Trash2, ChevronLeft, ChevronRight, Check, Circle } from 'lucide-react';
import { db, storage, app } from '@/src/lib/firebase';
import { collection, query, where, getDocs, orderBy, deleteDoc, doc, limit, getDoc, startAfter, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, deleteObject, getBlob } from 'firebase/storage';
import { getSearchFields, normalizeText, generateSearchKeywords } from '@/src/lib/searchUtils';
import SessionCard from './SessionCard';
import EditSessionModal from './EditSessionModal';
import ResolvedImage from './ResolvedImage';
import { resolveImageUrl } from '@/src/lib/imageResolver';
import { resolveSessionDepartmentId, normalizeDepartmentValue } from '@/src/lib/departmentResolver';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/src/context/AuthContext';
import { createShareImageWithOverlay } from '@/src/lib/shareImageOverlay';

export default function SessionList({ mode = 'today' }: { mode?: 'today' | 'search' }) {
  const { user } = useAuth();
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('all');
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const [editingSession, setEditingSession] = useState<any>(null);

  // Share overlay configurations loaded from Firebase
  const [shareOverlayToggle, setShareOverlayToggle] = useState<boolean>(false);
  const [overlayAddressLines, setOverlayAddressLines] = useState<string[]>([
    "Toyota Hà Đông",
    "973 Quang Trung",
    "Phú Lương, Hà Đông",
    "Hà Nội, Việt Nam"
  ]);

  useEffect(() => {
    const loadOverlayConfig = async () => {
      try {
        const snap = await getDoc(doc(db, 'systemSettings', 'shareOverlay'));
        if (snap.exists()) {
          const data = snap.data();
          if (data.shareOverlayAddressLines) {
            setOverlayAddressLines(data.shareOverlayAddressLines);
          }
          if (data.shareOverlayEnabledByDefault !== undefined) {
            setShareOverlayToggle(data.shareOverlayEnabledByDefault);
          }
        }
      } catch (err) {
        console.error("Error loading share overlay config in SessionList:", err);
      }
    };
    loadOverlayConfig();
  }, [selectedSession]);

  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (filterRef.current) {
      const activeEl = filterRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [selectedDeptFilter]);

  // Local state for image selection & downloader inside viewer modal
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number, total: number } | null>(null);

  // Zalo sharing / file preparation states
  const [isPreparingShare, setIsPreparingShare] = useState<boolean>(false);
  const [prepareProgress, setPrepareProgress] = useState<{ current: number, total: number } | null>(null);
  const [preparedFiles, setPreparedFiles] = useState<File[]>([]);
  const [prepareSuccessCount, setPrepareSuccessCount] = useState<number>(0);
  const [prepareFailureCount, setPrepareFailureCount] = useState<number>(0);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const handleToggleIndex = (idx: number) => {
    setPreparedFiles([]);
    setPrepareError(null);
    setSelectedIndices(prev => {
      if (prev.includes(idx)) {
        return prev.filter(i => i !== idx);
      } else {
        if (prev.length < 10) {
          return [...prev, idx];
        } else {
          alert("Bạn chỉ có thể chia sẻ tối đa 10 ảnh mỗi lần.");
          return prev;
        }
      }
    });
  };

  const handleSelectAll = (urlsCount: number) => {
    setPreparedFiles([]);
    setPrepareError(null);
    if (urlsCount <= 10) {
      const indices = Array.from({ length: urlsCount }, (_, i) => i);
      setSelectedIndices(indices);
    } else {
      const indices = Array.from({ length: 10 }, (_, i) => i);
      setSelectedIndices(indices);
      alert("Hệ thống chỉ cho phép chia sẻ tối đa 10 ảnh mỗi lần. Đã chọn 10 ảnh đầu tiên.");
    }
  };

  const handleDeselectAll = () => {
    setPreparedFiles([]);
    setPrepareError(null);
    setSelectedIndices([]);
  };

  const handleClearSelection = () => {
    setSelectedIndices([]);
    setPreparedFiles([]);
    setPrepareSuccessCount(0);
    setPrepareFailureCount(0);
    setPrepareError(null);
  };

  const handleExitSelection = () => {
    setIsSelectionMode(false);
    setSelectedIndices([]);
    setPreparedFiles([]);
    setPrepareSuccessCount(0);
    setPrepareFailureCount(0);
    setPrepareError(null);
  };

  const cancelRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getBlobWithTimeout = async (storageRef: any, timeoutMs = 20000): Promise<Blob> => {
    return new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout tải ảnh từ Storage"));
      }, timeoutMs);
      
      getBlob(storageRef)
        .then((blob) => {
          clearTimeout(timer);
          resolve(blob);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  };

  const fetchWithTimeout = async (url: string, timeoutMs = 20000): Promise<Blob> => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.blob();
    } finally {
      clearTimeout(timerId);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const downloadBlobAsFile = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleStartDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    cancelRef.current = false;
    
    const total = selectedIndices.length;
    setDownloadProgress({ current: 1, total });

    const cleanPlate = (selectedSession.plateNumber || 'XE')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    const urls = selectedSession.imageUrls || [];
    let indexInFilename = 1;

    for (let i = 0; i < total; i++) {
      if (cancelRef.current) {
        break;
      }

      setDownloadProgress({ current: i + 1, total });
      const originalIdx = selectedIndices[i];
      const url = urls[originalIdx];
      const storagePath = selectedSession.storagePaths?.[originalIdx];

      try {
        const resolvedUrl = await resolveImageUrl(url, storagePath);
        console.log(`Downloading index ${originalIdx} via resolved URL: ${resolvedUrl}`);
        const blob = await fetchWithTimeout(resolvedUrl, 20000);

        if (cancelRef.current) break;

        const filename = `${cleanPlate}_${String(indexInFilename).padStart(2, '0')}.jpg`;
        indexInFilename++;

        downloadBlobAsFile(blob, filename);
      } catch (err: any) {
        console.error(`Error downloading image at index ${originalIdx}:`, err);
        alert(`Lỗi tải ảnh #${originalIdx + 1}: ${err.message || 'Không thể tải ảnh'}`);
      }
    }

    setIsDownloading(false);
    setDownloadProgress(null);
  };

  const handleCancelDownload = () => {
    cancelRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsDownloading(false);
    setDownloadProgress(null);
  };

  const prepareAbortControllerRef = useRef<AbortController | null>(null);

  const prepareSelectedPhotos = async (indices: number[], session: any) => {
    // Abort previous run
    if (prepareAbortControllerRef.current) {
      prepareAbortControllerRef.current.abort();
      prepareAbortControllerRef.current = null;
    }

    const controller = new AbortController();
    prepareAbortControllerRef.current = controller;

    setPreparedFiles([]);
    setPrepareSuccessCount(0);
    setPrepareFailureCount(0);
    setPrepareError(null);

    if (indices.length === 0 || !session) {
      setIsPreparingShare(false);
      setPrepareProgress(null);
      return;
    }

    setIsPreparingShare(true);
    const total = indices.length;
    setPrepareProgress({ current: 0, total });

    const cleanPlate = (session.plateNumber || 'XE')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    const urls = session.imageUrls || [];
    let indexInFilename = 1;
    const files: File[] = [];
    let succ = 0;
    let fail = 0;

    for (let i = 0; i < total; i++) {
      if (controller.signal.aborted) {
        return;
      }

      setPrepareProgress({ current: i + 1, total });
      const originalIdx = indices[i];
      const url = urls[originalIdx];
      const storagePath = session.storagePaths?.[originalIdx];

      try {
        const resolvedUrl = await resolveImageUrl(url, storagePath);
        console.log(`Preparing index ${originalIdx} via resolved URL background: ${resolvedUrl}`);
        
        let blob: Blob = await new Promise<Blob>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout tải ảnh")), 20000);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          };
          controller.signal.addEventListener('abort', onAbort);

          fetch(resolvedUrl, { signal: controller.signal })
            .then((res) => {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', onAbort);
              if (!res.ok) throw new Error(`HTTP error ${res.status}`);
              return res.blob();
            })
            .then(resolve)
            .catch((err) => {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', onAbort);
              reject(err);
            });
        });

        if (controller.signal.aborted) return;

        let finalFile: File;
        const filename = `${cleanPlate}_${String(indexInFilename).padStart(2, '0')}.jpg`;
        indexInFilename++;

        const originalFile = new File([blob], filename, { type: blob.type || 'image/jpeg' });

        if (shareOverlayToggle) {
          try {
            const capturedAt = session.capturedAt || session.createdAt || session.uploadedAt || session.createdAtText;
            finalFile = await createShareImageWithOverlay({
              file: originalFile,
              capturedAt,
              addressLines: overlayAddressLines,
              fileName: filename
            });
          } catch (overlayErr) {
            console.error("Failed to generate overlay on image:", overlayErr);
            finalFile = originalFile;
          }
        } else {
          finalFile = originalFile;
        }

        files.push(finalFile);
        succ++;
      } catch (err: any) {
        if (controller.signal.aborted || err.message === 'Aborted') {
          return;
        }
        console.error(`Error background preparing image at index ${originalIdx}:`, err);
        fail++;
      }
    }

    if (controller.signal.aborted) {
      return;
    }

    setPrepareSuccessCount(succ);
    setPrepareFailureCount(fail);

    if (succ > 0) {
      setPreparedFiles(files);
      setPrepareError(null);
      if (fail > 0) {
        console.warn(`Đã chuẩn bị xong ${succ} ảnh. Có ${fail} ảnh bị lỗi.`);
      }
    } else {
      setPreparedFiles([]);
      setPrepareError("Không thể chuẩn bị ảnh. Vui lòng kiểm tra kết nối hoặc quyền truy cập Storage.");
      console.error("Tất cả ảnh tải về đều thất bại.");
    }

    setIsPreparingShare(false);
    setPrepareProgress(null);
    if (prepareAbortControllerRef.current === controller) {
      prepareAbortControllerRef.current = null;
    }
  };

  useEffect(() => {
    if (isSelectionMode && selectedSession) {
      prepareSelectedPhotos(selectedIndices, selectedSession);
    } else {
      if (prepareAbortControllerRef.current) {
        prepareAbortControllerRef.current.abort();
        prepareAbortControllerRef.current = null;
      }
      setPreparedFiles([]);
      setPrepareSuccessCount(0);
      setPrepareFailureCount(0);
      setIsPreparingShare(false);
      setPrepareProgress(null);
    }
    return () => {
      if (prepareAbortControllerRef.current) {
        prepareAbortControllerRef.current.abort();
        prepareAbortControllerRef.current = null;
      }
    };
  }, [selectedIndices, isSelectionMode, selectedSession, shareOverlayToggle, overlayAddressLines]);

  const handleShare = async () => {
    if (preparedFiles.length === 0) return;

    const sharePayload: ShareData = {
      files: preparedFiles,
    };

    const canShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare(sharePayload);

    if (!canShareFiles) {
      alert("Thiết bị hoặc trình duyệt hiện tại không hỗ trợ chia sẻ trực tiếp ảnh sang Zalo. Ảnh sẽ được tải về máy để bạn gửi thủ công qua Zalo.");
      await handleStartDownload();
      return;
    }

    try {
      await navigator.share(sharePayload);
      handleExitSelection();
    } catch (error: any) {
      if (error && error.name === 'AbortError') {
        console.log("User cancelled sharing:", error);
      } else {
        alert("Không thể chia sẻ ảnh qua ứng dụng đã chọn. Bạn có thể thử lại hoặc tải ảnh về máy.");
        console.warn("Other error sharing files:", error);
      }
    }
  };

  const closeViewer = () => {
    setSelectedSession(null);
    setIsSelectionMode(false);
    setSelectedIndices([]);
    setIsDownloading(false);
    setIsPreparingShare(false);
    setDownloadProgress(null);
    setPrepareProgress(null);
    setPreparedFiles([]);
    cancelRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };
  const [hasSearched, setHasSearched] = useState(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Advanced search and pagination states
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);

  const [deptNames, setDeptNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = query(collection(db, 'departments'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const names: Record<string, string> = {};
      snap.forEach((doc) => {
        const rawId = doc.id;
        const normalizedId = normalizeDepartmentValue(rawId) || rawId;
        if (normalizedId !== 'admin') {
          names[normalizedId] = doc.data().name || doc.id;
        }
      });
      setDeptNames(names);
    });
    return () => unsubscribe();
  }, []);

  const fetchSearch = async (isNewSearch = false) => {
    const trimmedVal = searchTerm.trim();
    if (!trimmedVal) {
      setSearchWarning('Vui lòng nhập biển số hoặc Số lệnh để tìm kiếm');
      return;
    }
    if (trimmedVal.length < 3) {
      setSearchWarning('Từ khóa phải có tối thiểu 3 ký tự');
      return;
    }
    setSearchWarning(null);
    setHasSearched(true);
    setLoading(true);

    try {
      const normalizeSearchText = (str: string): string => {
        if (!str) return '';
        return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
      };

      const normalizedQuery = normalizeSearchText(trimmedVal);
      console.log(`[ADVANCED SEARCH] Term: "${trimmedVal}", Norm: "${normalizedQuery}"`, isNewSearch ? '(New)' : '(Load more)');

      const collectionRef = collection(db, 'cars');

      const role = user?.role || 'user';
      const queryDepartment = user?.role === 'admin' ? (selectedDeptFilter === 'all' ? null : selectedDeptFilter) : (user?.departmentId || user?.department || 'service');
      const status = undefined;
      const dateFrom = undefined;
      const dateTo = undefined;
      const orderByField = undefined;

      // Log temporary search query debugging info before calling getDocs()
      console.log("[SEARCH QUERY DEBUG]", {
        projectId: app.options.projectId,
        normalizedQuery,
        role,
        queryDepartment,
        filters: {
          searchKeywords: normalizedQuery,
          status,
          dateFrom,
          dateTo,
          orderByField
        }
      });

      let rawDocs: any[] = [];
      let keywordResultCount = 0;
      let plateNormalizedCount = 0;
      let plateNumberNormalizedCount = 0;

      // Construct the primary query based on role and selectedDepartmentId (queryDepartment)
      let primaryQ;
      if (role === 'admin') {
        if (queryDepartment === null) {
          primaryQ = query(
            collectionRef,
            where('searchKeywords', 'array-contains', normalizedQuery)
          );
        } else {
          primaryQ = query(
            collectionRef,
            where('departmentId', '==', queryDepartment),
            where('searchKeywords', 'array-contains', normalizedQuery)
          );
        }
      } else {
        primaryQ = query(
          collectionRef,
          where('departmentId', '==', queryDepartment),
          where('searchKeywords', 'array-contains', normalizedQuery)
        );
      }

      try {
        const primarySnap = await getDocs(primaryQ);
        rawDocs = primarySnap.docs;
        keywordResultCount = rawDocs.length;
      } catch (primaryErr) {
        console.warn("[SEARCH] Primary query failed:", primaryErr);
      }

      // If primary query yields no results, run exact-match fallback on plate fields
      if (rawDocs.length === 0) {
        console.log("[SEARCH] No results found with searchKeywords. Running exact plate fallback...");

        let fallbackQ1;
        let fallbackQ2;

        if (role === 'admin') {
          if (queryDepartment === null) {
            fallbackQ1 = query(
              collectionRef,
              where('plateNormalized', '==', normalizedQuery)
            );
            fallbackQ2 = query(
              collectionRef,
              where('plateNumberNormalized', '==', normalizedQuery)
            );
          } else {
            fallbackQ1 = query(
              collectionRef,
              where('departmentId', '==', queryDepartment),
              where('plateNormalized', '==', normalizedQuery)
            );
            fallbackQ2 = query(
              collectionRef,
              where('departmentId', '==', queryDepartment),
              where('plateNumberNormalized', '==', normalizedQuery)
            );
          }
        } else {
          fallbackQ1 = query(
            collectionRef,
            where('departmentId', '==', queryDepartment),
            where('plateNormalized', '==', normalizedQuery)
          );
          fallbackQ2 = query(
            collectionRef,
            where('departmentId', '==', queryDepartment),
            where('plateNumberNormalized', '==', normalizedQuery)
          );
        }

        let snap1Docs: any[] = [];
        let snap2Docs: any[] = [];

        try {
          const snap1 = await getDocs(fallbackQ1);
          snap1Docs = snap1.docs;
          plateNormalizedCount = snap1Docs.length;
        } catch (err1) {
          console.warn("[SEARCH FALLBACK] plateNormalized query failed:", err1);
        }

        try {
          const snap2 = await getDocs(fallbackQ2);
          snap2Docs = snap2.docs;
          plateNumberNormalizedCount = snap2Docs.length;
        } catch (err2) {
          console.warn("[SEARCH FALLBACK] plateNumberNormalized query failed:", err2);
        }

        const seenLogins = new Set<string>();
        const tempDocs: any[] = [];
        
        snap1Docs.forEach(docSnap => {
          if (!seenLogins.has(docSnap.id)) {
            seenLogins.add(docSnap.id);
            tempDocs.push(docSnap);
          }
        });

        snap2Docs.forEach(docSnap => {
          if (!seenLogins.has(docSnap.id)) {
            seenLogins.add(docSnap.id);
            tempDocs.push(docSnap);
          }
        });

        rawDocs = tempDocs;
      }

      // Log search results debug details
      console.log("[SEARCH RESULT DEBUG]", {
        keywordResultCount,
        plateNormalizedCount,
        plateNumberNormalizedCount
      });

      // Convert docs to session structure
      const docs = rawDocs.map(doc => {
        const data = doc.data() as any;
        const resolvedDept = resolveSessionDepartmentId(data);
        return {
          id: doc.id,
          ...data,
          departmentId: resolvedDept
        };
      });

      // Filter out 'uploading' sessions
      let filteredDocs = docs.filter(s => s.status !== 'uploading');

      // Post-filtering for security
      if (queryDepartment) {
        filteredDocs = filteredDocs.filter(s => s.departmentId === queryDepartment);
      }

      // Helpers to convert various timestamp formats to ms for sorting
      const getTimestampMs = (val: any): number => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const parsed = Date.parse(val);
          return isNaN(parsed) ? 0 : parsed;
        }
        if (typeof val.toMillis === 'function') {
          return val.toMillis();
        }
        if (val.seconds !== undefined) {
          return val.seconds * 1000 + (val.nanoseconds || 0) / 1000000;
        }
        return 0;
      };

      // Sort locally descending by createdAt
      filteredDocs.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));

      // Diagnostic logging
      console.log("[SEARCH DEBUG]", {
        normalizedQuery,
        role: user?.role,
        userDepartmentId: user?.departmentId || user?.department || 'service',
        selectedDepartmentId: selectedDeptFilter,
        resultCount: filteredDocs.length
      });

      setLastDoc(null);
      setHasMore(false); // Since we run simple unpaged query but fetch up to 150 docs, pagination is not active for search.

      if (isNewSearch) {
        setSessions(filteredDocs);
      } else {
        setSessions(prev => {
          const seenIds = new Set(prev.map(s => s.id));
          const union = [...prev];
          for (const item of filteredDocs) {
            if (!seenIds.has(item.id)) {
              union.push(item);
            }
          }
          return union;
        });
      }
    } catch (err: any) {
      console.error('[ADVANCED SEARCH] Global catch:', err);
      setSearchWarning("Lỗi tìm kiếm: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    setLoading(true);
    try {
      console.log(`[TODAY SEARCH] Fetch range: ${fromDate} to ${toDate}`);
      const dFrom = new Date(fromDate);
      const dTo = new Date(toDate);
      
      if (isNaN(dFrom.getTime()) || isNaN(dTo.getTime())) {
        console.warn('Invalid date values for today fetch');
        setLoading(false);
        return;
      }

      const start = startOfDay(dFrom).getTime();
      const end = endOfDay(dTo).getTime();

      const collectionRef = collection(db, 'cars');
      
      // Determine department filter
      let deptFilter: string | null = null;
      if (user?.role === 'admin') {
        if (selectedDeptFilter !== 'all') {
          deptFilter = selectedDeptFilter;
        }
      } else {
        deptFilter = user?.departmentId || user?.department || 'service';
      }

      console.log("[DEPARTMENT QUERY TODAY]", {
        role: user?.role,
        departmentId: user?.departmentId,
        department: user?.department,
        queryDepartment: deptFilter
      });

      // Helper to query user's own today sessions safely
      const fetchMyTodaySessions = async (): Promise<any[]> => {
        if (!user?.uid) return [];
        
        const mySessionsMap = new Map<string, any>();
        
        // Query by createdByUid
        try {
          const qCreated = query(
            collectionRef,
            where('createdByUid', '==', user.uid),
            where('createdAt', '>=', start),
            where('createdAt', '<=', end)
          );
          const snap = await getDocs(qCreated);
          snap.docs.forEach(doc => {
            mySessionsMap.set(doc.id, { id: doc.id, ...doc.data() });
          });
        } catch (err) {
          console.warn("[fetchMyTodaySessions] createdByUid date range query failed, trying fallback...", err);
          try {
            const qCreatedFallback = query(
              collectionRef,
              where('createdByUid', '==', user.uid),
              limit(100)
            );
            const snap = await getDocs(qCreatedFallback);
            snap.docs.forEach(doc => {
              const data = doc.data() as any;
              if (data.createdAt >= start && data.createdAt <= end) {
                mySessionsMap.set(doc.id, { id: doc.id, ...data });
              }
            });
          } catch (err2) {
            console.error("[fetchMyTodaySessions] createdByUid fallback query failed", err2);
          }
        }

        // Query by uploadedByUid
        try {
          const qUploaded = query(
            collectionRef,
            where('uploadedByUid', '==', user.uid),
            where('createdAt', '>=', start),
            where('createdAt', '<=', end)
          );
          const snap = await getDocs(qUploaded);
          snap.docs.forEach(doc => {
            mySessionsMap.set(doc.id, { id: doc.id, ...doc.data() });
          });
        } catch (err) {
          console.warn("[fetchMyTodaySessions] uploadedByUid date range query failed, trying fallback...", err);
          try {
            const qUploadedFallback = query(
              collectionRef,
              where('uploadedByUid', '==', user.uid),
              limit(100)
            );
            const snap = await getDocs(qUploadedFallback);
            snap.docs.forEach(doc => {
              const data = doc.data() as any;
              if (data.createdAt >= start && data.createdAt <= end) {
                mySessionsMap.set(doc.id, { id: doc.id, ...data });
              }
            });
          } catch (err2) {
            console.error("[fetchMyTodaySessions] uploadedByUid fallback query failed", err2);
          }
        }

        return Array.from(mySessionsMap.values());
      };

      // Query runner helper supporting combined departmentId & legacy department merging in parallel
      const getDocsByDepts = async (
        builder: (fieldName: string) => any,
        builderNoDept?: () => any
      ) => {
        if (!deptFilter) {
          if (builderNoDept) {
            const q = builderNoDept();
            const snap = await getDocs(q);
            return {
              docs: snap.docs,
              lastDoc: snap.docs[snap.docs.length - 1] || null,
              length: snap.docs.length
            };
          } else {
            throw new Error("No non-department query builder defined");
          }
        }

        const qId = builder('departmentId');
        const qLegacy = builder('department');
        const [snapId, snapLegacy] = await Promise.all([
          getDocs(qId),
          getDocs(qLegacy)
        ]);

        const seen = new Set<string>();
        const mergedDocs: any[] = [];
        snapId.docs.forEach((doc: any) => {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            mergedDocs.push(doc);
          }
        });
        snapLegacy.docs.forEach((doc: any) => {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            mergedDocs.push(doc);
          }
        });

        return {
          docs: mergedDocs,
          lastDoc: snapId.docs[snapId.docs.length - 1] || snapLegacy.docs[snapLegacy.docs.length - 1] || null,
          length: snapId.docs.length
        };
      };

      let snapWrapper;
      let myTodaySessions: any[] = [];

      try {
        const [departmentSnap, mySessions] = await Promise.all([
          (async () => {
            try {
              return await getDocsByDepts(
                (fieldName) => query(
                  collectionRef,
                  where(fieldName, '==', deptFilter),
                  where('createdAt', '>=', start),
                  where('createdAt', '<=', end),
                  orderBy('createdAt', 'desc')
                ),
                () => query(
                  collectionRef,
                  where('createdAt', '>=', start),
                  where('createdAt', '<=', end),
                  orderBy('createdAt', 'desc')
                )
              );
            } catch (queryError: any) {
              console.warn("[TODAY SEARCH] Composite query failed, trying fallback query...", queryError);
              console.error("[FIRESTORE INDEX REQUIRED FOR TODAY]", 
                "Truy vấn danh sách Hôm nay yêu cầu thiết lập chỉ mục (index) trong Firebase Console. URL tạo chỉ mục nằm trong chi tiết lỗi phía dưới. Không bao giờ bỏ phân quyền bộ phận.",
                queryError.message || queryError
              );
              // Fallback: fetch within date range, sort/filter department locally if missing index
              return await getDocsByDepts(
                (fieldName) => query(
                  collectionRef,
                  where(fieldName, '==', deptFilter),
                  limit(250)
                ),
                () => query(
                  collectionRef,
                  where('createdAt', '>=', start),
                  where('createdAt', '<=', end)
                )
              );
            }
          })(),
          fetchMyTodaySessions()
        ]);
        snapWrapper = departmentSnap;
        myTodaySessions = mySessions;
      } catch (globalQueryError) {
        console.error("[TODAY SEARCH] Failed querying department and personal sessions in parallel", globalQueryError);
        // Fallback: run sequentially or at least return empty for one of them
        snapWrapper = { docs: [], lastDoc: null, length: 0 };
        myTodaySessions = [];
      }

      const allFetched = snapWrapper.docs.map(doc => {
        const data = doc.data() as any;
        const resolvedDept = resolveSessionDepartmentId(data);
        return {
          id: doc.id,
          ...data,
          departmentId: resolvedDept
        };
      });
      // Filter out uploading sessions for the main department query
      let mainDeptData = allFetched.filter(s => s.status !== 'uploading');

      // Safe post-filtering for isolation security on main list
      if (deptFilter) {
        mainDeptData = mainDeptData.filter(s => s.departmentId === deptFilter);
      }
      mainDeptData = mainDeptData.filter(s => s.createdAt >= start && s.createdAt <= end);

      // Now resolve department IDs for "xe của tôi"
      const resolvedMySessions = myTodaySessions.map(session => {
        const resolvedDept = resolveSessionDepartmentId(session);
        return {
          ...session,
          departmentId: resolvedDept
        };
      });

      // Deduplicate by combining both lists, preferring "my sessions" (which keeps status 'uploading' sessions)
      const mergedMap = new Map<string, any>();
      mainDeptData.forEach(s => {
        mergedMap.set(s.id, s);
      });
      resolvedMySessions.forEach(s => {
        mergedMap.set(s.id, s);
      });

      let finalData = Array.from(mergedMap.values());
      finalData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      setSessions(finalData);
    } catch (err) {
      console.error('[TODAY SEARCH] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'today') {
      fetchSessions();
    } else {
      if (hasSearched) {
        fetchSearch(true);
      } else {
        setSessions([]);
        setLastDoc(null);
        setHasMore(false);
      }
    }
  }, [fromDate, toDate, mode, selectedDeptFilter]);

  const handleDelete = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    // Check delete permissions (admin can delete all, users only their dept check)
    const sessDept = session.departmentId || session.department;
    const userDept = user?.departmentId || user?.department;
    const isAuthorized = user?.role === 'admin' || (
      user?.canDeleteSession === true && 
      sessDept && userDept && sessDept === userDept
    );

    if (!isAuthorized) {
      if (user?.role !== 'admin' && user?.canDeleteSession !== true) {
        alert("Bạn không có quyền xóa phiên xe!");
      } else {
        alert("Bạn không có quyền xóa phiên xe của bộ phận khác!");
      }
      setDeletingId(null);
      return;
    }

    setLoading(true);
    try {
      console.log('--- STARTING DELETION ---');
      console.log('Session ID:', id);
      console.log('Vehicle:', session.plateNumber);
      console.log('Document Path: cars/' + id);

      // 1. Delete images from Storage
      const uniquePaths = new Set<string>();
      if (session.storagePaths) {
        session.storagePaths.forEach((path: string) => { if (path) uniquePaths.add(path); });
      }
      if (session.imageUrls) {
        session.imageUrls.forEach((url: string) => {
          if (url) {
            try {
              const r = ref(storage, url);
              if (r && r.fullPath) {
                uniquePaths.add(r.fullPath);
              }
            } catch (e) {
              console.warn("Could not parse ref from URL:", url);
            }
          }
        });
      }

      console.log('Images to delete:', uniquePaths.size);

      if (uniquePaths.size > 0) {
        console.log('Deleting all photos from Storage...');
        const deletePromises = Array.from(uniquePaths).map((p: string) => {
          const imageRef = ref(storage, p);
          return deleteObject(imageRef).catch(err => {
            console.warn(`Could not delete item ${p}:`, err.code);
          });
        });
        await Promise.all(deletePromises);
      }

      // 2. Delete subcollection 'images'
      const imagesSubFolderQuery = query(collection(db, 'cars', id, 'images'));
      const imagesSubFolderSnap = await getDocs(imagesSubFolderQuery);
      if (!imagesSubFolderSnap.empty) {
        console.log('Deleting subcollection images...');
        const subDeletePromises = imagesSubFolderSnap.docs.map(imgDoc => deleteDoc(imgDoc.ref));
        await Promise.all(subDeletePromises);
      }

      // 3. Delete main document from Firestore
      console.log('Deleting Firestore document...');
      await deleteDoc(doc(db, 'cars', id));
      console.log('Firestore document deleted successfully.');

      // 4. Update UI and Reload
      setDeletingId(null);
      alert(`Đã xóa triệt để phiên xe ${session.plateNumber} thành công!`);
      
      // Reload to ensure truth from server
      await fetchSessions();
      console.log('--- DELETION COMPLETE ---');
    } catch (err: any) {
      console.error('CRITICAL DELETE ERROR:', err);
      alert('LỖI KHI XÓA: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setLoading(false);
    }
  };

  const normalize = (str: string) => {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  const filteredSessions = mode === 'search'
    ? sessions
    : sessions.filter(s => {
        if (!searchTerm) return true;
        
        const searchNorm = normalize(searchTerm);
        if (!searchNorm) return true;

        const plateNorm = normalize(s.plateNumber);
        const roNorm = normalize(s.roNumber);
        const idNorm = normalize(s.id);
        const noteNorm = normalize(s.note || '');

        return (
          plateNorm.includes(searchNorm) ||
          roNorm.includes(searchNorm) ||
          idNorm.includes(searchNorm) ||
          noteNorm.includes(searchNorm)
        );
      });

  return (
    <div className="p-4 sm:p-6 pb-40 space-y-5 sm:space-y-6 max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto w-full">
      {/* Department filter for admin */}
      {user?.role === 'admin' && (
        <div 
          ref={filterRef}
          className="w-full overflow-x-auto no-scrollbar flex items-center gap-2 py-1 scroll-smooth shrink-0 select-none pb-2"
        >
          <button
            type="button"
            data-active={selectedDeptFilter === 'all'}
            onClick={() => setSelectedDeptFilter('all')}
            className={`px-4 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
              selectedDeptFilter === 'all'
                ? 'bg-toyota-navy text-white border-toyota-navy shadow-md scale-95'
                : 'text-gray-500 hover:text-toyota-navy bg-white border-gray-150/60 shadow-sm hover:border-gray-300'
            }`}
          >
            Tất cả
          </button>
          {Object.entries(deptNames).map(([code, name]) => (
            <button
              key={code}
              type="button"
              data-active={selectedDeptFilter === code}
              onClick={() => setSelectedDeptFilter(code)}
              className={`px-4 py-2.5 rounded-full text-[11px] font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
                selectedDeptFilter === code
                  ? 'bg-toyota-navy text-white border-toyota-navy shadow-md scale-95'
                  : 'text-gray-500 hover:text-toyota-navy bg-white border-gray-150/60 shadow-sm hover:border-gray-300'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {mode === 'today' ? (
        <section className="bg-white py-3.5 px-4 sm:px-5 rounded-[24px] sm:rounded-[28px] shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-3.5 bg-toyota-red rounded-full"></div>
            <h2 className="text-[11px] font-black text-toyota-navy uppercase tracking-widest leading-none">Khoảng ngày xe</h2>
          </div>
          <div className="grid grid-cols-12 gap-2 sm:gap-3 items-end">
            <div className="col-span-5 space-y-1 text-left">
              <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider block">Từ ngày</label>
              <input 
                type="date" 
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full bg-gray-50 border-gray-150 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-toyota-navy focus:bg-white focus:ring-1 focus:ring-toyota-navy focus:outline-none" 
              />
            </div>
            <div className="col-span-5 space-y-1 text-left">
              <label className="text-[9px] font-black uppercase text-gray-400 tracking-wider block">Đến ngày</label>
              <input 
                type="date" 
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full bg-gray-50 border-gray-150 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-toyota-navy focus:bg-white focus:ring-1 focus:ring-toyota-navy focus:outline-none" 
              />
            </div>
            <div className="col-span-2">
              <button 
                type="button"
                onClick={fetchSessions}
                className="w-full h-[32px] sm:h-[34px] bg-toyota-navy text-white rounded-xl shadow-md active:scale-95 transition-transform flex items-center justify-center cursor-pointer"
              >
                {loading ? <Loader2 className="animate-spin" size={14} /> : <CalendarIcon size={14} />}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-toyota-navy p-6 rounded-[32px] shadow-xl space-y-5 border border-white/5">
           <div className="flex items-center gap-2 text-white">
            <Search size={18} className="text-toyota-red" />
            <h2 className="text-sm font-black uppercase tracking-widest">Tìm kiếm hệ thống</h2>
          </div>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Biển số hoặc Số lệnh..."
              className="w-full bg-white/10 border-none rounded-2xl px-5 py-4 text-sm font-bold text-white placeholder:text-white/30 focus:ring-2 focus:ring-toyota-red transition-all"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (e.target.value.length >= 3) setSearchWarning(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  fetchSearch(true);
                }
              }}
            />
            {searchWarning && (
              <p className="text-[10px] text-toyota-red font-bold mt-2 uppercase tracking-widest animate-pulse">
                ⚠️ {searchWarning}
              </p>
            )}
          </div>
          <button 
             onClick={() => fetchSearch(true)}
             disabled={loading}
             className="w-full py-4 bg-toyota-red text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-red-900/40 active:scale-95 transition-transform disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin mx-auto" size={16} /> : 'TRUY VẤN DỮ LIỆU'}
          </button>
        </section>
      )}

      <div className="space-y-4 px-1">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black text-toyota-navy uppercase tracking-widest leading-none">
                {mode === 'search' ? 'KẾT QUẢ TÌM KIẾM' : 'KẾT QUẢ'}
              </h2>
              <span className="bg-gray-200 text-gray-500 text-[11px] px-2.5 py-0.5 rounded-full font-black leading-none">
                {filteredSessions.length}
              </span>
            </div>

            {mode === 'today' && (
              <button
                type="button"
                disabled={loading}
                onClick={fetchSessions}
                className="text-[10px] font-black uppercase text-toyota-red hover:text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-red-200/50 flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Đang làm mới...</span>
                  </>
                ) : (
                  <span>Làm mới danh sách</span>
                )}
              </button>
            )}
          </div>
          
          {mode === 'today' && (
            <>
              <div className="relative w-full text-left">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input 
                  type="text" 
                  placeholder="Lọc nhanh biển số, lệnh RO, ghi chú..."
                  className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-9 py-2.5 text-[11px] font-bold focus:ring-1 focus:ring-toyota-navy focus:border-toyota-navy outline-none text-toyota-navy transition-all placeholder:text-gray-400 placeholder:font-medium shadow-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 active:scale-90 transition-transform rounded-full hover:bg-gray-100 cursor-pointer"
                    title="Xoá tìm kiếm"
                  >
                    <FilterX size={14} />
                  </button>
                )}
              </div>
              <p className="text-[10.5px] text-gray-500 font-bold leading-normal text-left">
                💡 Vừa chụp xong chưa thấy xe? Hãy bấm Làm mới danh sách hoặc tìm theo biển số.
              </p>
            </>
          )}
        </div>

        {loading && filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-300">
            <div className="w-10 h-10 border-4 border-gray-100 border-t-toyota-red rounded-full animate-spin"></div>
            <span className="text-[11px] font-black uppercase tracking-widest">
              {mode === 'search' ? 'Đang tìm kiếm…' : 'Đang kết nối server...'}
            </span>
          </div>
        ) : mode === 'search' && !hasSearched ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center">
              <Search size={32} strokeWidth={1.5} className="opacity-20" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-[11px] font-black uppercase tracking-widest">Sẵn sàng tìm kiếm</p>
              <p className="text-[11px] font-medium opacity-60">Nhập biển số hoặc số RO để bắt đầu</p>
            </div>
          </div>
        ) : filteredSessions.length > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-5">
              {filteredSessions.map((session) => {
                const sessionProp = {
                  id: session.id,
                  plateNumber: session.plateNumber,
                  roNumber: session.roNumber,
                  createdAt: session.createdAt,
                  imageCount: session.imageCount,
                  thumbnailUrl: session.thumbnailUrl,
                  note: session.note,
                  imageUrls: session.imageUrls,
                  storagePaths: session.storagePaths,
                  capturedAt: session.capturedAt,
                  uploadedAt: session.uploadedAt,
                  createdAtText: session.createdAtText,
                  department: session.department,
                  departmentId: session.departmentId,
                  createdByUid: session.createdByUid,
                  createdByEmail: session.createdByEmail,
                  createdByName: session.createdByName,
                  status: session.status
                };
                return (
                  <SessionCard 
                    key={session.id} 
                    session={sessionProp as any} 
                    deptNames={deptNames}
                    onView={(id) => {
                      const found = sessions.find(s => s.id === id);
                      if (!found) return;
                      const foundSessDept = resolveSessionDepartmentId(found);
                      const userDept = user?.departmentId || user?.department;
                      const isOwner = found.createdByUid === user?.uid || found.uploadedByUid === user?.uid;
                      if (user?.role !== 'admin' && foundSessDept !== userDept && !isOwner) {
                        alert("Bạn không có quyền xem phiên xe của bộ phận khác!");
                        return;
                      }
                      setSelectedSession(found);
                      setActiveImageIndex(0);
                    }}
                    onEdit={(id) => {
                      const found = sessions.find(s => s.id === id);
                      if (!found) return;
                      const foundSessDept = resolveSessionDepartmentId(found);
                      const userDept = user?.departmentId || user?.department;
                      const isOwner = found.createdByUid === user?.uid || found.uploadedByUid === user?.uid;
                      if (user?.role !== 'admin' && foundSessDept !== userDept && !isOwner) {
                        alert("Bạn không có quyền sửa phiên xe của bộ phận khác!");
                        return;
                      }
                      setEditingSession(found);
                    }}
                    onDelete={(id) => {
                      const found = sessions.find(s => s.id === id);
                      if (!found) return;
                      const foundSessDept = resolveSessionDepartmentId(found);
                      const userDept = user?.departmentId || user?.department;
                      const isOwner = found.createdByUid === user?.uid || found.uploadedByUid === user?.uid;
                      if (user?.role !== 'admin' && foundSessDept !== userDept && !isOwner) {
                        alert("Bạn không có quyền xóa phiên xe của bộ phận khác!");
                        return;
                      }
                      setDeletingId(id);
                    }}
                  />
                );
              })}
            </div>
            
            {mode === 'search' && hasMore && (
              <button
                onClick={() => fetchSearch(false)}
                disabled={loading}
                className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-toyota-navy rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
              >
                {loading ? <Loader2 className="animate-spin text-toyota-navy" size={16} /> : 'XEM THÊM'}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-400">
            <FilterX size={48} strokeWidth={1} className="opacity-20" />
            <div className="text-center space-y-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-[#9ca3af]">
                {mode === 'search' ? 'Không tìm thấy phiên phù hợp.' : (searchTerm ? 'Không có phiên phù hợp' : 'Không có dữ liệu')}
              </p>
              <p className="text-[10px] font-medium opacity-60">
                {mode === 'search' ? 'Thử biển số khác hoặc kiểm tra lại từ khóa' : (searchTerm ? 'Thử thay đổi từ khóa lọc nhanh' : 'Thử thay đổi bộ lọc hoặc từ khóa')}
              </p>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {deletingId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-toyota-navy/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-xs rounded-[32px] p-8 shadow-2xl space-y-6 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-toyota-red rounded-full flex items-center justify-center mx-auto">
                <Trash2 size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-black text-toyota-navy uppercase tracking-tighter">Xác nhận xóa?</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Bạn có chắc chắn muốn xóa phiên xe <span className="font-bold text-toyota-navy">{sessions.find(s => s.id === deletingId)?.plateNumber}</span>? 
                  Hành động này không thể hoàn tác.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setDeletingId(null)}
                  className="py-3.5 rounded-2xl bg-gray-100 text-gray-500 font-black text-[10px] uppercase tracking-widest active:scale-95 transition-transform"
                >
                  Hủy bỏ
                </button>
                <button 
                  onClick={() => handleDelete(deletingId)}
                  className="py-3.5 rounded-2xl bg-toyota-red text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-red-200 active:scale-95 transition-transform"
                >
                  Xác nhận
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {selectedSession && (() => {
          const urls = selectedSession.imageUrls || [];
          const activeUrl = urls[activeImageIndex] || '';
          return (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#073b70] z-[70] flex flex-col overflow-hidden"
            >
              {/* Header: biển số / mã phiên / nút đóng */}
              <div className="flex items-center justify-between p-6 pb-2 flex-shrink-0">
                <div>
                  <h3 className="text-white font-black text-2xl leading-none tracking-tighter">{selectedSession.plateNumber}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {selectedSession.roNumber && (
                      <span className="text-[10px] bg-toyota-red text-white px-2 py-0.5 rounded font-black uppercase tracking-wider">
                        {selectedSession.roNumber}
                      </span>
                    )}
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">
                      #{selectedSession.id.slice(-6).toUpperCase()}
                    </span>
                    <span className="text-white/30 text-[10px]">•</span>
                    <span className="text-[10px] text-white/70 font-semibold bg-white/10 px-2 py-0.5 rounded">
                      {(() => {
                        const potentialDates = [
                          (selectedSession as any).capturedAt,
                          selectedSession.createdAt,
                          (selectedSession as any).uploadedAt,
                          (selectedSession as any).createdAtText,
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
                              return `${pad(dateObj.getDate())}/${pad(dateObj.getMonth() + 1)}/${dateObj.getFullYear()} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                            }
                          } catch (e) {}
                        }
                        return 'Không rõ thời gian chụp';
                      })()}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={closeViewer}
                  className="bg-white/10 text-white p-3 rounded-full hover:bg-white/20 transition-colors active:scale-95 flex items-center justify-center cursor-pointer"
                  id="close-modal"
                >
                  <X size={20} />
                </button>
              </div>
              
              {/* Phần giữa: ảnh chính, co giãn trong không gian còn lại */}
              <div className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden px-6">
                {/* Prev button */}
                {urls.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : urls.length - 1));
                    }}
                    className="absolute left-4 bg-black/40 text-white hover:bg-black/60 p-3 rounded-full z-10 transition-all active:scale-90 flex items-center justify-center cursor-pointer"
                  >
                    <ChevronLeft size={24} />
                  </button>
                )}

                {/* Main image container with limiting max-width/max-height wrapper */}
                <div className="w-full h-full max-w-[calc(100vw-48px)] max-h-[calc(100vh-180px)] flex items-center justify-center overflow-hidden select-none relative group">
                  {activeUrl ? (
                    <ResolvedImage 
                      url={activeUrl} 
                      storagePath={selectedSession.storagePaths?.[activeImageIndex]}
                      alt={`img-${activeImageIndex}`} 
                      className="w-auto h-auto max-w-full max-h-full object-contain rounded-2xl shadow-2xl border border-white/10 select-none cursor-pointer hover:scale-[1.01] transition-transform duration-300"
                      onDoubleClick={() => {
                        if (urls.length > 1) {
                          setActiveImageIndex((prev) => (prev < urls.length - 1 ? prev + 1 : 0));
                        }
                      }}
                      onClick={() => {
                        if (isSelectionMode) {
                          handleToggleIndex(activeImageIndex);
                        }
                      }}
                    />
                  ) : (
                    <p className="text-white/40 text-xs italic font-semibold">Không có ảnh</p>
                  )}

                  {isSelectionMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleIndex(activeImageIndex);
                      }}
                      className="absolute top-4 right-4 bg-black/60 hover:bg-black/85 text-white rounded-2xl px-4 py-2.5 z-10 transition-all active:scale-95 flex items-center gap-2 cursor-pointer shadow-lg border border-white/10"
                    >
                      {selectedIndices.includes(activeImageIndex) ? (
                        <>
                          <span className="bg-toyota-red text-white p-0.5 rounded-full flex items-center justify-center">
                            <Check size={12} strokeWidth={4} />
                          </span>
                          <span className="text-xs font-black uppercase tracking-wider text-white">Đã chọn</span>
                        </>
                      ) : (
                        <>
                          <Circle size={14} className="text-white/80" />
                          <span className="text-xs font-black uppercase tracking-wider text-white/95">Chọn ảnh này</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Next button */}
                {urls.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex((prev) => (prev < urls.length - 1 ? prev + 1 : 0));
                    }}
                    className="absolute right-4 bg-black/40 text-white hover:bg-black/60 p-3 rounded-full z-10 transition-all active:scale-90 flex items-center justify-center cursor-pointer"
                  >
                    <ChevronRight size={24} />
                  </button>
                )}
              </div>

              {/* Phần dưới: Ghi chú nếu có và thumbnail nếu có */}
              <div className="p-6 pt-2 pb-8 flex flex-col gap-4 flex-shrink-0 bg-black/25">
                
                {/* Ghi chú phiên nếu có */}
                {selectedSession.note && selectedSession.note.trim() !== "" && (
                  <div className="bg-white/5 rounded-2xl border border-white/10 p-3.5 max-h-[90px] overflow-y-auto scroller w-full max-w-lg mx-auto">
                    <span className="text-[10px] font-black tracking-wider text-toyota-red uppercase block mb-1">Ghi chú:</span>
                    <p className="text-xs text-white/95 font-semibold leading-relaxed break-words">
                      {selectedSession.note}
                    </p>
                  </div>
                )}

                {/* Thumbnail lists */}
                {urls.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scroller whitespace-nowrap justify-start md:justify-center w-full max-w-xl mx-auto">
                    {urls.map((url: string, idx: number) => {
                      const isSelected = selectedIndices.includes(idx);
                      const isActive = activeImageIndex === idx;
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            if (isSelectionMode) {
                              handleToggleIndex(idx);
                            }
                            setActiveImageIndex(idx);
                          }}
                          className={`w-12 h-12 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all active:scale-95 cursor-pointer relative ${
                            isSelected 
                              ? "border-toyota-red scale-105 shadow-md opacity-100" 
                              : isActive 
                              ? "border-white scale-102 opacity-95" 
                              : "border-transparent opacity-40 hover:opacity-80"
                          }`}
                        >
                          <ResolvedImage url={url} storagePath={selectedSession.storagePaths?.[idx]} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                          {isSelected && (
                            <div className="absolute inset-0 bg-black/45 flex items-center justify-center animate-fade-in">
                              <span className="bg-toyota-red text-white p-0.5 rounded-full flex items-center justify-center shadow-lg">
                                <Check size={8} strokeWidth={4} />
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Selection and Downloader Toolbar */}
                <div className="w-full max-w-sm mx-auto">
                  {isSelectionMode ? (
                    <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-white">
                          CHỌN ẢNH ĐỂ CHIA SẺ / TẢI
                        </span>
                        <button
                          onClick={handleExitSelection}
                          className="text-[10px] text-toyota-red hover:text-red-400 uppercase font-bold tracking-wider bg-white/5 hover:bg-white/15 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer border border-toyota-red/20"
                        >
                          Thoát chọn
                        </button>
                      </div>

                      {/* CHON TAT CA / BO CHON TAT CA */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleSelectAll(urls.length)}
                          className="text-[10px] font-black uppercase tracking-wider text-white/90 bg-white/5 hover:bg-white/15 border border-white/10 py-2 rounded-xl transition-all cursor-pointer text-center animate-fade-in"
                        >
                          Chọn Tất Cả
                        </button>
                        <button
                          onClick={handleDeselectAll}
                          className="text-[10px] font-black uppercase tracking-wider text-white/70 bg-white/5 hover:bg-white/15 border border-white/5 py-2 rounded-xl transition-all cursor-pointer text-center animate-fade-in"
                        >
                          Bỏ Chọn Tất Cả
                        </button>
                      </div>

                      {/* Checkbox for adding overlay information */}
                      <div className="flex items-start gap-2.5 bg-white/5 border border-white/5 rounded-xl p-3 mt-1 mb-1 animate-fade-in">
                        <input
                          type="checkbox"
                          id="share_overlay_toggle"
                          checked={shareOverlayToggle}
                          onChange={(e) => setShareOverlayToggle(e.target.checked)}
                          className="w-4 h-4 rounded border-white/20 text-toyota-red focus:ring-toyota-red mt-0.5 cursor-pointer accent-toyota-red bg-white/5"
                        />
                        <label htmlFor="share_overlay_toggle" className="text-[11.5px] text-white/95 font-black select-none cursor-pointer flex-1 leading-snug">
                          Thêm thời gian & địa chỉ lên ảnh
                          <span className="block text-[9.5px] text-white/50 font-bold leading-normal mt-0.5">
                            Ảnh gốc trong hệ thống không thay đổi.
                          </span>
                        </label>
                      </div>

                      <div className="flex items-center justify-between py-1 border-t border-b border-white/5">
                        <span className="text-[11px] font-black uppercase tracking-widest text-white flex items-center gap-1.5 py-1">
                          <Check size={14} className="text-toyota-red" strokeWidth={3} />
                          {(() => {
                            const count = selectedIndices.length;
                            if (count === 10 && urls.length > 10) {
                              const isFirst10 = selectedIndices.slice().sort((a,b) => a - b).every((val, index) => val === index);
                              if (isFirst10) {
                                return <span className="text-yellow-400">Đã chọn 10 ảnh đầu tiên để chia sẻ</span>;
                              }
                            }
                            return <>Đã chọn <span className="text-toyota-red font-black text-sm px-0.5">{count}</span>/10 ảnh</>;
                          })()}
                        </span>
                      </div>

                      {isPreparingShare ? (
                        <div className="space-y-3 animate-fade-in">
                          <div className="flex items-center justify-center gap-1.5 py-2 px-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs font-black uppercase text-yellow-400 tracking-wider">
                            <Loader2 className="animate-spin text-yellow-400" size={14} />
                            Đang chuẩn bị {prepareProgress?.current || 0}/{prepareProgress?.total || 0} ảnh...
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              disabled
                              className="w-full py-3 bg-gray-700/50 text-white/50 rounded-xl font-black text-xs uppercase tracking-widest cursor-not-allowed flex items-center justify-center gap-1.5"
                            >
                              Chuẩn bị {prepareProgress?.current || 0}/{prepareProgress?.total || 0}...
                            </button>
                            <button
                              disabled
                              className="w-full py-3 bg-gray-700/50 text-white/50 rounded-xl font-black text-xs uppercase tracking-widest cursor-not-allowed"
                            >
                              TẢI VỀ MÁY
                            </button>
                          </div>
                        </div>
                      ) : preparedFiles.length > 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-center gap-1.5 py-2 px-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs font-black uppercase text-green-400 tracking-wider">
                            <Check size={14} strokeWidth={4} />
                            Ảnh đã sẵn sàng chia sẻ
                          </div>
                          {prepareFailureCount > 0 && (
                            <div className="text-[10px] text-center text-yellow-400 font-semibold px-1">
                              Lưu ý: Có {prepareFailureCount} ảnh không thể chuẩn bị thành công.
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={handleShare}
                              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              CHIA SẺ QUA ZALO
                            </button>
                            <button
                              onClick={handleStartDownload}
                              className="w-full py-3 bg-toyota-red hover:bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-98 transition-all cursor-pointer"
                            >
                              TẢI VỀ MÁY
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {prepareError && (
                            <div className="flex flex-col items-center justify-center gap-1 py-2 px-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] font-bold text-red-400 text-center uppercase tracking-wide">
                              <span>{prepareError}</span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              disabled
                              className="w-full py-3 bg-gray-700/50 text-white/30 rounded-xl font-black text-xs uppercase tracking-widest cursor-not-allowed flex items-center justify-center gap-1.5"
                            >
                              CHIA SẺ QUA ZALO
                            </button>
                            <button
                              disabled
                              className="w-full py-3 bg-gray-700/50 text-white/30 rounded-xl font-black text-xs uppercase tracking-widest cursor-not-allowed"
                            >
                              TẢI VỀ MÁY
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setIsSelectionMode(true);
                        setSelectedIndices([activeImageIndex]);
                      }}
                      className="w-full py-3.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                      CHỌN & CHIA SẺ / TẢI ẢNH
                    </button>
                  )}
                </div>

                {/* Progress indicator Modal inside the absolute area */}
                {isDownloading && (
                  <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[80] flex items-center justify-center p-6 animate-fade-in">
                    <div className="bg-[#0b1c2c] border border-white/10 rounded-2xl p-6 w-full max-w-xs text-center space-y-4 shadow-2xl">
                      <Loader2 className="animate-spin text-toyota-red mx-auto" size={40} strokeWidth={3} />
                      <div className="space-y-1">
                        <h4 className="text-white font-black text-sm uppercase tracking-wider">
                          ĐANG TẢI ẢNH VỀ MÁY
                        </h4>
                        <p className="text-xs text-white/70 font-semibold">
                          Đang tải {downloadProgress?.current}/{downloadProgress?.total} ảnh...
                        </p>
                      </div>

                      {/* Progress bar */}
                      <div className="relative w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className="absolute top-0 left-0 h-full bg-toyota-red transition-all duration-300" 
                          style={{ 
                            width: `${
                              (((downloadProgress?.current) || 1) / 
                              ((downloadProgress?.total) || 1)) * 100
                            }%` 
                          }}
                        />
                      </div>

                      <button
                        onClick={handleCancelDownload}
                        className="w-full py-2.5 bg-white/10 hover:bg-red-700/80 hover:text-white text-white/80 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all cursor-pointer border border-white/10"
                      >
                        HỦY
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col items-center gap-1.5 pt-1">
                   {/* Admin-only creator and updater info */}
                   {user?.role === 'admin' && (
                     <div className="text-center text-[10px] text-white/50 leading-relaxed font-semibold max-w-sm mx-auto space-y-1 my-1">
                       {selectedSession.createdByName && (
                         <p>
                           <span className="text-white/30 uppercase tracking-widest text-[8px] font-black mr-1">Tạo Bởi:</span>
                           <span className="text-white/80 font-bold">{selectedSession.createdByName}</span>
                           {selectedSession.createdByEmail && <span className="text-white/40 ml-1">({selectedSession.createdByEmail})</span>}
                         </p>
                       )}
                       {selectedSession.updatedByName && (
                         <p>
                           <span className="text-white/30 uppercase tracking-widest text-[8px] font-black mr-1">Cập Nhật Bởi:</span>
                           <span className="text-white/80 font-bold">{selectedSession.updatedByName}</span>
                           {selectedSession.updatedByEmail && <span className="text-white/40 ml-1">({selectedSession.updatedByEmail})</span>}
                         </p>
                       )}
                     </div>
                   )}
                   <p className="text-white/40 text-[9px] font-extrabold uppercase tracking-widest italic leading-none">
                      Chụp bởi Hệ Thống Toyota Hà Đông
                   </p>
                </div>
              </div>
            </motion.div>
          );
        })()}

        {editingSession && (
          <EditSessionModal
            session={editingSession}
            isOpen={!!editingSession}
            onClose={() => setEditingSession(null)}
            onSaveComplete={() => {
              // Reload whole session index list
              fetchSessions();
              // Async fetch of the freshly updated session to reflect changes in current open modal
              setTimeout(() => {
                const sessionDocRef = doc(db, 'cars', editingSession.id);
                getDoc(sessionDocRef).then((snapshot) => {
                  if (snapshot.exists()) {
                    setEditingSession({ id: snapshot.id, ...snapshot.data() });
                  }
                }).catch((err) => {
                  console.error("Error refreshing active modal session:", err);
                });
              }, 500);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function X({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  );
}
