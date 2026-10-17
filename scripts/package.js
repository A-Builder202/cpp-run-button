'use strict';

// Builds cpp-run-button-<version>.vsix without any npm packages. A .vsix is a
// zip holding [Content_Types].xml, extension.vsixmanifest and the extension
// files under extension/, which is the layout `vsce package` produces.
//
// Usage: node scripts/package.js [output.vsix]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Files shipped in the package: [path in the repo, path inside extension/].
const FILES = [
  ['package.json', 'package.json'],
  ['extension.js', 'extension.js'],
  ['run-in-dir.js', 'run-in-dir.js'],
  ['cpptools.js', 'cpptools.js'],
  ['README.md', 'readme.md'],
  ['CHANGELOG.md', 'changelog.md'],
  ['LICENSE', 'LICENSE.txt'],
  ['images/icon.png', 'images/icon.png'],
].filter(([from]) => fs.existsSync(path.join(root, from)));

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[c]);
}

function manifest() {
  const repo = pkg.repository.url;
  const web = repo.replace(/\.git$/, '');
  const assets = [
    ['Microsoft.VisualStudio.Code.Manifest', 'extension/package.json'],
    ['Microsoft.VisualStudio.Services.Content.Details', 'extension/readme.md'],
    ['Microsoft.VisualStudio.Services.Content.Changelog', 'extension/changelog.md'],
    ['Microsoft.VisualStudio.Services.Content.License', 'extension/LICENSE.txt'],
  ];
  if (pkg.icon) {
    assets.push(['Microsoft.VisualStudio.Services.Icons.Default', `extension/${pkg.icon}`]);
  }
  const properties = [
    ['Microsoft.VisualStudio.Code.Engine', pkg.engines.vscode],
    ['Microsoft.VisualStudio.Code.ExtensionDependencies', ''],
    ['Microsoft.VisualStudio.Code.ExtensionPack', ''],
    ['Microsoft.VisualStudio.Code.ExtensionKind', 'workspace'],
    ['Microsoft.VisualStudio.Code.LocalizedLanguages', ''],
    ['Microsoft.VisualStudio.Services.Links.Source', repo],
    ['Microsoft.VisualStudio.Services.Links.Getstarted', repo],
    ['Microsoft.VisualStudio.Services.Links.GitHub', repo],
    ['Microsoft.VisualStudio.Services.Links.Support', pkg.bugs.url],
    ['Microsoft.VisualStudio.Services.Links.Learn', pkg.homepage || web],
    ['Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown', 'true'],
    ['Microsoft.VisualStudio.Services.Content.Pricing', 'Free'],
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(pkg.name)}" Version="${escapeXml(pkg.version)}" Publisher="${escapeXml(pkg.publisher)}" />
    <DisplayName>${escapeXml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description)}</Description>
    <Tags>${escapeXml(pkg.keywords.join(','))}</Tags>
    <Categories>${escapeXml(pkg.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
${properties.map(([id, v]) => `      <Property Id="${id}" Value="${escapeXml(v)}" />`).join('\n')}
    </Properties>
    <License>extension/LICENSE.txt</License>${pkg.icon ? `\n    <Icon>extension/${escapeXml(pkg.icon)}</Icon>` : ''}
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
${assets.map(([type, p]) => `    <Asset Type="${type}" Path="${p}" Addressable="true" />`).join('\n')}
  </Assets>
</PackageManifest>
`;
}

function contentTypes(names) {
  const types = {
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.vsixmanifest': 'text/xml',
  };
  const used = [...new Set(names.map((n) => path.extname(n)))].filter((e) => types[e]);
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
${used.map((e) => `  <Default Extension="${e}" ContentType="${types[e]}" />`).join('\n')}
</Types>
`;
}

// Minimal zip writer (deflate, no zip64). Timestamps are fixed at 1980-01-01
// so the same sources always produce the same file.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const DOS_DATE = (0 << 9) | (1 << 5) | 1;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// The editor shows the packaged readme without access to the repository, so
// relative links are pointed at GitHub, as `vsce package` does: images at the
// raw file, everything else at the file's page.
function absoluteLinks(markdown) {
  const web = pkg.repository.url.replace(/\.git$/, '');
  const raw = web.replace('https://github.com/', 'https://raw.githubusercontent.com/');
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (link, bang, text, target) => {
    if (/^([a-z]+:|#)/i.test(target)) return link;
    return `${bang}[${text}](${bang ? `${raw}/HEAD` : `${web}/blob/HEAD`}/${target})`;
  });
}

const files = FILES.map(([from, to]) => {
  let data = fs.readFileSync(path.join(root, from));
  if (from === 'README.md') data = Buffer.from(absoluteLinks(data.toString('utf8')));
  return { name: `extension/${to}`, data };
});
const entries = [
  { name: '[Content_Types].xml', data: Buffer.from(contentTypes(['x.vsixmanifest', ...files.map((f) => f.name)])) },
  { name: 'extension.vsixmanifest', data: Buffer.from(manifest()) },
  ...files,
];

const out = path.resolve(process.argv[2] || path.join(root, `${pkg.name}-${pkg.version}.vsix`));
fs.writeFileSync(out, zip(entries));
console.log(`${path.relative(process.cwd(), out) || out}: ${entries.map((e) => e.name).join(', ')}`);
