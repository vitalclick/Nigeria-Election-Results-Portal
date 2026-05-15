'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseIRevPU } = require('../lib/parse');

const sampleA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample_shape_a.json'), 'utf-8')
);
const sampleB = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample_shape_b.json'), 'utf-8')
);

test('parses IReV shape A (result.scores)', () => {
  const out = parseIRevPU(sampleA, '25-11-04-007');
  assert.ok(out);
  assert.equal(out.extracted.candidate_votes.APC, 142);
  assert.equal(out.extracted.candidate_votes.LP, 203);
  assert.equal(out.extracted.total_valid_votes, 434);
  assert.equal(out.extracted.total_votes_cast, 446);
  assert.equal(out.image_url, 'https://lv.irev.inecnigeria.org/uploads/2023/pres/25-11-04-007.jpg');
});

test('parses IReV shape B (data.results map)', () => {
  const out = parseIRevPU(sampleB, '25-11-04-007');
  assert.ok(out);
  assert.equal(out.extracted.candidate_votes.PDP, 89);
  assert.equal(out.extracted.total_valid_votes, 434);
});

test('returns null when payload is empty or unrecognised', () => {
  assert.equal(parseIRevPU(null, 'x'), null);
  assert.equal(parseIRevPU({}, 'x'), null);
  assert.equal(parseIRevPU({ random: 'junk' }, 'x'), null);
});

test('arithmetic sums match across shapes', () => {
  const a = parseIRevPU(sampleA, '25-11-04-007');
  const b = parseIRevPU(sampleB, '25-11-04-007');
  const sumA = Object.values(a.extracted.candidate_votes).reduce((x, y) => x + y, 0);
  const sumB = Object.values(b.extracted.candidate_votes).reduce((x, y) => x + y, 0);
  assert.equal(sumA, sumB);
  assert.equal(sumA, a.extracted.total_valid_votes);
});

test('normalises party codes to upper case', () => {
  const out = parseIRevPU(
    {
      result: {
        scores: [
          { party: 'apc', score: 10 },
          { party: ' pdp ', score: 20 },
        ],
      },
      document_url: 'https://example.com/x.jpg',
    },
    'X'
  );
  assert.deepEqual(Object.keys(out.extracted.candidate_votes).sort(), ['APC', 'PDP']);
});
