import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase";

// In-memory cache for resolved download URLs (using either storagePath or old URL as key)
const resolvedUrlCache: Record<string, string> = {};

/**
 * Extracts the Storage object path from an absolute Firebase Storage URL.
 * Works for both:
 * - https://firebasestorage.googleapis.com/v0/b/anh-xe-thd.appspot.com/o/car-images%2Fxxxx.jpg?alt=media&token=...
 * - https://firebasestorage.googleapis.com/v0/b/anh-xe-thd.firebasestorage.app/o/car-images%2Fxxxx.jpg?alt=media&token=...
 */
export function getObjectPathFromUrl(url?: string): string | null {
  if (!url) return null;

  try {
    const parts = url.split('/o/');
    if (parts.length < 2) return null;
    const pathAndParams = parts[1];
    const pathEncoded = pathAndParams.split('?')[0];
    return decodeURIComponent(pathEncoded);
  } catch (e) {
    console.error("Error parsing object path from URL:", url, e);
    return null;
  }
}

/**
 * Resolves a given image URL or Storage Path into a valid active download URL.
 * Priority rules:
 * 1. storagePath on current bucket (via ref)
 * 2. Extracted object path from Firebase download URL (via ref)
 * 3. Fallback to original URL, as long as it does not point to the test bucket.
 */
export async function resolveImageUrl(url?: string, storagePath?: string): Promise<string> {
  // Scenario 1: storagePath is present in the document.
  if (storagePath) {
    const trimmedPath = storagePath.trim();
    if (resolvedUrlCache[trimmedPath]) {
      return resolvedUrlCache[trimmedPath];
    }
    try {
      const storageRef = ref(storage, trimmedPath);
      const downloadUrl = await getDownloadURL(storageRef);
      resolvedUrlCache[trimmedPath] = downloadUrl;
      return downloadUrl;
    } catch (err: any) {
      console.warn(`Error resolving storagePath ${trimmedPath}:`, err);
    }
  }

  // Scenario 2: Extract object path from the Firebase download URL and fetch download URL from current bucket.
  const extractedPath = getObjectPathFromUrl(url);
  if (extractedPath) {
    if (resolvedUrlCache[extractedPath]) {
      return resolvedUrlCache[extractedPath];
    }
    try {
      const storageRef = ref(storage, extractedPath);
      const downloadUrl = await getDownloadURL(storageRef);
      resolvedUrlCache[extractedPath] = downloadUrl;
      return downloadUrl;
    } catch (err: any) {
      console.warn(`Error resolving extracted object path ${extractedPath}:`, err);
    }
  }

  // Scenario 3: Fallback block to the current URL itself, ONLY if it's not pointing to the test bucket.
  if (url) {
    const isTestUrl = url.includes('-test');
    if (!isTestUrl) {
      return url;
    }
  }

  throw new Error("Không thể chuẩn bị ảnh. Vui lòng kiểm tra kết nối hoặc quyền truy cập Storage.");
}
