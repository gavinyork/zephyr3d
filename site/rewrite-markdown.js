const fs = require('fs');
const path = require('path');

const markdownDir = path.join(__dirname, 'dist', 'web', 'doc', 'markdown');
const r = /(\[[^\]]+\])\(([^\)]+\.md)\)/g;
fs.readdirSync(markdownDir).forEach((file) => {
  const fullpath = path.join(markdownDir, file);
  if (fullpath.endsWith('.md') && fs.statSync(fullpath).isFile()) {
    const content = fs.readFileSync(fullpath, { encoding: 'utf-8' });
    const newcontent = content.replaceAll(r, '$1(doc/markdown/$2');
    if (newcontent !== content) {
      fs.writeFileSync(fullpath, newcontent, { encoding: 'utf-8' });
    }
  }
});
