import fs from 'node:fs';
const source = fs.readFileSync(process.argv[2], 'utf8');
// drizzle-kit exports FK additions before unique indexes they reference. On an
// empty database create all tables/indexes first, then retain every constraint.
const constraints = [];
const lines = source.split('\n').filter(line => {
  if (!line.startsWith('ALTER TABLE ')) return true;
  if (!line.endsWith(';')) throw new Error('Unexpected multiline schema alteration');
  constraints.push(line);
  return false;
});
fs.writeFileSync(process.argv[3], lines.join('\n') + '\n' + constraints.join('\n') + '\n');
