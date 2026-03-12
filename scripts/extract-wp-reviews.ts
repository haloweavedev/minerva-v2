/**
 * Extract 33 latest book-review posts from WordPress via SSH + WP-CLI.
 * Uses ONE SSH call for all reviews to eliminate per-connection overhead.
 *
 * Usage:
 *   SSH_PASS=... npx tsx scripts/extract-wp-reviews.ts
 *
 * Outputs: data/raw-reviews.json
 */

import { execSync } from 'child_process';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const SSH_HOST = process.env.SSH_HOST || 'u681690450@217.15.172.241';
const SSH_PORT = process.env.SSH_PORT || '65002';
const SSH_PASS = process.env.SSH_PASS || '';
const WP_PATH = process.env.WP_PATH || 'domains/allaboutromance.com/public_html';
const NUM_REVIEWS = 33;

interface RawReview {
  postId: number;
  title: string;
  authorName: string;
  grade: string | null;
  sensuality: string | null;
  bookTypes: string[];
  reviewTags: string[];
  publishDate: string | null;
  copyrightYear: string | null;
  publisher: string | null;
  pages: string | null;
  isbn: string | null;
  asin: string | null;
  amazonUrl: string | null;
  timeSetting: string | null;
  localeSetting: string | null;
  series: boolean;
  coverUrl: string | null;
  reviewUrl: string | null;
  postDate: string | null;
  content: string;
  coda: string | null;
}

function cleanHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, iframe, .ad, .advertisement, .wp-caption-text, noscript').remove();
  $('br').replaceWith('\n');
  $('p').each(function () { $(this).replaceWith($(this).text() + '\n\n'); });
  $('h1, h2, h3, h4, h5, h6').each(function () { $(this).replaceWith($(this).text() + '\n\n'); });
  $('li').each(function () { $(this).replaceWith('- ' + $(this).text() + '\n'); });
  $('blockquote').each(function () {
    const text = $(this).text().split('\n').map((l) => `> ${l}`).join('\n');
    $(this).replaceWith(text + '\n\n');
  });
  let text = $.text();
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function metaVal(meta: Record<string, unknown>[], key: string): string | null {
  const entry = meta.find((m) => m.meta_key === key);
  if (!entry) return null;
  const val = String(entry.meta_value ?? '').trim();
  return val || null;
}

