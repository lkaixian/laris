// Usage: node pglite_server.mjs <port>. In-memory Postgres (PGlite) over the wire protocol, for pytest.
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
const db = new PGlite();
await db.waitReady;
const s = new PGLiteSocketServer({db, port: Number(process.argv[2]), host: '127.0.0.1', maxConnections: 20});
await s.start();
console.log('READY');
