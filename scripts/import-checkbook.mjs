import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const HEADER = ['Date', 'Debit', 'Credit', 'ID', 'Description', 'Reconciled', 'Notes', 'Category', 'Working Balance', 'Reconciled Balance'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20000;
export class ImportError extends Error {}
const fail = (message) => { throw new ImportError(message); };

// Strict RFC-style CSV scanner: quoted separators/newlines and escaped quotes.
export function parseCsv(input) {
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) fail('CSV exceeds 10 MiB.');
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const endField = () => { row.push(field); field = ''; closed = false; };
  const endRow = () => {
    endField();
    if (row.some(value => value.trim() !== '')) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) fail('CSV exceeds 20,000 transactions.');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') endField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (closed) fail(`CSV record ${rows.length + 1}: unexpected text after closing quote.`);
    else if (char === '"') {
      if (field.length) fail(`CSV record ${rows.length + 1}: unexpected quote.`);
      quoted = true;
    } else field += char;
  }
  if (quoted) fail('CSV has an unterminated quoted field.');
  if (field.length || row.length || closed) endRow();
  return rows;
}

function dateValue(value, yearBase, record) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) fail(`Record ${record}: Date must be M/D/YY or M/D/YYYY.`);
  let year = Number(match[3]);
  if (match[3].length === 2) {
    if (yearBase === undefined) fail(`Record ${record}: two-digit Date requires --year-base (1900 or 2000).`);
    year += yearBase;
  }
  const month = Number(match[1]), day = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2199 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(`Record ${record}: invalid Date.`);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function cents(value, record, column) {
  if (!value) return 0n;
  const match = /^\$?((?:\d+|\d{1,3}(?:,\d{3})+))(?:\.(\d{2}))?$/.exec(value);
  if (!match) fail(`Record ${record}: invalid ${column}; use a nonnegative USD amount with zero or two decimal places.`);
  const amount = BigInt(match[1].replaceAll(',', '')) * 100n + BigInt(match[2] ?? '0');
  // Stay within the exact integer range used by the application's transaction forms.
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail(`Record ${record}: ${column} is outside the supported range.`);
  return amount;
}

export function normalizeCsv(text, { yearBase, defaultCategory } = {}) {
  if (yearBase !== undefined && ![1900, 2000].includes(yearBase)) fail('--year-base must be 1900 or 2000.');
  const records = parseCsv(text);
  if (!records.length || records[0].map(x => x.trim()).join('\0') !== HEADER.join('\0')) fail('CSV headers must exactly match the documented Checkbook format and order.');
  if (records.length === 1) fail('CSV contains no transactions.');
  return records.slice(1).map((values, index) => {
    const record = index + 2;
    if (values.length !== HEADER.length) fail(`Record ${record}: expected ${HEADER.length} columns.`);
    const [date, debit, credit, identifier, description, marker, notes, sourceCategory] = values.map(x => x.trim());
    if (values.some(x => x.includes('\0'))) fail(`Record ${record}: NUL characters are not supported.`);
    const category = sourceCategory || defaultCategory?.trim();
    if (!description || description.length > 500) fail(`Record ${record}: Description must contain 1–500 characters.`);
    if (!category || category.length > 100) fail(`Record ${record}: Category is required (or supply --default-category), maximum 100 characters.`);
    if (category.toLowerCase() === 'xfer accounts') fail(`Record ${record}: protected transfer category cannot be imported as a single ledger entry.`);
    if (identifier.length > 255 || notes.length > 5000) fail(`Record ${record}: ID or Notes exceeds the application limit.`);
    if (marker !== '' && marker !== '*') fail(`Record ${record}: Reconciled must be blank or *.`);
    const debitCents = cents(debit, record, 'Debit'), creditCents = cents(credit, record, 'Credit');
    if ((debitCents === 0n) === (creditCents === 0n)) fail(`Record ${record}: exactly one of Debit or Credit must be nonzero.`);
    return { record, occurredOn: dateValue(date, yearBase, record), amountCents: (creditCents - debitCents).toString(), identifier: identifier || null, description, reconciled: marker === '*', notes: notes || null, category };
  });
}

