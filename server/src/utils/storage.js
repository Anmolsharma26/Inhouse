// File uploads for chat + task attachments.
// - CLOUDINARY_URL set (production): files go to Cloudinary (free plan), because hosts like Render wipe their disk on restart.
// - otherwise (development): files are saved to server/uploads and served from /uploads.
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { httpError } from './helpers.js';

const useCloud = !!process.env.CLOUDINARY_URL; // cloudinary://<key>:<secret>@<cloud_name>, read automatically by the SDK
const UPLOAD_DIR = path.resolve('uploads');
const ALLOWED = /^(image\/(png|jpe?g|gif|webp)|application\/(pdf|zip)|text\/plain|application\/vnd\.(openxmlformats|ms-excel).*)$/;
const safeName = (n) => n.replace(/[^\w.-]/g, '_');

if (!useCloud) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const upload = multer({
  storage: useCloud ? multer.memoryStorage() : multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_r, f, cb) => cb(null, `${Date.now()}-${safeName(f.originalname)}`),
  }),
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(ALLOWED.test(f.mimetype) ? null : httpError(400, 'File type not allowed'), ALLOWED.test(f.mimetype)),
});

/** Store the uploaded file and return the attachment object saved with messages/tasks: {url,name,mime,size} */
export async function saveUpload(file) {
  if (!file) throw httpError(400, 'No file');
  const meta = { name: file.originalname.slice(0, 200), mime: file.mimetype, size: file.size };
  if (!useCloud) return { url: `/uploads/${file.filename}`, ...meta };
  const isImage = file.mimetype.startsWith('image/');
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({
      folder: process.env.CLOUDINARY_FOLDER || 'radiantmap',
      resource_type: isImage ? 'image' : 'raw', // raw keeps PDFs/Excel/zip byte-for-byte
      public_id: `${Date.now()}-${safeName(file.originalname)}`,
      use_filename: false, overwrite: false,
    }, (err, res) => (err ? reject(err) : resolve(res))).end(file.buffer);
  });
  return { url: result.secure_url, ...meta };
}

/** Only accept attachment URLs this server produced (blocks javascript: links and arbitrary external URLs). */
export function cleanAttachments(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10)
    .filter((a) => typeof a?.url === 'string' && (a.url.startsWith('/uploads/') || a.url.startsWith('https://res.cloudinary.com/')))
    .map((a) => ({ url: a.url, name: String(a.name || 'file').slice(0, 200), mime: a.mime ? String(a.mime).slice(0, 100) : undefined, size: Number(a.size) || 0 }));
}
