import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({
  logger: true
});

// Enable CORS for frontend requests
await fastify.register(cors, {
  origin: true // Allow all origins in dev mode
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', mode: 'local' };
});

// Stub for Claude subscription API (M3/M4/M5)
fastify.post('/claude', async (request, reply) => {
  return reply.status(501).send({ error: 'Claude subscription integration not implemented yet.' });
});

// Stub for YouTube transcript download (M3)
fastify.get('/transcript', async (request, reply) => {
  return reply.status(501).send({ error: 'Transcript downloader not implemented yet.' });
});

const start = async () => {
  try {
    // Listen on localhost, port 8787 as specified in the prompt
    await fastify.listen({ port: 8787, host: '127.0.0.1' });
    console.log('Backend Fastify server is running on http://127.0.0.1:8787');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
