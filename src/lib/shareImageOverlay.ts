import { Timestamp } from 'firebase/firestore';

export interface ShareImageOverlayOptions {
  file: File | Blob;
  capturedAt?: unknown;
  addressLines: string[];
  plate?: string;
  fileName?: string;
}

/**
 * Formats capturedAt timestamp into dd/MM/yyyy HH:mm:ss format.
 * Supports Firestore Timestamp, JS Date, ISO string, milliseconds/seconds numbers.
 */
function formatTimestamp(val: unknown): string {
  if (!val) return '';
  let date: Date | null = null;

  try {
    if (val instanceof Date) {
      date = val;
    } else if (typeof val === 'object' && val !== null) {
      // Check for Firestore Timestamp properties
      const t = val as any;
      if (typeof t.toDate === 'function') {
        date = t.toDate();
      } else if (typeof t.seconds === 'number') {
        date = new Date(t.seconds * 1000);
      }
    } else if (typeof val === 'number') {
      // Milliseconds vs Seconds check
      if (val < 10000000000) {
        date = new Date(val * 1000);
      } else {
        date = new Date(val);
      }
    } else if (typeof val === 'string') {
      date = new Date(val);
    }
  } catch (e) {
    console.error('Error parsing capturedAt date:', e);
  }

  if (!date || isNaN(date.getTime())) {
    return '';
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const dd = pad(date.getDate());
  const MM = pad(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `${dd}/${MM}/${yyyy} ${HH}:${mm}:${ss}`;
}

/**
 * Creates a new File with the date/time and address overlaid on the image.
 * Uses a Canvas, executes client-side only, does not alter the original file.
 */
export async function createShareImageWithOverlay(options: ShareImageOverlayOptions): Promise<File> {
  const { file, capturedAt, addressLines, fileName } = options;

  // Create an object URL from the input file/blob
  const objectUrl = URL.createObjectURL(file);

  try {
    // Load the image
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Avoid potential security exceptions with CORS
    img.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Không thể tải ảnh để xử lý chèn chữ.'));
    });

    // Create a canvas with the original image dimensions
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Không khởi tạo được bộ xử lý 2D Canvas.');
    }

    // Draw the original image
    ctx.drawImage(img, 0, 0);

    // Filter and format lines
    const dateText = formatTimestamp(capturedAt);
    const textLines: string[] = [];
    if (dateText) {
      textLines.push(dateText);
    }
    if (addressLines && addressLines.length > 0) {
      textLines.push(...addressLines.filter(line => line.trim().length > 0));
    }

    if (textLines.length > 0) {
      // Calculate font size (between 2.2% and 3.0% of image width, min 14px, max 64px)
      const calculatedSize = Math.floor(canvas.width * 0.024);
      const fontSize = Math.max(14, Math.min(64, calculatedSize));
      
      // Set font
      ctx.font = `bold ${fontSize}px "Inter", system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';

      const lineHeight = Math.floor(fontSize * 1.35);

      // Measure max width of text lines
      let maxTextWidth = 0;
      for (const line of textLines) {
        const metrics = ctx.measureText(line);
        if (metrics.width > maxTextWidth) {
          maxTextWidth = metrics.width;
        }
      }

      // Calculate container box dimensions with padding
      const paddingX = Math.floor(fontSize * 0.8);
      const paddingY = Math.floor(fontSize * 0.6);
      const boxWidth = maxTextWidth + paddingX * 2;
      const boxHeight = textLines.length * lineHeight + paddingY * 2;

      // Position: top-right corner with margin
      const margin = Math.max(10, Math.min(40, Math.floor(canvas.width * 0.02)));
      const boxX = canvas.width - boxWidth - margin;
      const boxY = margin;

      // Draw beautiful semi-transparent background card
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      
      // Draw rounded rectangle
      const radius = Math.max(4, Math.floor(fontSize * 0.3));
      ctx.beginPath();
      ctx.moveTo(boxX + radius, boxY);
      ctx.lineTo(boxX + boxWidth - radius, boxY);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
      ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
      ctx.lineTo(boxX + radius, boxY + boxHeight);
      ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
      ctx.lineTo(boxX, boxY + radius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
      ctx.closePath();
      ctx.fill();

      // Draw shadow for text inside
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      // Draw lines
      ctx.fillStyle = '#FFFFFF';
      textLines.forEach((line, index) => {
        const lineY = boxY + paddingY + index * lineHeight;
        // Since textAlign is 'right', the X coordinate is the right edge of the text boundary
        const lineX = boxX + boxWidth - paddingX;
        ctx.fillText(line, lineX, lineY);
      });

      // Reset shadow to avoid affecting other operations
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Export to JPEG Blob with high quality (0.92)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
    });

    if (!blob) {
      throw new Error('Không xuất được ảnh JPEG từ canvas.');
    }

    // Get original or specified filename
    const originalName = fileName || (file as File).name || 'shared_image.jpg';
    
    // Create and return the final File object
    return new File([blob], originalName, { type: 'image/jpeg' });

  } finally {
    // Always revoke the object URL to avoid memory leaks
    URL.revokeObjectURL(objectUrl);
  }
}
