<?php
declare(strict_types=1);

header_remove('X-Powered-By');

// Habit Garden: delivers the static app shell. Sets security headers and the build
// stamp; no further server logic, no database, no sessions.

$stampFile = __DIR__ . '/app/build.txt';
$build = is_file($stampFile) ? trim((string) file_get_contents($stampFile)) : '';
if (!preg_match('/^[0-9a-f]{8}$/', $build)) {
    $build = 'dev';
}
$v = '?v=' . $build;

// The import map is the only inline <script>. It carries no executable code;
// its exact bytes are allowed through a sha256 hash in script-src.
$importMap = json_encode(['imports' => [
    'dexie' => '/vendor/dexie.mjs' . $v,
    'markdown-it' => '/vendor/markdown-it.mjs' . $v,
    'dompurify' => '/vendor/purify.mjs' . $v,
]], JSON_UNESCAPED_SLASHES);
$mapHash = base64_encode(hash('sha256', $importMap, true));

header("Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-{$mapHash}'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'");
header('Strict-Transport-Security: max-age=31536000');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header('Cache-Control: no-cache');
header('Content-Type: text/html; charset=utf-8');
?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="olife-build" content="<?= $build ?>">
<meta name="olife-base" content="/">
<title>Habit Garden</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/styles/tokens.css<?= $v ?>">
<link rel="stylesheet" href="/styles/base.css<?= $v ?>">
<link rel="stylesheet" href="/styles/components.css<?= $v ?>">
<link rel="stylesheet" href="/styles/screens.css<?= $v ?>">
<script type="importmap"><?= $importMap ?></script>
<script type="module" src="/app/main.js<?= $v ?>"></script>
</head>
<body>
<div id="app"></div>
<noscript>Habit Garden benötigt JavaScript; bitte aktiviere es in diesem Browser.</noscript>
</body>
</html>
