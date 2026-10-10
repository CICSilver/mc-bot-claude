import { createServer } from 'node:net';
export async function assertPortsFree(ports) {
  const held = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => { server.once('error', () => reject(new Error(`端口 ${port} 已占用，请先关闭另一版测试机器人；不会关闭已有进程。`))); server.listen(port, '127.0.0.1', resolve); });
      held.push(server);
    }
  } finally { await Promise.all(held.map(server => new Promise(resolve => server.close(resolve)))); }
}
