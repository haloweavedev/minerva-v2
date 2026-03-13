/**
 * Bulk extract all ~19k book-review posts from WordPress via SSH.
 * SCPs the batch PHP script to the server, then loops in batches of 500.
 *
 * Usage:
 *   SSH_PASS=... npx tsx scripts/extract-all-reviews.ts
 *
 * Outputs: data/reviews-batch-001.json through data/reviews-batch-NNN.json
 *
 * Re-run safe: skips batches where the file already exists.
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const SSH_HOST = process.env.SSH_HOST || 'u681690450@217.15.172.241';
const SSH_PORT = process.env.SSH_PORT || '65002';
const SSH_PASS = process.env.SSH_PASS || '';
const WP_PATH = process.env.WP_PATH || 'domains/allaboutromance.com/public_html';
const BATCH_SIZE = 500;
const REMOTE_SCRIPT = 'export-reviews-batch.php';

const MAX_BUFFER = 100 * 1024 * 1024; // 100MB
const TIMEOUT = 5 * 60 * 1000; // 5 minutes per batch

function sshCmd(command: string): string {
  const prefix = SSH_PASS
    ? `sshpass -p '${SSH_PASS}' ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no ${SSH_HOST}`
    : `ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no ${SSH_HOST}`;
  return `${prefix} "${command}"`;
}

function scpToRemote(localPath: string, remotePath: string): string {
  const prefix = SSH_PASS
    ? `sshpass -p '${SSH_PASS}' scp -P ${SSH_PORT} -o StrictHostKeyChecking=no`
    : `scp -P ${SSH_PORT} -o StrictHostKeyChecking=no`;
  return `${prefix} ${localPath} ${SSH_HOST}:${remotePath}`;
}

function run(cmd: string, timeout = TIMEOUT): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    timeout,
    shell: '/bin/bash',
    maxBuffer: MAX_BUFFER,
  });
}

function padBatchNum(n: number): string {
  return String(n).padStart(3, '0');
}

function formatTime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs % 60}s`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function main() {
  if (!SSH_PASS) {
    console.error('Set SSH_PASS env var');
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), 'data');
  mkdirSync(outDir, { recursive: true });

  const localScript = path.join(process.cwd(), 'scripts', REMOTE_SCRIPT);
  const remotePath = `${WP_PATH}/${REMOTE_SCRIPT}`;

  // Step 1: SCP the batch script to the server
  console.log(`[Upload] Copying ${REMOTE_SCRIPT} to server...`);
  run(scpToRemote(localScript, remotePath), 30_000);
  console.log('[Upload] Done.\n');

  // Step 2: Get total count
  console.log('[Count] Querying total published book-reviews...');
  const countOutput = run(sshCmd(`cd ${WP_PATH} && php ${REMOTE_SCRIPT} --count`), 60_000);
  const totalCount = JSON.parse(countOutput.trim()).count as number;
  console.log(`[Count] Total: ${totalCount} reviews\n`);

  const totalBatches = Math.ceil(totalCount / BATCH_SIZE);
  const totalStart = performance.now();
  let totalExtracted = 0;
  let failedBatches: number[] = [];

  // Step 3: Loop through batches
  for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
    const offset = (batchNum - 1) * BATCH_SIZE;
    const batchFile = path.join(outDir, `reviews-batch-${padBatchNum(batchNum)}.json`);

    // Resume: skip existing files
    if (existsSync(batchFile)) {
      console.log(`[Batch ${batchNum}/${totalBatches}] SKIP — ${path.basename(batchFile)} already exists`);
      // Count records in existing file for progress tracking
      try {
        const existing = JSON.parse(require('fs').readFileSync(batchFile, 'utf-8'));
        totalExtracted += Array.isArray(existing) ? existing.length : 0;
      } catch {
        // Can't read existing file, just skip counting
      }
      continue;
    }

    const batchStart = performance.now();
    const expectedRecords = Math.min(BATCH_SIZE, totalCount - offset);

    console.log(`[Batch ${batchNum}/${totalBatches}] Extracting offset=${offset} limit=${BATCH_SIZE} (expecting ~${expectedRecords} records)...`);

    try {
      const output = run(
        sshCmd(`cd ${WP_PATH} && php ${REMOTE_SCRIPT} --offset=${offset} --limit=${BATCH_SIZE}`)
      );

      // Parse and validate
      const reviews = JSON.parse(output.trim());
      if (!Array.isArray(reviews)) {
        throw new Error(`Expected array, got ${typeof reviews}`);
      }

      // Write batch file
      writeFileSync(batchFile, JSON.stringify(reviews, null, 2));
      totalExtracted += reviews.length;

      const batchMs = performance.now() - batchStart;
      const elapsedMs = performance.now() - totalStart;
      const avgBatchMs = elapsedMs / batchNum;
      const remainingBatches = totalBatches - batchNum;
      const etaMs = avgBatchMs * remainingBatches;

      console.log(
        `  ✓ ${reviews.length} reviews saved to ${path.basename(batchFile)} ` +
        `(${(batchMs / 1000).toFixed(1)}s) — ` +
        `${totalExtracted}/${totalCount} total — ` +
        `ETA: ${formatTime(etaMs)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED: ${msg}`);
      failedBatches.push(batchNum);
    }
  }

  // Step 4: Cleanup remote script
  console.log('\n[Cleanup] Removing remote script...');
  try {
    run(sshCmd(`rm -f ${remotePath}`), 30_000);
    console.log('[Cleanup] Done.');
  } catch {
    console.warn('[Cleanup] Failed to remove remote script — remove manually if needed.');
  }

  // Final report
  const totalMs = performance.now() - totalStart;
  console.log('\n========== EXTRACTION REPORT ==========');
  console.log(`Total reviews: ${totalCount}`);
  console.log(`Extracted: ${totalExtracted}`);
  console.log(`Batches: ${totalBatches} (${BATCH_SIZE}/batch)`);
  console.log(`Failed batches: ${failedBatches.length > 0 ? failedBatches.join(', ') : 'none'}`);
  console.log(`Total time: ${formatTime(totalMs)}`);
  console.log(`Output directory: ${outDir}`);
  console.log('========================================');

  if (failedBatches.length > 0) {
    console.log(`\nRe-run to retry failed batches: ${failedBatches.map(n => `batch ${n}`).join(', ')}`);
  }
}

main();
