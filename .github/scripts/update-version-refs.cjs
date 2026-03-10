const fs = require('fs');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node update-version-refs.cjs <version>');
  process.exit(1);
}

// Update package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// Update version references in docs
for (const file of ['docs/getting-started.md']) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(
    /@bouncesecurity\/aghast@[0-9]+\.[0-9]+\.[0-9]+/g,
    '@bouncesecurity/aghast@' + version
  );
  fs.writeFileSync(file, content);
}
