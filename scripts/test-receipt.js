// Local test: parse receipt images through lib/receipt.js and print the proposed split.
const fs = require('fs');
const path = require('path');
const { parse } = require('../lib/receipt');

(async () => {
  for (const f of process.argv.slice(2)) {
    const b64 = fs.readFileSync(path.join(__dirname, '..', '..', f)).toString('base64');
    try {
      const r = await parse(b64, 'image/jpeg');
      const sum = (r.lines || []).reduce((a, l) => a + Number(l.amount || 0), 0);
      console.log('\n=== ' + f + ' ===');
      console.log(`${r.merchant} | ${r.date} | total $${r.total} | split:${r.needsSplit} | acct:${r.account || '(card)'} | conf:${r.confidence}`);
      if (r.handwriting) console.log('  handwriting: "' + r.handwriting + '"');
      (r.lines || []).forEach((l) => console.log(`   $${Number(l.amount).toFixed(2)}  ${l.category}/${l.subcategory}${l.flag ? '  ⚠️ ' + (l.note || '') : '  (' + (l.note || '') + ')'}`));
      console.log('  lines sum: $' + sum.toFixed(2) + (Math.abs(sum - r.total) < 0.02 ? ' ✓' : ' ✗ (≠ total)'));
    } catch (e) { console.log('\n=== ' + f + ' ===  ERROR: ' + e.message); }
  }
})();
