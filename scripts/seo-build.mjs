import { readdir, readFile, writeFile, rm } from 'node:fs/promises';

const context = process.env.CONTEXT || 'production';
if (context !== 'production') {
  for (const entry of await readdir(process.cwd(), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html')) continue;
    let html = await readFile(entry.name, 'utf8');
    const tag = '<meta name="robots" content="noindex,nofollow">';
    if (/<meta\s+name=["']robots["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta\s+name=["']robots["'][^>]*>/i, tag);
    } else if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, '  ' + tag + '\n</head>');
    } else {
      html = html.replace(/(<meta\s+charset=["'][^"']+["']\s*\/?>)/i, '$1' + tag);
    }
    await writeFile(entry.name, html);
  }
  await writeFile('robots.txt', 'User-agent: *\nDisallow: /\n');
}
await rm('scripts/seo-build.mjs', { force: true });
