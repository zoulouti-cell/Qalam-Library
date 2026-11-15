/* يشغّل خادم المكتبة على منفذ حر مع قاعدة تجريبية وMongo محلي، ويوفّر كوكيز جلسة موقّعة للاختبارات. */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeLibraryDb } from './make-library-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });
export const SESSION_SECRET = 'test-secret-' + 'x'.repeat(32);
export const sessionCookie = (role, email = '') => {
  const account = email ? Buffer.from(email).toString('base64url') : 'legacy', expiry = String(Date.now() + 3600_000), payload = `${expiry}.${role}.${account}`;
  return `qalam_session=${payload}.${createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')}`;
};
export async function bootServer({ mongoUri = process.env.QALAM_TEST_MONGODB_URI, env = {}, dbName: givenDb } = {}) {
  if (!mongoUri) throw new Error('QALAM_TEST_MONGODB_URI is required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-lib-')), db = makeLibraryDb(path.join(dir, 'library.sqlite')), port = await freePort();
  const dbName = givenDb || 'qalam_lib_test_' + Math.random().toString(36).slice(2, 8);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', QALAM_DB_PATH: db, MONGODB_URI: mongoUri, MONGODB_DB: dbName, LIBRARY_SESSION_SECRET: SESSION_SECRET, LIBRARY_ADMIN_PASSWORD: 'test-shared-admin-password', NODE_ENV: 'test', QALAM_TEST_WRITE_LIMIT: '5000', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + '/api/health').catch(() => null); if (r) break; } catch {} if (child.exitCode !== null) throw new Error('server exited: ' + log); await new Promise(r => setTimeout(r, 150)); }
  const seedUser = async (email, role = 'reader') => { const { MongoClient } = await import('mongodb'); const c = await MongoClient.connect(mongoUri); try { await c.db(dbName).collection('libraryUsers').updateOne({ email }, { $set: { email, role, active: true, accountStatus: 'active', mustChangePassword: false } }, { upsert: true }); } finally { await c.close(); } };
  const mongo = async fn => { const { MongoClient } = await import('mongodb'); const c = await MongoClient.connect(mongoUri); try { return await fn(c.db(dbName)); } finally { await c.close(); } };
  return { base, port, dbName, seedUser, mongo, dir, log: () => log, stop: async () => { child.kill(); await new Promise(r => child.once('exit', r)); fs.rmSync(dir, { recursive: true, force: true }); } };
}