export function identifyRows(rows, accountId) {
  const seen = new Map();
  return rows.map(row => {
    const key = JSON.stringify([row.occurredOn, row.amountCents, row.identifier, row.description, row.reconciled, row.notes, row.category]);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const hash = createHash('sha256').update(JSON.stringify(['checkbook-v1', accountId.toLowerCase(), key, occurrence])).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { ...row, id };
  });
}

export function summarize(rows) {
  return {
    rows: rows.length,
    reconciled: rows.filter(row => row.reconciled).length,
    unreconciled: rows.filter(row => !row.reconciled).length,
    netCents: rows.reduce((sum, row) => sum + BigInt(row.amountCents), 0n).toString(),
    reconciledNetCents: rows.filter(row => row.reconciled).reduce((sum, row) => sum + BigInt(row.amountCents), 0n).toString(),
  };
}

export async function listAccounts(client, email) {
  const result = await client.query(`SELECT a.id,a.name,a.account_number_last_four FROM accounts a
    JOIN account_memberships m ON m.account_id=a.id JOIN users u ON u.id=m.user_id
    WHERE u.email=$1 AND a.is_active AND m.permission IN ('owner','editor') ORDER BY a.name,a.id`, [email.trim().toLowerCase()]);
  return result.rows;
}

// Caller supplies one connected pg client. No changes to existing ledger rows.
export async function importRows(client, rows, options) {
  const { accountId, email, commit = false, confirmReconciled = false, createCategories = false } = options;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(accountId ?? '')) fail('--account must be an account UUID.');
  if (!email?.trim()) fail('--user must be the existing acting user email.');
  if (!rows.length) fail('No transactions to import.');
  if (commit && rows.some(row => row.reconciled) && !confirmReconciled) fail('Import includes locked reconciled rows; add --confirm-reconciled to acknowledge.');
  await client.query(commit ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    // Read-only dry runs do not take write locks or create categories/receipt rows.
    const access = await client.query(`SELECT a.id, m.user_id, m.permission, a.is_active
      FROM accounts a JOIN account_memberships m ON m.account_id=a.id JOIN users u ON u.id=m.user_id
      WHERE a.id=$1 AND u.email=$2 ${commit ? 'FOR UPDATE OF a, m' : ''}`, [accountId, email.trim().toLowerCase()]);
    const user = access.rows[0];
    if (!user || !user.is_active || !['owner', 'editor'].includes(user.permission)) fail('Target must be an active account with owner/editor membership for the acting user.');
    // Account row locking serializes imports, including imports by different editors.
    const identified = identifyRows(rows, accountId);
    const existing = await client.query('SELECT id FROM transactions WHERE id=ANY($1::uuid[])', [identified.map(row => row.id)]);
    const prior = new Set(existing.rows.map(row => row.id));
    const pending = identified.filter(row => !prior.has(row.id));
    for (const row of pending) {
      const overlap = await client.query(`SELECT 1 FROM transactions WHERE account_id=$1 AND occurred_on=$2 AND amount_cents=$3
        AND description=$4 AND identifier IS NOT DISTINCT FROM $5 AND notes IS NOT DISTINCT FROM $6 LIMIT 1`,
      [accountId, row.occurredOn, row.amountCents, row.description, row.identifier, row.notes]);
      if (overlap.rowCount) fail(`Record ${row.record}: existing history overlaps this row; no import performed. Review the source rather than bypassing this check.`);
    }
    const names = [...new Set(pending.map(row => row.category))];
    const result = await client.query(`SELECT id,name,is_archived,is_system FROM categories WHERE user_id=$1 AND name=ANY($2::text[]) ${commit ? 'FOR UPDATE' : ''}`, [user.user_id, names]);
    const categories = new Map(result.rows.map(category => [category.name, category]));
    const missing = names.filter(name => !categories.has(name));
    for (const row of pending) {
      const category = categories.get(row.category);
      if (category?.is_archived || category?.is_system) fail(`Record ${row.record}: category is archived or protected; choose an active ordinary category in the source.`);
    }
    if (missing.length && !createCategories) fail(`${missing.length} missing categories; review category names in your source and rerun with --create-categories to authorize creation.`);
    const summary = { mode: commit ? 'committed' : 'dry-run', accountId, ...summarize(pending), skippedPreviouslyImported: prior.size, categoriesToCreate: missing.length };
    if (commit) {
      for (const name of missing) {
        const inserted = await client.query('INSERT INTO categories (user_id,name) VALUES ($1,$2) RETURNING id', [user.user_id, name]);
        categories.set(name, inserted.rows[0]);
      }
      for (const row of pending) {
        await client.query(`INSERT INTO transactions
          (id,user_id,account_id,occurred_on,amount_cents,description,category_id,identifier,notes,status,reconciled_at,reconciled_by_user_id,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'posted',CASE WHEN $10::boolean THEN now() ELSE NULL END,
          CASE WHEN $10::boolean THEN $2::uuid ELSE NULL END,clock_timestamp())`,
        [row.id, user.user_id, accountId, row.occurredOn, row.amountCents, row.description, categories.get(row.category).id, row.identifier, row.notes, row.reconciled]);
      }
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export const HELP = `Historical Checkbook CSV importer (dry-run by default)
  node scripts/import-checkbook.mjs --file PATH --user EMAIL --account UUID --year-base 2000 [options]
  --file -                 Read CSV from stdin (Docker-friendly)
  --validate-only          Validate CSV without connecting to the database
  --list-accounts --user EMAIL  List writable active account IDs/names
  --year-base 1900|2000     Explicit century for two-digit years
  --default-category NAME  Category for blank source categories only
  --create-categories      Authorize creating missing ordinary categories
  --commit                 Write the entire import atomically
  --confirm-reconciled     Acknowledge that starred rows become permanently locked
  --help                   Show this help
Requires DATABASE_URL (environment or project .env). Never pass database credentials on the command line.
Balance columns are ignored; verify the account starting balance before committing.
`;

export async function main(args = process.argv.slice(2)) {
  let client;
  try {
    const { values } = parseArgs({ args, strict: true, options: {
      file: { type: 'string' }, user: { type: 'string' }, account: { type: 'string' },
      'year-base': { type: 'string' }, 'default-category': { type: 'string' },
      'validate-only': { type: 'boolean' }, 'list-accounts': { type: 'boolean' },
      'create-categories': { type: 'boolean' }, commit: { type: 'boolean' },
      'confirm-reconciled': { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (values.help) { console.log(HELP); return; }
    if (values['validate-only'] && (values.commit || values['list-accounts'])) fail('--validate-only cannot be combined with --commit or --list-accounts.');
    if (values['list-accounts'] && (values.file || values.commit)) fail('--list-accounts cannot be combined with --file or --commit.');
    let rows;
    if (!values['list-accounts']) {
      if (!values.file) fail('--file is required; use --help for instructions.');
      let text;
      if (values.file === '-') {
        const chunks = []; let size = 0;
        for await (const chunk of process.stdin) {
          size += chunk.length;
          if (size > MAX_BYTES) fail('CSV exceeds 10 MiB.');
          chunks.push(chunk);
        }
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } else {
        if ((await stat(values.file)).size > MAX_BYTES) fail('CSV exceeds 10 MiB.');
        text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(values.file));
      }
      rows = normalizeCsv(text, { yearBase: values['year-base'] === undefined ? undefined : Number(values['year-base']), defaultCategory: values['default-category'] });
      if (values['validate-only']) { console.log(JSON.stringify({ mode: 'validation-only', ...summarize(rows) }, null, 2)); return; }
    }
    if (!values.user) fail('--user is required.');
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
    if (!process.env.DATABASE_URL) fail('DATABASE_URL must be configured in the environment or project .env.');
    const { default: pg } = await import('pg');
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
    await client.connect();
    if (values['list-accounts']) {
      console.log(JSON.stringify({ accounts: await listAccounts(client, values.user) }, null, 2));
    } else console.log(JSON.stringify(await importRows(client, rows, {
      accountId: values.account, email: values.user, commit: values.commit,
      confirmReconciled: values['confirm-reconciled'], createCategories: values['create-categories'],
    }), null, 2));
  } catch (error) {
    console.error(error instanceof ImportError ? error.message : 'Import failed. Check CLI options, file encoding/access, and database configuration. No partial import is committed; retrying the same unchanged input is safe.');
    process.exitCode = 1;
  } finally { if (client) await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
