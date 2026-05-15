#!/usr/bin/env node
'use strict';

// OpenBallot Nigeria - 2023 IReV results scraper
//
// Walks the polling-unit registry (already produced by Polling-Units/scraper.js)
// and for each (election, PU) pair:
//
//   1. Asks IReV for the per-PU result + EC8A image URL
//   2. Downloads the image
//   3. Mirrors it to our object storage with SHA-256
//   4. Upserts an ec8a_submissions row (source=inec_irev, review_status=auto_approved)
//   5. Writes an audit_log event - the SQL trigger chains the hash
//   6. Marks progress to a resumable JSON file
//
// Flags:
//   --state <NAME>     Limit to one state (e.g. "Lagos" or "LA")
//   --election <type>  Limit to one election type (presidential|senate|...)
//   --dry-run          Skip all writes; useful for endpoint validation
//   --reset            Discard progress and start over
//   --max <N>          Stop after N successful PUs (smoke test)

const fs = require('fs');
const path = require('path');

const config = require('./config');
const { walkPollingUnits, countPollingUnits } = require('./lib/geo');
const { fetchPUResult, fetchImage } = require('./lib/irev_client');
const { parseIRevPU } = require('./lib/parse');
const { uploadImage } = require('./lib/storage');
const { upsertInecSubmission, close: closeDb } = require('./lib/persist');
const progress = require('./lib/progress');
const { sleep } = require('./lib/http');

function parseArgs(argv) {
  const out = { state: null, election: null, max: Infinity, reset: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') out.state = argv[++i];
    else if (a === '--election') out.election = argv[++i];
    else if (a === '--max') out.max = parseInt(argv[++i], 10);
    else if (a === '--reset') out.reset = true;
  }
  return out;
}

async function processOne(state, electionType, electionId, pu) {
  try {
    const { url: irevUrl, json } = await fetchPUResult(electionId, pu.pu_code);
    const parsed = parseIRevPU(json, pu.pu_code);
    if (!parsed) {
      progress.fail(state, electionId, pu.pu_code, 'unparseable IReV response');
      return 'error';
    }

    const { bytes, contentType } = await fetchImage(parsed.image_url);
    const upload = await uploadImage({
      electionId,
      puCode: pu.pu_code,
      bytes,
      contentType,
    });

    await upsertInecSubmission({
      electionId,
      puCode: pu.pu_code,
      imageUrl: upload.url || parsed.image_url,
      imageSha256: upload.sha256,
      imageBytes: upload.bytes,
      extracted: parsed.extracted,
      irevSubmittedAt: parsed.raw_meta.submitted_at,
      irevRecordId: parsed.raw_meta.irev_record_id,
    });

    progress.done(state, electionId, pu.pu_code, 'ok');
    return 'ok';
  } catch (e) {
    if (e.code === 'not_uploaded') {
      progress.done(state, electionId, pu.pu_code, 'not_uploaded');
      return 'not_uploaded';
    }
    progress.fail(state, electionId, pu.pu_code, e.message);
    return 'error';
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.reset) progress.reset();

  const state = progress.load();
  const electionTypes = args.election
    ? [args.election]
    : config.electionTypes;

  const totalPUs = countPollingUnits({ stateFilter: args.state });
  console.log(
    `Scraping ${electionTypes.length} election(s) across ${totalPUs} polling units` +
      (args.state ? ` (filtered to ${args.state})` : '') +
      (config.dryRun ? ' [DRY RUN]' : '')
  );

  let processed = 0;
  for (const electionType of electionTypes) {
    const electionId = `2023-${electionType === 'governorship' ? 'governorship' : electionType}`;
    const irevElectionId = config.electionIds[electionType];
    if (!irevElectionId) {
      console.warn(`no IReV ID configured for ${electionType}; skipping`);
      continue;
    }

    for (const pu of walkPollingUnits({ stateFilter: args.state })) {
      if (processed >= args.max) break;
      if (progress.isDone(state, electionId, pu.pu_code)) continue;

      const t0 = Date.now();
      const status = await processOne(state, electionType, irevElectionId, pu);
      processed += 1;

      if (processed % 50 === 0) {
        progress.flush(state);
        const rate = processed / ((Date.now() - new Date(state.started_at).getTime()) / 1000);
        console.log(
          `[${electionId}] ${pu.state_code}/${pu.pu_code} → ${status}  ` +
            `(${processed} total, ${state.counts.ok} ok, ${state.counts.not_uploaded} missing, ` +
            `${state.counts.error} errors, ${rate.toFixed(2)}/s)`
        );
      }

      const elapsed = Date.now() - t0;
      if (elapsed < config.requestDelayMs) {
        await sleep(config.requestDelayMs - elapsed);
      }
    }
  }

  progress.flush(state);
  console.log('\nFinal counts:');
  console.log(state.counts);
  await closeDb();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main, processOne };
