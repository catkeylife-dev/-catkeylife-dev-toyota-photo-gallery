import React, { useState, useEffect } from 'react';
import { resolveImageUrl } from '@/src/lib/imageResolver';

interface ResolvedImageProps {
  url?: string;
  storagePath?: string;
  fallbackText?: string;
  alt?: string;
  className?: string;
  onDoubleClick?: () => void;
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
  loading?: "lazy" | "eager";
}

export default function ResolvedImage({
  url,
  storagePath,
  fallbackText = "Ảnh chưa được sao chép sang môi trường thử nghiệm.",
  alt,
  className,
  onDoubleClick,
  onClick,
  loading,
}: ResolvedImageProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingImg, setLoadingImg] = useState<boolean>(true);

  useEffect(() => {
    if (!url && !storagePath) {
      setResolvedUrl(null);
      setError(null);
      setLoadingImg(false);
      return;
    }

    let isMounted = true;
    setLoadingImg(true);
    setError(null);

    resolveImageUrl(url, storagePath)
      .then((resolved) => {
        if (isMounted) {
          setResolvedUrl(resolved);
          setLoadingImg(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(err.message || fallbackText);
          setLoadingImg(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [url, storagePath, fallbackText]);

  if (loadingImg) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 border border-gray-100 rounded-2xl relative overflow-hidden flex-shrink-0 ${className}`}>
        <div className="w-5 h-5 border-2 border-toyota-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-red-50 text-red-600 border border-red-100 p-3.5 rounded-2xl text-center flex-shrink-0 text-[10px] font-black leading-relaxed tracking-tight select-none ${className}`}>
        <span className="text-base mb-1">⚠️</span>
        <span className="max-w-[150px] break-words">{error}</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl || ""}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      loading={loading}
    />
  );
}