function main() {
  const totalStart = performance.now();

  // Build a single remote script that extracts ALL reviews in one SSH session
  const remoteScript = `
cd ${WP_PATH}

IDS=$(wp post list --post_type=book-review --posts_per_page=${NUM_REVIEWS} --orderby=date --order=DESC --post_status=publish --format=ids --quiet 2>/dev/null)

for ID in $IDS; do
  POST=$(wp post get $ID --format=json --fields=ID,post_title,post_date,guid --quiet 2>/dev/null)
  CONTENT=$(wp post get $ID --field=post_content --quiet 2>/dev/null | base64 -w 0)
  META=$(wp post meta list $ID --format=json --quiet 2>/dev/null)
  BTYPES=$(wp post term list $ID book-type --format=json --fields=name --quiet 2>/dev/null || echo "[]")
  RTAGS=$(wp post term list $ID review-tag --format=json --fields=name --quiet 2>/dev/null || echo "[]")
  THUMB_ID=$(wp post meta get $ID _thumbnail_id --quiet 2>/dev/null || echo "")
  COVER=""
  if [ -n "$THUMB_ID" ]; then
    COVER=$(wp post get $THUMB_ID --field=guid --quiet 2>/dev/null || echo "")
  fi
  echo "===REVIEW_START==="
  echo '{"post":'"$POST"',"content_b64":"'"$CONTENT"'","meta":'"$META"',"book_types":'"$BTYPES"',"review_tags":'"$RTAGS"',"cover_url":"'"$COVER"'"}'
  echo "===REVIEW_END==="
done
`;

  console.log(`[Extract] Connecting to ${SSH_HOST} — extracting ${NUM_REVIEWS} reviews in a single SSH session...`);

  const sshPrefix = SSH_PASS
    ? `sshpass -p '${SSH_PASS}' ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no ${SSH_HOST}`
    : `ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no ${SSH_HOST}`;

  const cmd = `${sshPrefix} bash -s <<'REMOTECMD'\n${remoteScript}\nREMOTECMD`;
  const output = execSync(cmd, { encoding: 'utf-8', timeout: 600_000, shell: '/bin/bash', maxBuffer: 50 * 1024 * 1024 });

  const sshDone = performance.now();
  console.log(`[Extract] SSH session complete in ${((sshDone - totalStart) / 1000).toFixed(1)}s — parsing results...\n`);

  // Parse each review block
  const blocks = output.split('===REVIEW_START===').slice(1);
  const reviews: RawReview[] = [];

  for (const block of blocks) {
    const jsonStr = block.split('===REVIEW_END===')[0]?.trim();
    if (!jsonStr) continue;

    try {
      const data = JSON.parse(jsonStr);
      const post = data.post;
      const meta: Record<string, unknown>[] = Array.isArray(data.meta) ? data.meta : [];

      const rawContent = Buffer.from(data.content_b64 || '', 'base64').toString('utf-8');
      const content = cleanHtml(rawContent);

      const bookTypes: string[] = Array.isArray(data.book_types)
        ? data.book_types.map((t: { name: string }) => t.name) : [];
      const reviewTags: string[] = Array.isArray(data.review_tags)
        ? data.review_tags.map((t: { name: string }) => t.name) : [];

      const authorFirst = metaVal(meta, 'wpcf-author_first_name') || '';
      const authorLast = metaVal(meta, 'wpcf-author_last_name') || '';
      const authorName = `${authorFirst} ${authorLast}`.trim() || metaVal(meta, 'wpcf-title') || 'Unknown Author';

      const review: RawReview = {
        postId: post.ID,
        title: metaVal(meta, 'wpcf-title') || post.post_title,
        authorName,
        grade: metaVal(meta, 'wpcf-book-grade'),
        sensuality: metaVal(meta, 'wpcf-book-sensuality'),
        bookTypes,
        reviewTags,
        publishDate: metaVal(meta, 'wpcf-bookpublish_date'),
        copyrightYear: metaVal(meta, 'wpcf-copyright-year'),
        publisher: metaVal(meta, 'wpcf-publisher'),
        pages: metaVal(meta, 'wpcf-pages'),
        isbn: metaVal(meta, 'wpcf-isbn'),
        asin: metaVal(meta, 'wpcf-amazon-asin'),
        amazonUrl: metaVal(meta, 'wpcf-amazon-url'),
        timeSetting: metaVal(meta, 'wpcf-time_setting'),
        localeSetting: metaVal(meta, 'wpcf-lacale_setting'),
        series: metaVal(meta, 'wpcf-series1') === 'Yes',
        coverUrl: data.cover_url || null,
        reviewUrl: post.guid || null,
        postDate: post.post_date,
        content,
        coda: metaVal(meta, 'wpcf-coda'),
      };

      reviews.push(review);
      console.log(`  [${reviews.length}] "${review.title}" by ${review.authorName} — ${content.length} chars, grade: ${review.grade || 'N/A'}`);
    } catch (err) {
      console.error(`  [!] Failed to parse a review block:`, err instanceof Error ? err.message : err);
    }
  }

  // Write output
  const outDir = path.join(process.cwd(), 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'raw-reviews.json');
  writeFileSync(outPath, JSON.stringify(reviews, null, 2));

  const totalMs = performance.now() - totalStart;
  const perRecord = reviews.length > 0 ? totalMs / reviews.length : 0;

  console.log('\n========== EXTRACTION REPORT ==========');
  console.log(`Records extracted: ${reviews.length}/${blocks.length}`);
  console.log(`SSH session: ${((sshDone - totalStart) / 1000).toFixed(1)}s`);
  console.log(`Total time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Per-record average: ${(perRecord / 1000).toFixed(2)}s`);
  console.log(`Projected 18,645 records: ${((perRecord * 18645) / 60000).toFixed(1)} minutes`);
  console.log(`Output: ${outPath}`);
  console.log('========================================');
}

main();
