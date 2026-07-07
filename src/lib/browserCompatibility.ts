/**
 * Browser and WebView compatibility checker.
 * Detects risky environment such as in-app browsers, old devices, or lack of critical HTML5 APIs.
 */

export interface BrowserCompatibilityInfo {
  userAgent: string;
  isLikelyInAppBrowser: boolean;
  isLikelyAndroidWebView: boolean;
  isLikelyIOSWebView: boolean;
  supportsRequiredUploadApis: boolean;
  warnings: string[];
}

export function getBrowserCompatibilityInfo(): BrowserCompatibilityInfo {
  const warnings: string[] = [];
  
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userAgent: 'server',
      isLikelyInAppBrowser: false,
      isLikelyAndroidWebView: false,
      isLikelyIOSWebView: false,
      supportsRequiredUploadApis: false,
      warnings: ['Đang chạy trên môi trường máy chủ (SSR).']
    };
  }

  const ua = navigator.userAgent || '';
  const uaLower = ua.toLowerCase();

  // 1. Detect In-App Browsers (Zalo, Facebook, FB Messenger, Instagram, TikTok, Line, WeChat, etc.)
  const isZalo = uaLower.includes('zalo') || uaLower.includes('zaloweb');
  const isFB = uaLower.includes('fbav') || uaLower.includes('fban') || uaLower.includes('fb_iab') || uaLower.includes('messenger');
  const isInstagram = uaLower.includes('instagram');
  const isTikTok = uaLower.includes('tiktok');
  
  const isLikelyInAppBrowser = isZalo || isFB || isInstagram || isTikTok;

  // 2. Detect Android WebView / iOS WebView
  // Android WebView indicators: 'wv' or '; wv' or 'Version/4.0' in conjunction with Android but not Chrome/Opera/Firefox standalone
  const isAndroid = uaLower.includes('android');
  const isLikelyAndroidWebView = isAndroid && (
    uaLower.includes('; wv') || 
    (uaLower.includes('version/') && !uaLower.includes('chrome/')) ||
    uaLower.includes('webview')
  );

  // iOS WebView indicators: iPad/iPhone/iPod, not running standard Safari (which doesn't usually contain WebView-only tokens or is launched inside another app wrapper)
  const isIOS = /ipad|iphone|ipod/.test(uaLower);
  // An iOS WebView often doesn't say "Safari/" or matches specific app headers, but for safety, we check if it is iOS and in-app
  const isLikelyIOSWebView = isIOS && (isLikelyInAppBrowser || uaLower.includes('webview') || (!uaLower.includes('safari/') && !uaLower.includes('crios/')));

  // 3. Verify presence of required APIs for image compression & Firebase Storage uploads
  const hasBlob = typeof window.Blob !== 'undefined';
  const hasFile = typeof window.File !== 'undefined';
  const hasCreateObjectUrl = typeof window.URL !== 'undefined' && typeof window.URL.createObjectURL === 'function';
  const hasCanvas = typeof document !== 'undefined' && typeof document.createElement('canvas').getContext === 'function';
  const hasPromise = typeof window.Promise !== 'undefined';
  const hasFetch = typeof window.fetch === 'function';

  const supportsRequiredUploadApis = hasBlob && hasFile && hasCreateObjectUrl && hasCanvas && hasPromise && hasFetch;

  // Compile specific warnings
  if (!supportsRequiredUploadApis) {
    const missingApis: string[] = [];
    if (!hasBlob) missingApis.push('Blob');
    if (!hasFile) missingApis.push('File');
    if (!hasCreateObjectUrl) missingApis.push('URL.createObjectURL');
    if (!hasCanvas) missingApis.push('Canvas 2D');
    if (!hasPromise) missingApis.push('Promise');
    if (!hasFetch) missingApis.push('fetch');
    
    warnings.push(`Trình duyệt thiếu các tính năng quan trọng hỗ trợ xử lý ảnh: ${missingApis.join(', ')}.`);
  }

  if (isZalo) {
    warnings.push('Bạn đang mở ứng dụng bên trong trình duyệt Zalo. Trình duyệt này có thể không ổn định khi nén và tải ảnh lên.');
  } else if (isFB) {
    warnings.push('Bạn đang mở ứng dụng bên trong Messenger/Facebook. Trình duyệt này có giới hạn bộ nhớ lớn khi xử lý ảnh.');
  } else if (isLikelyInAppBrowser) {
    warnings.push('Bạn đang mở ứng dụng bên trong một ứng dụng khác (In-App Browser). Hãy bấm nút Menu (ba chấm) ở góc trên bên phải màn hình và chọn "Mở bằng trình duyệt hệ thống" hoặc "Mở bằng Chrome" để có trải nghiệm ổn định nhất.');
  }

  if (isLikelyAndroidWebView || isLikelyIOSWebView) {
    warnings.push('Ứng dụng đang chạy dưới dạng WebView của thiết bị. Hãy cập nhật ứng dụng Android System WebView hoặc iOS Safari lên bản mới nhất để tránh lỗi bộ nhớ (Crash).');
  }

  return {
    userAgent: ua,
    isLikelyInAppBrowser,
    isLikelyAndroidWebView,
    isLikelyIOSWebView,
    supportsRequiredUploadApis,
    warnings
  };
}
