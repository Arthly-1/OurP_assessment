import sharp from 'sharp';
import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // libvips keeps its own operation cache; bound it so memory stays predictable.
  sharp.cache({ memory: 64, files: 0, items: 50 });

  const app = await buildApp(config);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.server.host, port: config.server.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
