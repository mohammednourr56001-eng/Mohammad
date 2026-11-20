import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response } from 'express';
import { observability } from './observability.ts';
import { INDEX_DIR, ensureStorageDirectories } from './storageManager.ts';

let cachedSigningSecret = '';
let secretFromEnv = false;

function getSigningSecret(): string {
  if (cachedSigningSecret) return cachedSigningSecret;
  const configured =
    process.env.UST_SIGNING_SECRET ||
    process.env.SESSION_SECRET;
  if (configured && configured.trim().length >= 16) {
    cachedSigningSecret = configured.trim();
    secretFromEnv = true;
    return cachedSigningSecret;
  }

  // Persist dedicated signing secret on server storage (NEVER reuse GEMINI_API_KEY)
  try {
    ensureStorageDirectories();
    const secretFile = path.join(INDEX_DIR, '.ust_signing_secret');
    if (fs.existsSync(secretFile)) {
      const stored = fs.readFileSync(secretFile, 'utf8').trim();
      if (stored.length >= 32) {
        cachedSigningSecret = stored;
        return cachedSigningSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    cachedSigningSecret = generated;
    return cachedSigningSecret;
  } catch {
    cachedSigningSecret = crypto.randomBytes(32).toString('hex');
    return cachedSigningSecret;
  }
}

export function isPersistentSigningSecretConfigured(): boolean {
  getSigningSecret();
  return secretFromEnv || fs.existsSync(path.join(INDEX_DIR, '.ust_signing_secret'));
}

export interface SignedTokenPayload {
  sub: string;
  action: 'cdn_download' | 'direct_upload' | 'file_preview';
  exp: number;
  uid?: string;
  meta?: Record<string, string | number>;
}

export function createSignedUrlToken(payload: Omit<SignedTokenPayload, 'exp'> & { ttlSeconds?: number }): {
  token: string;
  expiresAt: number;
} {
  const ttl = Math.max(30, Math.min(3600, payload.ttlSeconds ?? 300));
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const fullPayload: SignedTokenPayload = {
    sub: payload.sub,
    action: payload.action,
    exp: expiresAt,
    ...(payload.uid ? { uid: payload.uid } : {}),
    ...(payload.meta ? { meta: payload.meta } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return {
    token: `${encoded}.${sig}`,
    expiresAt,
  };
}

export function verifySignedUrlToken(
  token: string,
  expectedAction: SignedTokenPayload['action'],
  expectedSub?: string
): { valid: true; payload: SignedTokenPayload } | { valid: false; reason: string } {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'رمز التوقيع مفقود أو غير صالح.' };
  }
  const [encoded, providedSig] = token.split('.', 2);
  if (!encoded || !providedSig) {
    return { valid: false, reason: 'صيغة التوقيع غير مكتملة.' };
  }

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'فشل التحقق الأمني من التوقيع الرقمي.' };
  }

  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedTokenPayload;
    if (decoded.action !== expectedAction) {
      return { valid: false, reason: 'نوع صلاحية الرابط الموقع غير مطابق.' };
    }
    if (expectedSub && decoded.sub !== expectedSub) {
      return { valid: false, reason: 'معرف المورد لا يطابق الرابط الموقع.' };
    }
    if (!decoded.exp || Math.floor(Date.now() / 1000) > decoded.exp) {
      return { valid: false, reason: 'انتهت صلاحية الرابط الموقع. يرجى طلب رابط جديد.' };
    }
    return { valid: true, payload: decoded };
  } catch {
    return { valid: false, reason: 'تعذر قراءة بيانات الرابط الموقع.' };
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const DEV_CONNECT_SRC = IS_DEV ? ' ws://localhost:24678 ws://127.0.0.1:24678' : '';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com https://www.gstatic.com https://*.gstatic.com",
  "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://drive.google.com https://docs.google.com https://calendar.google.com https://classroom.google.com",
  `connect-src 'self' https://*.googleapis.com https://oauth2.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com https://docs.googleapis.com https://www.googleapis.com${DEV_CONNECT_SRC}`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function enterpriseSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function validateMutatingOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api/')) return next();
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    const originHost = new URL(origin).host;
    if (host && originHost === String(host).split(',')[0].trim()) {
      return next();
    }
    const configuredOrigin = process.env.ALLOWED_ORIGIN?.trim();
    if (configuredOrigin && origin === configuredOrigin) {
      return next();
    }
    res.status(403).json({ error: 'مرفوض: مصدر الطلب (Origin) غير مصرح به.' });
  } catch {
    res.status(403).json({ error: 'مرفوض: ترويسة Origin غير صالحة.' });
  }
}

export function createTieredRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientIp =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : '') ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${options.keyPrefix}:${clientIp}`;
    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, entry);
    }

    const remainingBefore = Math.max(0, options.maxRequests - entry.count);
    const resetEpochSec = Math.ceil(entry.resetAt / 1000);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remainingBefore - 1)));
    res.setHeader('X-RateLimit-Reset', String(resetEpochSec));

    if (entry.count >= options.maxRequests) {
      observability.recordRateLimitBlock();
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'تم تجاوز الحد المسموح من الطلبات مؤقتاً لحماية استقرار المنصة. يرجى المحاولة بعد قليل.',
        retryAfterSeconds: retryAfterSec,
      });
    }

    entry.count += 1;
    if (buckets.size > 5000) {
      for (const [bKey, bVal] of buckets.entries()) {
        if (now >= bVal.resetAt) {
          buckets.delete(bKey);
        }
      }
      if (buckets.size > 10000) {
        buckets.clear();
      }
    }
    next();
  };
}

