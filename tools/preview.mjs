// node tools/preview.mjs [--admin] [--port=N]
// --admin serves the writer app (repo root); default serves ./dist (same output that ships).
import path from 'node:path';
import { serve } from '../src/preview/server.js';
import { arg, ROOT, DIST } from './lib.mjs';

const admin = arg('admin');
const port = Number(arg('port', admin ? 8080 : 8081));
serve({ root: admin ? ROOT : DIST, port, spa: !!admin });
