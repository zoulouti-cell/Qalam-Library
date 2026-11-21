import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('المجدول يصفّي بطاقات النشر قبل تقييد الدفعة فلا تحجبها البطاقات الممنوعة', () => {
  const block = server.slice(server.indexOf('function runLegalPublication'), server.indexOf('const legalPublishTimer'));
  assert.match(block, /\.limit\(500\)/);
  assert.match(block, /\.filter\(mayAutoPublish\)\.slice\(0,\s*20\)/);
  assert.match(block, /sort\(\{autoPublishAt:1\}\)/);
});
