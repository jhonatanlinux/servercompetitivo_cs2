const fs = require('fs');
const path = require('path');

function createAuditLogger(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function append(action, payload = {}) {
    const entry = {
      ts: new Date().toISOString(),
      action,
      ...payload,
    };
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  function read(limit = 200) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.slice(-limit).map((line) => {
        try { return JSON.parse(line); } catch { return { ts: null, action: 'corrupt', raw: line }; }
      }).reverse();
    } catch {
      return [];
    }
  }

  return { append, read };
}

module.exports = { createAuditLogger };
