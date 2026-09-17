/**
 * nutrition/camera.ts — the live-camera seam for 📸 progress photos.
 *
 * The same move as aiPort.ts: the screen talks to a small interface, tests
 * implement it in memory, and exactly ONE function here (`browserCamera`)
 * touches `navigator.mediaDevices`. A file picker cannot show anything OVER
 * the viewfinder, and the whole point of the live camera is the ghost — the
 * previous photo of the same pose laid over the preview at a chosen opacity,
 * so the next shot is framed like the last one.
 *
 * ORIENTATION. A selfie preview is mirrored (that is what people expect of a
 * mirror); the CAPTURE is not — the stored photo is the true view, the one a
 * friend with a camera would take, so every photo in the gallery agrees with
 * every other whichever camera took it. The screen mirrors the ghost with the
 * preview, so the two line up on the front camera too.
 *
 * DOM-only by nature (video, canvas); the tested seam is the port. Nothing
 * here is awaited by anything but the camera sheet itself.
 */

import type { PreparedPhoto } from './photo.ts';

export type CameraFacing = 'user' | 'environment';

export type CameraError =
  /** The user (or the OS) said no. */
  | 'denied'
  /** No camera on this device / none the browser can see. */
  | 'none'
  /** Not a secure context, no mediaDevices API, or an unexpected failure. */
  | 'unavailable';

export interface CameraSession {
  /** Which way this session's camera faces (what was granted, not what was asked). */
  readonly facing: CameraFacing;
  /** Show the live stream in this element. */
  attach(video: HTMLVideoElement): void;
  /** Grab the current frame, downscaled to `maxDim` on its long side, as a JPEG blob. */
  capture(maxDim: number): Promise<PreparedPhoto>;
  /** Release the camera. Idempotent. */
  stop(): void;
}

export type CameraOpenResult = { ok: true; session: CameraSession } | { ok: false; error: CameraError };

export interface CameraPort {
  /** True when a live camera can be offered AT ALL (API present, secure context). */
  available(): boolean;
  open(facing: CameraFacing): Promise<CameraOpenResult>;
}

/* --------------------------------------------------------------- browser */

const JPEG_QUALITY = 0.85;

function classify(err: unknown): CameraError {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'none';
  return 'unavailable';
}

function facingOf(stream: MediaStream, asked: CameraFacing): CameraFacing {
  const track = stream.getVideoTracks()[0];
  const mode = track?.getSettings?.().facingMode;
  return mode === 'user' || mode === 'environment' ? mode : asked;
}

/** The real thing. Constructed once in main.ts; inert until `open`. */
export function browserCamera(): CameraPort {
  return {
    available(): boolean {
      try {
        return (
          typeof navigator !== 'undefined' &&
          typeof navigator.mediaDevices?.getUserMedia === 'function' &&
          (typeof window === 'undefined' || window.isSecureContext !== false)
        );
      } catch {
        return false;
      }
    },
    async open(facing: CameraFacing): Promise<CameraOpenResult> {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1706 } },
          audio: false,
        });
      } catch (err) {
        return { ok: false, error: classify(err) };
      }
      let video: HTMLVideoElement | null = null;
      let stopped = false;
      const session: CameraSession = {
        facing: facingOf(stream, facing),
        attach(el: HTMLVideoElement): void {
          video = el;
          el.srcObject = stream;
          el.muted = true;
          el.setAttribute('playsinline', '');
          void el.play().catch(() => undefined);
        },
        capture(maxDim: number): Promise<PreparedPhoto> {
          return new Promise((resolve, reject) => {
            const v = video;
            if (!v || v.videoWidth === 0) {
              reject(new Error('no frame yet'));
              return;
            }
            const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
            const width = Math.max(1, Math.round(v.videoWidth * scale));
            const height = Math.max(1, Math.round(v.videoHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('no 2d context'));
              return;
            }
            ctx.drawImage(v, 0, 0, width, height);
            canvas.toBlob((b) => (b ? resolve({ blob: b, width, height }) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY);
          });
        },
        stop(): void {
          if (stopped) return;
          stopped = true;
          for (const t of stream.getTracks()) t.stop();
          if (video) video.srcObject = null;
          video = null;
        },
      };
      return { ok: true, session };
    },
  };
}
