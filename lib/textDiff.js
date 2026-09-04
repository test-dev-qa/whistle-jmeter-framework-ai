'use strict';

function diffTextLines(oldText, newText) {
  const aLines = String(oldText == null ? '' : oldText).split(/\r?\n/);
  const bLines = String(newText == null ? '' : newText).split(/\r?\n/);
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (aLines[i - 1] === bLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lines = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      lines.unshift({ op: 'eq', text: aLines[i - 1], oldLine: i, newLine: j });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.unshift({ op: 'add', text: bLines[j - 1], newLine: j });
      j -= 1;
    } else {
      lines.unshift({ op: 'del', text: aLines[i - 1], oldLine: i });
      i -= 1;
    }
  }
  const stats = { added: 0, removed: 0, unchanged: 0 };
  lines.forEach((line) => {
    if (line.op === 'add') stats.added += 1;
    else if (line.op === 'del') stats.removed += 1;
    else stats.unchanged += 1;
  });
  return { lines, stats };
}

module.exports = {
  diffTextLines
};
