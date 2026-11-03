import { MongoClient } from 'mongodb';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const DB_NAME = process.env.MONGODB_DB || 'qalam_library';
const SECRET_KEY = createHash('sha256').update(process.env.LIBRARY_SESSION_SECRET || 'local-only').digest();

export function sealSecret(value) {
  if (!value) return '';
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function openSecret(value) {
  if (!value) return '';
  const [iv, tag, data] = String(value).split('.');
  if (!iv || !tag || !data) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

export async function connectAdminStore(uri) {
  if (!uri) return null;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, retryWrites: true });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    await Promise.all([
      db.collection('managedContent').createIndex({ documentId: 1, status: 1, updatedAt: -1 }),
      db.collection('managedContent').createIndex({ status: 1, category: 1, date: -1 }),
      db.collection('adminAudit').createIndex({ createdAt: -1 }),
    ]);
    return {
      client, db,
      settings: db.collection('librarySettings'),
      content: db.collection('managedContent'),
      audit: db.collection('adminAudit'),
    };
  } catch (error) {
    await client.close().catch(() => {});
    console.error('Library MongoDB connection unavailable:', error?.name || 'connection_error');
    return null;
  }
}

export async function recordAudit(store, actor, action, target, details = {}) {
  if (!store) return;
  await store.audit.insertOne({ actor, action, target, details, createdAt: new Date() });
}
