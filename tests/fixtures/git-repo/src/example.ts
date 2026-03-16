// Sample source file for testing code snippet extraction
export function getUser(id: string) {
  // Line 3
  const query = `SELECT * FROM users WHERE id = '${id}'`; // Line 4 - SQL injection
  return db.execute(query); // Line 5
}

export function deleteUser(id: string) {
  // Line 9
  return db.execute('DELETE FROM users WHERE id = ?', [id]); // Line 10 - Safe
}
