/**
 * nutrition/photo.ts — turn a picked meal photo into a small base64 JPEG.
 *
 * A phone camera shot is 3–12MB; the estimator needs "what is on the plate",
 * not pixels, and the Edge Function caps its request body. So the photo is
 * downscaled on-device to ≤`maxDim` on its long side and re-encoded as JPEG
 * before a single byte leaves the browser.
 *
 * DOM-only by nature (canvas), deliberately thin and untested — jsdom has no
 * canvas. The tested seam is `MealEstimateRequest`, which takes the already
 * encoded photo; tests hand it a fixture string.
 */

const JPEG_QUALITY = 0.8;

export async function downscalePhoto(
  file: File,
  maxDim = 1024,
): Promise<{ mimeType: 'image/jpeg'; base64: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('bad data url');
    return { mimeType: 'image/jpeg', base64: dataUrl.slice(comma + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}
