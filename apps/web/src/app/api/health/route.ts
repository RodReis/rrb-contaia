import { health } from '@contaia/shared';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(health('web'));
}
