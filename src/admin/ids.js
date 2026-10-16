// A UUID as Postgres writes it. Every id the console reads from a server answer or a URL is checked against this before
// it is used (sent back to the database, or put in a link), never trusted for being a string.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
