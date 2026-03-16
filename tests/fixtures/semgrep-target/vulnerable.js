// Minimal fixture for Semgrep integration tests.
// Contains patterns that match the sql-concat.yaml rule (WHERE.*\$\{).

const USER_FIELDS = 'u.id, u.name, u.email';
const FROM_USERS = 'FROM users u';

export function buildGetUserById(id) {
  const sql = `SELECT ${USER_FIELDS} ${FROM_USERS} WHERE u.id = ${id}`;
  return { sql };
}

export function buildSearchUsers(name) {
  const sql = `SELECT ${USER_FIELDS} ${FROM_USERS} WHERE u.name = ${name}`;
  return { sql };
}
