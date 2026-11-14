import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const appDir = join(import.meta.dirname, 'app');
const types: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css',
};

export function serveStatic(
	dir: string,
	port: number,
): Promise<{ url: string; close(): Promise<void> }> {
	const server = createServer(async (req, res) => {
		const path = new URL(req.url ?? '/', 'http://x').pathname;
		const file = normalize(join(dir, path.endsWith('/') ? `${path}index.html` : path));
		try {
			if (!file.startsWith(dir)) throw new Error('outside dir');
			const body = await readFile(file);
			res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
			res.end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
	return new Promise((resolve, reject) =>
		server.listen(port, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				reject(new Error('server is not listening on a port'));
				return;
			}
			resolve({
				url: `http://127.0.0.1:${address.port}`,
				close: () =>
					new Promise<void>((done) => {
						server.close(() => done());
						server.closeAllConnections();
					}),
			});
		}),
	);
}

if (import.meta.main) {
	const { url } = await serveStatic(appDir, Number(process.argv[2] ?? 0));
	console.log(url);
}
