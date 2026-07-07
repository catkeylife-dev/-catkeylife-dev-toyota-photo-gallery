import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import imageCompression from 'browser-image-compression';
import { PlateRecognitionResult } from '../types';

// Fingerprint generator
export function getFileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

// Image compression utility
export async function preprocessImageForRecognition(file: File): Promise<{
  imageBase64: string;
  mimeType: "image/jpeg";
  fingerprint: string;
}> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Định dạng file không hợp lệ. Vui lòng chọn ảnh.');
  }

  const maxSizeInBytes = 30 * 1024 * 1024; // 30 MB limit
  if (file.size > maxSizeInBytes) {
    throw new Error('Giới hạn kích thước ảnh gốc tối đa 30 MB để nhận diện.');
  }

  const fingerprint = getFileFingerprint(file);

  const options = {
    maxSizeMB: 8, // Safety limit for compressed output size
    maxWidthOrHeight: 1600,
    useWebWorker: true,
    initialQuality: 0.9,
    fileType: 'image/jpeg'
  };

  let compressedFile: File | Blob = file;
  try {
    compressedFile = await imageCompression(file, options);
  } catch (error) {
    console.warn("[PlateRecognition] Image compression process failed, falling back:", error);
  }

  const base64String = await fileToBase64(compressedFile);
  const imageBase64 = base64String.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');

  return {
    imageBase64,
    mimeType: "image/jpeg",
    fingerprint
  };
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// Service function to call the Firebase Callable Function
export async function callRecognizeVehiclePlate(
  imageBase64: string,
  requestId: string
): Promise<PlateRecognitionResult> {
  try {
    const recognizeFn = httpsCallable<{
      imageBase64: string;
      mimeType: string;
      requestId: string;
    }, any>(functions, "recognizeVehiclePlate");

    const response = await recognizeFn({
      imageBase64,
      mimeType: "image/jpeg",
      requestId
    });

    const data = response.data;
    
    // Validate basic response structure
    if (!data || typeof data !== 'object') {
      throw new Error('Response is null or not an object');
    }

    // Checking required fields to ensure it is valid PlateRecognitionResult
    if (
      typeof data.plateFound !== 'boolean' ||
      !('plateDisplay' in data) ||
      !('plateNormalized' in data) ||
      typeof data.confidence !== 'number' ||
      typeof data.classification !== 'string'
    ) {
      throw new Error('Phản hồi từ máy chủ không đúng định dạng nhận diện.');
    }

    return data as PlateRecognitionResult;
  } catch (error: any) {
    console.error("[PlateRecognitionService] Callable function error:", error);
    throw error;
  }
}
