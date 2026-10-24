// 离线测试共用：先确认整段端口可监听，再关闭临时监听并开始测试；随机选段本身不能避免 EADDRINUSE。
import net from "node:net";

export async function freePortBlock(count = 3, step = 1) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = 20000 + Math.floor(Math.random() * 20000);
    const servers = [];
    let available = true;
    for (let i = 0; i < count; i++) {
      const server = net.createServer();
      const ok = await new Promise((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(base + i * step, "127.0.0.1", () => resolve(true));
      });
      if (!ok) { available = false; break; }
      servers.push(server);
    }
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    if (available) return base;
  }
  throw new Error(`no free test port block (${count} ports, step ${step})`);
}
