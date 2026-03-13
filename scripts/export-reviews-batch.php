<?php
/**
 * Batched export of book-review posts with comments.
 * Drop into WordPress root and run via CLI:
 *
 *   php export-reviews-batch.php --count              # total published book-reviews
 *   php export-reviews-batch.php --offset=0 --limit=500  # export a batch
 *
 * Outputs JSON to stdout.
 */

// Bootstrap WordPress
define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-load.php';

$opts = getopt('', ['count', 'offset:', 'limit:']);

// --count mode: just return total and exit
if (isset($opts['count'])) {
    $query = new WP_Query([
        'post_type'      => 'book-review',
        'post_status'    => 'publish',
        'posts_per_page' => 1,
    ]);
    echo json_encode(['count' => (int) $query->found_posts]);
    exit(0);
}

$offset = isset($opts['offset']) ? (int) $opts['offset'] : 0;
$limit  = isset($opts['limit'])  ? (int) $opts['limit']  : 500;

$query = new WP_Query([
    'post_type'      => 'book-review',
    'post_status'    => 'publish',
    'posts_per_page' => $limit,
    'offset'         => $offset,
    'orderby'        => 'date',
    'order'          => 'DESC',
]);

$posts = $query->posts;
$reviews = [];

foreach ($posts as $index => $p) {
    $id   = $p->ID;
    $meta = get_post_meta($id);

    // Taxonomy terms
    $bookTypes  = wp_get_post_terms($id, 'book-type',  ['fields' => 'names']);
    $reviewTags = wp_get_post_terms($id, 'review-tag', ['fields' => 'names']);
    if (is_wp_error($bookTypes))  $bookTypes  = [];
    if (is_wp_error($reviewTags)) $reviewTags = [];

    // Featured image
    $thumbId  = get_post_thumbnail_id($id);
    $coverUrl = $thumbId ? wp_get_attachment_url($thumbId) : null;

    // Author name from custom fields
    $first = trim($meta['wpcf-author_first_name'][0] ?? '');
    $last  = trim($meta['wpcf-author_last_name'][0] ?? '');
    $authorName = trim("$first $last");
    if (!$authorName) {
        $authorName = trim($meta['wpcf-title'][0] ?? 'Unknown Author');
    }

    // Approved comments
    $wpComments = get_comments([
        'post_id' => $id,
        'status'  => 'approve',
        'orderby' => 'comment_date',
        'order'   => 'ASC',
    ]);
    $comments = [];
    foreach ($wpComments as $c) {
        $comments[] = [
            'author'  => $c->comment_author,
            'content' => $c->comment_content,
            'date'    => $c->comment_date,
        ];
    }

    $reviews[] = [
        'postId'        => $id,
        'title'         => trim($meta['wpcf-title'][0] ?? $p->post_title),
        'authorName'    => $authorName,
        'grade'         => $meta['wpcf-book-grade'][0]      ?? null,
        'sensuality'    => $meta['wpcf-book-sensuality'][0]  ?? null,
        'bookTypes'     => $bookTypes,
        'reviewTags'    => $reviewTags,
        'publishDate'   => $meta['wpcf-bookpublish_date'][0] ?? null,
        'copyrightYear' => $meta['wpcf-copyright-year'][0]   ?? null,
        'publisher'     => $meta['wpcf-publisher'][0]         ?? null,
        'pages'         => $meta['wpcf-pages'][0]             ?? null,
        'isbn'          => $meta['wpcf-isbn'][0]              ?? null,
        'asin'          => $meta['wpcf-amazon-asin'][0]       ?? null,
        'amazonUrl'     => $meta['wpcf-amazon-url'][0]        ?? null,
        'timeSetting'   => $meta['wpcf-time_setting'][0]      ?? null,
        'localeSetting' => $meta['wpcf-lacale_setting'][0]    ?? null,
        'series'        => ($meta['wpcf-series1'][0] ?? '') === 'Yes',
        'coverUrl'      => $coverUrl,
        'reviewUrl'     => get_permalink($id),
        'postDate'      => $p->post_date,
        'contentHtml'   => $p->post_content,
        'coda'          => $meta['wpcf-coda'][0]              ?? null,
        'comments'      => $comments,
    ];

    // Flush object cache every 100 posts to prevent memory bloat
    if (($index + 1) % 100 === 0) {
        wp_cache_flush();
    }
}

echo json_encode($reviews, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
