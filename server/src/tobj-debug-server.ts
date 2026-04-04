import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import TOBJ from './TOBJ';
import { decodeCodeInstructionsForTobj } from './tobj-debug/decodeCodeInstructions';
import { serializeTobjForDebug } from './tobj-debug/serializeTobjForDebug';

const PORT = Number(process.env.TOBJ_DEBUG_PORT || 8765);
const htmlPath = path.join(__dirname, '..', 'tobj-debug', 'index.html');

const server = http.createServer((req, res) => {
    const url = req.url?.split('?')[0] || '/';

    if (req.method === 'GET' && url === '/') {
        let html: string;
        try {
            html = fs.readFileSync(htmlPath, 'utf8');
        } catch {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Missing UI file: ${htmlPath}`);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    if (req.method === 'POST' && url === '/parse') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            try {
                const buf = Buffer.concat(chunks);
                const tobj = new TOBJ(buf);
                const json = serializeTobjForDebug(tobj) as Record<string, unknown>;
                json.codeInstructions = decodeCodeInstructionsForTobj(tobj);
                const body = JSON.stringify(json, null, 2);

                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf8'),
                });
                res.end(body);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const body = JSON.stringify({ error: msg }, null, 2);
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(body);
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`TOBJ debug UI: http://127.0.0.1:${PORT}/`);
});
