const { Rcon } = require('rcon-client');

let client = null;

async function connect(host, port, password) {
  try {
    if (client) { try { await client.end(); } catch {} }
    client = new Rcon({ host, port: parseInt(port), password, timeout: 5000 });
    await client.connect();
    return { ok: true };
  } catch (err) {
    client = null;
    return { ok: false, error: err.message };
  }
}

async function send(cmd) {
  if (!client) return { ok: false, error: 'RCON nao conectado' };
  try {
    const response = await client.send(cmd);
    return { ok: true, response };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function disconnect() {
  if (client) { try { await client.end(); } catch {} client = null; }
}

function connected() { return client !== null; }

module.exports = { connect, send, disconnect, connected };
