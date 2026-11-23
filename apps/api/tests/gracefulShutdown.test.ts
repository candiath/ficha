import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown } from '../src/lib/gracefulShutdown';

const quietLog = { log: () => {}, error: () => {} };
let servers: Server[] = [];

afterEach(() => {
  for (const s of servers) s.closeAllConnections();
  servers = [];
});

// A server whose /slow answers only when `release` is called.
async function startServer() {
  let release = () => {};
  const server = createServer((req, res) => {
    if (req.url === '/slow') {
      release = () => res.end('done');
      return;
    }
    res.end('ok');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, release: () => release() };
}

function get(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('installGracefulShutdown', () => {
  it('lets a request in flight finish, refuses new connections, then exits 0', async () => {
    const { server, port, release } = await startServer();
    const exit = vi.fn();
    const { shutdown } = installGracefulShutdown(server, { exit, log: quietLog, signals: [] });

    // Node 22's default agent keeps the connection alive after the response:
    // the case that once held the shutdown until its timeout.
    const inFlight = get(port, '/slow');
    await new Promise((r) => setTimeout(r, 50)); // the request reaches the handler

    shutdown('SIGTERM');
    await expect(get(port, '/')).rejects.toThrow(); // no new connections
    expect(exit).not.toHaveBeenCalled();

    release();
    await expect(inFlight).resolves.toBe('done');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    // Well before the 25 s timeout, which never fires afterwards.
    await new Promise((r) => setTimeout(r, 300));
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 when requests are still open after the timeout', async () => {
    const { server, port } = await startServer();
    const exit = vi.fn();
    const { shutdown } = installGracefulShutdown(server, {
      exit,
      log: quietLog,
      signals: [],
      timeoutMs: 100,
    });

    void get(port, '/slow').catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    shutdown('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('exits 1 at once on a second signal', async () => {
    const { server, port } = await startServer();
    const exit = vi.fn();
    const { shutdown } = installGracefulShutdown(server, { exit, log: quietLog, signals: [] });

    void get(port, '/slow').catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    shutdown('SIGINT');
    expect(exit).not.toHaveBeenCalled();
    shutdown('SIGINT');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('starts on the signals it is given', async () => {
    const { server } = await startServer();
    const exit = vi.fn();
    const { dispose } = installGracefulShutdown(server, { exit, log: quietLog, signals: ['SIGUSR2'] });
    try {
      process.emit('SIGUSR2', 'SIGUSR2');
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(server.listening).toBe(false);
    } finally {
      dispose();
    }
    expect(process.listenerCount('SIGUSR2')).toBe(0);
  });
});
