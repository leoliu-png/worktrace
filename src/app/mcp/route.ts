import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createDatabase } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/request-auth';
import { createWorkTraceMcpServer } from '@/lib/worktrace-mcp';

export const runtime = 'nodejs';

async function handle(request: Request) {
  const database = createDatabase();
  const user = authenticateApiRequest(request.headers.get('authorization'), database);
  if (!user) { database.close(); return Response.json({ code: 'UNAUTHORIZED', message: 'A valid API key is required.' }, { status: 401 }); }
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createWorkTraceMcpServer(database, user);
  await server.connect(transport);
  try { return await transport.handleRequest(request); } finally { await server.close(); database.close(); }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
