/** Surface validation messages, never SQL or connection details. */
export function adminError(error: unknown): Response {
  const e = error as { code?: string; message?: string };
  if (e.code === 'P0001') return Response.json({ error: e.message }, { status: 409 });
  if (['22P02', '22003', '22007', '23502', '23503', '23505', '22023'].includes(e.code ?? '')) {
    return Response.json({ error: 'Invalid values or a conflicting update. Reload and check the form.' }, { status: 400 });
  }
  console.error('Commissioner operation failed', e.code ?? 'unknown');
  return Response.json({ error: 'Could not save the change. Try again.' }, { status: 500 });
}
export function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
