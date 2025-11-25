/**
 * Connection Context for storing orgId per SSE connection
 * 
 * Since MCP tool handlers don't have access to the HTTP request,
 * we store the orgId when the SSE connection is established and
 * retrieve it during tool execution.
 */

// Map of transport/connection ID to orgId
const connectionOrgMap = new Map<string, string>();

/**
 * Store orgId for a connection
 */
export function setConnectionOrg(connectionId: string, orgId: string): void {
  connectionOrgMap.set(connectionId, orgId);
}

/**
 * Get orgId for a connection
 */
export function getConnectionOrg(connectionId: string): string | undefined {
  return connectionOrgMap.get(connectionId);
}

/**
 * Remove orgId when connection closes
 */
export function removeConnectionOrg(connectionId: string): void {
  connectionOrgMap.delete(connectionId);
}

/**
 * Generate a connection ID from request
 */
export function getConnectionId(request: { ip?: string; headers: Record<string, unknown> }): string {
  // Use a combination of IP and user-agent for uniqueness
  const ip = request.ip || 'unknown';
  const ua = (request.headers['user-agent'] as string) || 'unknown';
  return `${ip}:${ua}`;
}


