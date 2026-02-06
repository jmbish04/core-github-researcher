import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { drizzle } from 'drizzle-orm/d1';
import { sessions, requestLogs } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// Session context key
const SESSION_ID_KEY = 'sessionId';

/**
 * Get the Drizzle ORM instance for the given D1 database
 */
export function getDb(db: D1Database) {
  return drizzle(db);
}

/**
 * Middleware to handle session management
 * Extracts session ID from headers/cookies or creates a new one
 */
export async function sessionMiddleware(c: Context, next: Next) {
  const db = getDb(c.env.DB);
  
  // Try to get session ID from header or cookie
  let sessionId = c.req.header('X-Session-ID') || getCookie(c, 'session_id');
  
  // If no session ID provided, create a new session
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    
    // Create new session in database
    await db.insert(sessions).values({
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    
    // Set cookie for future requests
    c.header('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`); // 30 days
  } else {
    // Verify session exists, create if not
    const existing = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    
    if (!existing) {
      await db.insert(sessions).values({
        id: sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  
  // Store session ID in context
  c.set(SESSION_ID_KEY, sessionId);
  
  // Add session ID to response header
  c.header('X-Session-ID', sessionId);
  
  await next();
}

/**
 * Middleware to log all requests to D1
 */
export async function requestLoggingMiddleware(c: Context, next: Next) {
  const sessionId = c.get(SESSION_ID_KEY) as string;
  const startTime = Date.now();
  
  await next();
  
  const db = getDb(c.env.DB);
  const duration = Date.now() - startTime;
  
  // Log request to database
  try {
    await db.insert(requestLogs).values({
      id: crypto.randomUUID(),
      sessionId,
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({
        duration,
        userAgent: c.req.header('User-Agent'),
      }),
    });
  } catch (error) {
    console.error('Failed to log request:', error);
  }
}

/**
 * Get the current session ID from context
 */
export function getSessionId(c: Context): string | undefined {
  return c.get(SESSION_ID_KEY);
}
