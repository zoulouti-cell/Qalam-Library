/* خيط فهرسة الإحالات: يقرأ القرارات من القاعدة (للقراءة فقط) ويعيد الفهرس دون حجز الخادم */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { indexRows, DECISIONS_SQL } from './ref-index.mjs';

const db = new DatabaseSync(workerData.file, { readOnly: true });
const index = indexRows(db.prepare(DECISIONS_SQL).iterate());
db.close();
parentPort.postMessage([...index]);
