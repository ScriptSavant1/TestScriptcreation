// Copy a generated script and put a real throwaway test key + certificate where the sample has placeholders;
// a proxy the sample names (proxy.example.com) is cleared so the runner can point the script at the test proxy.
//   node withkeys.js <srcDir> <dstDir>
'use strict';
const fs = require('fs'), path = require('path');
const [SRC, DST] = process.argv.slice(2);
const K = path.join(__dirname, 'keys');
const key = fs.readFileSync(path.join(K, 'key.pem'), 'utf8').trim();
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });
const PH = /-----BEGIN (?:RSA )?PRIVATE KEY-----(\\n|\r?\n)( *)(?:\.\.\.|YOUR_PRIVATE_KEY)(?:\\n|\r?\n)\s*-----END (?:RSA )?PRIVATE KEY-----/g;
for (const f of fs.readdirSync(SRC)) {
  const p = path.join(SRC, f);
  if (!fs.statSync(p).isFile()) continue;
  if (f === 'transport.pem') { fs.copyFileSync(path.join(K, 'transport.pem'), path.join(DST, f)); continue; }
  let t = fs.readFileSync(p);
  if (/\.(yml|cfg|prm|dat|js|c|json)$/i.test(f)) {
    let s = t.toString('utf8');
    s = s.replace(PH, (m, nl, ind) => {
      const lines = key.split(/\r?\n/);
      if (nl === '\\n') return lines.join('\\n');               // escaped (one-line value)
      return lines.map((l, i) => (i ? ind : '') + l).join(nl);  // block value, same indentation
    });
    if (f === 'rts.yml') {
      s = s.replace(/(\nproxy:\n(?:  .*\n)*)/, (blk) => blk
        .replace(/useProxy: true/, 'useProxy: false')
        .replace(/proxyServer: '[^']*'/, "proxyServer: ''")
        .replace(/proxyUser: '[^']*'/, "proxyUser: ''")
        .replace(/proxyPassword: '[^']*'/, "proxyPassword: ''")
        .replace(/proxyAuthenticationType: '[^']*'/, "proxyAuthenticationType: ''"));
    }
    t = Buffer.from(s, 'utf8');
  }
  fs.writeFileSync(path.join(DST, f), t);
}
console.log('ok ' + DST);
