/**
 * Cloudflare Worker — Free-Tier R2 Signed Lecture Storage Proxy & Direct Upload Gateway
 * Zero credit card / R2 Free Tier (10 GB/month storage, 1M Class A ops, 10M Class B ops)
 * Never exposes R2 Access Keys or Secrets in the frontend bundle.
 */

interface R2ObjectBody {
  body: ReadableStream<Uint8Array> | null;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream<Uint8Array> | string,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<unknown>;
}

export interface Env {
  UST_R2_BUCKET: R2Bucket;
  UST_SIGNING_SECRET: string;
  ALLOWED_ORIGIN: string;
  MAX_FILE_SIZE_BYTES?: string;
}

const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
  'zip',
]);

async function verifyHmacSignature(
  secret: string,
  payload: string,
  providedHex: string
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expectedHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (expectedHex.length !== providedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i += 1) {
    diff |= expectedHex.charCodeAt(i) ^ providedHex.charCodeAt(i);
  }
  return diff === 0;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const configured = (env.ALLOWED_ORIGIN || '').trim();
  const reqOrigin = request.headers.get('Origin') || '';
  const allowOrigin = configured
    ? configured === reqOrigin
      ? configured
      : configured
    : reqOrigin || 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-UST-Signature, X-UST-Expires',
  };
}

function hasAllowedMagicHeader(ext: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // Reject MZ/ELF/Mach-O/#! executables
  if (
    (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
    (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) ||
    (bytes[0] === 0x23 && bytes[1] === 0x21)
  ) {
    return false;
  }
  if (ext === 'pdf') {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 32));
    return head.includes('%PDF-');
  }
  if (ext === 'png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx' || ext === 'zip') {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
  }
  if (ext === 'doc' || ext === 'ppt' || ext === 'xls') {
    return (
      (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    );
  }
  return false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/r2\//, ''));
    const expires = url.searchParams.get('expires') || '';
    const sig = url.searchParams.get('sig') || '';
    const mode = url.searchParams.get('mode') || 'download';

    if (!key || key.includes('..') || !expires || !sig) {
      return Response.json({ error: 'Missing signed R2 storage parameters' }, { status: 400 });
    }

    const expMs = Number(expires);
    if (!Number.isFinite(expMs) || Date.now() > expMs) {
      return Response.json({ error: 'Signed R2 URL expired' }, { status: 403 });
    }

    const validSig = await verifyHmacSignature(
      env.UST_SIGNING_SECRET,
      `${mode}:${key}:${expires}`,
      sig
    );
    if (!validSig) {
      return Response.json({ error: 'Invalid signed R2 signature' }, { status: 403 });
    }

    if (request.method === 'PUT' && mode === 'upload') {
      const ext = key.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return Response.json({ error: `Unsupported extension .${ext}` }, { status: 400 });
      }
      const maxBytes = Number(env.MAX_FILE_SIZE_BYTES || 25 * 1024 * 1024);
      const body = await request.arrayBuffer();
      if (body.byteLength <= 0 || body.byteLength > maxBytes) {
        return Response.json({ error: 'File exceeds allowed R2 free-tier limit' }, { status: 413 });
      }
      if (!hasAllowedMagicHeader(ext, new Uint8Array(body.slice(0, 64)))) {
        return Response.json({ error: 'File magic-byte signature rejected' }, { status: 400 });
      }
      const shaDigest = await crypto.subtle.digest('SHA-256', body);
      const sha256 = Array.from(new Uint8Array(shaDigest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      await env.UST_R2_BUCKET.put(key, body, {
        httpMetadata: {
          contentType: request.headers.get('content-type') || 'application/octet-stream',
          cacheControl: 'private, no-store',
        },
        customMetadata: { sha256 },
      });

      return Response.json(
        { ok: true, key, size: body.byteLength, sha256 },
        { status: 201, headers: corsHeaders(request, env) }
      );
    }

    if (request.method === 'GET' && mode === 'download') {
      const obj = await env.UST_R2_BUCKET.get(key);
      if (!obj) {
        return Response.json({ error: 'Object not found in R2' }, { status: 404 });
      }
      const headers = new Headers(corsHeaders(request, env));
      obj.writeHttpMetadata(headers);
      headers.set('ETag', obj.httpEtag);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cache-Control', 'private, no-store');
      return new Response(obj.body, { headers });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  },
};
