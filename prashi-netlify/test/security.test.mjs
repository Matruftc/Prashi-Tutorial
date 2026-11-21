import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../lib/security.mjs';
import { makePortalHandler } from '../netlify/functions/portal.mjs';

test('verifies an Argon2id hash created by the Python app', async () => {
  const legacy = '$argon2id$v=19$m=65536,t=3,p=4$dGVzdF9zYWx0XzE2X2Nocg$kzDAxraZCPZHl/HQ/TMVhWyEB0bpY6w19g7jTYra6Ek';
  assert.equal(await verifyPassword(legacy, 'prashi existing test password'), true);
  assert.equal(await verifyPassword(legacy, 'wrong password'), false);
  assert.equal(await verifyPassword(legacy.replace('m=65536', 'm=99999999'), 'prashi existing test password'), false);
});

test('generates a compatible password hash', async () => {
  const hashed = await hashPassword('a different test password', randomBytes(16));
  assert.equal(await verifyPassword(hashed, 'a different test password'), true);
});

test('rejects cross-origin and malformed requests before connecting to Atlas', async () => {
  const handler = makePortalHandler(async () => { throw new Error('Database called unexpectedly'); });
  const post = (origin, body) => handler(new Request('https://example.test/api/login', {
    method: 'POST', headers: { 'Origin': origin, 'Content-Type': 'application/json' }, body,
  }));
  assert.equal((await post('https://other.test', '{}')).status, 403);
  assert.equal((await post('https://example.test', 'null')).status, 400);
  assert.equal((await post('https://example.test', 'bad-json')).status, 400);
  assert.equal((await post('https://example.test', ' '.repeat(4097))).status, 413);
});

test('random exam sets preserve marks and contain no duplicate questions', async () => {
  const { makePapers } = await import('../lib/exams.mjs');
  const groups = [
    { marks: 2, count: 2, questions: ['Define heat.', 'Define energy.', 'Define force.'] },
    { marks: 5, count: 1, questions: ['Compare methods of heat transfer.', 'Design a simple experiment.'] },
  ];
  const papers = makePapers(groups, 4);
  assert.equal(new Set(papers.map(paper => JSON.stringify(paper))).size, 4);
  for (const paper of papers) {
    assert.deepEqual(paper.map(question => question.marks).sort(), [2, 2, 5]);
    assert.equal(new Set(paper.map(question => question.text)).size, 3);
  }
  assert.throws(() => makePapers([{ marks: 2, count: 2, questions: ['Heat?', 'heat?'] }], 1));
});

test('extracts numbered multiline questions and checks upload signatures', async () => {
  const { splitQuestions, decodeUpload } = await import('../lib/documents.mjs');
  assert.deepEqual(splitQuestions('Question 1. Explain energy.\nInclude an example.\nPage 1\n2) Explain force.'),
    ['Explain energy.\nInclude an example.', 'Explain force.']);
  assert.throws(() => decodeUpload({ name: 'fake.pdf', data: Buffer.from('not a PDF').toString('base64') }));
});
