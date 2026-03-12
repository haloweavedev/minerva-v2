<?php
/**
 * Drop this into the WordPress root and hit it once:
 *   php export-reviews.php
 *
 * Outputs: export-reviews.json (33 latest published book-review posts)
 */

// Bootstrap WordPress
define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-load.php';

$NUM = 33;

$posts = get_posts([
    'post_type'      => 'book-review',
    'post_status'    => 'publish',
    'posts_per_page' => $NUM,
    'orderby'        => 'date',
    'order'          => 'DESC',
]);

$reviews = [];

foreach ($posts as $p) {
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
    ];
}

$outPath = __DIR__ . '/export-reviews.json';
file_put_contents($outPath, json_encode($reviews, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

echo "Exported " . count($reviews) . " reviews to $outPath\n";
