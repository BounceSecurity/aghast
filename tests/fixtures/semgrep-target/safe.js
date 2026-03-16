// Safe code that should NOT match the sql-concat rule.

export function buildGetUserById(id) {
  const sql = 'SELECT u.id, u.name FROM users u WHERE u.id = ?';
  return { sql, params: [id] };
}
