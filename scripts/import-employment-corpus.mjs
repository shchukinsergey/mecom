// Usage: node scripts/import-employment-corpus.mjs <verified fixtures.json>
// Copies exact native inputs/outputs; never infers report rows or predecessor state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const source = process.argv[2];
if (!source) throw new Error('Provide the verified employment fixtures.json path.');
const bytes = fs.readFileSync(source);
const data = JSON.parse(bytes);
if (data.summary.staffingMismatches || data.summary.firingMismatches ||
    data.mismatches.length || !data.inputHashesUnchanged || data.saveCases.length !== 505) {
  throw new Error('Expected verified 505-row corpus with zero mismatches and unchanged inputs.');
}
const cases = data.saveCases.map(row => {
  // Retain scratch-cohort-relative paths, not machine-specific absolute prefixes.
  const parts = row.save.split(/[\\/]+/);
  const scratch = parts.lastIndexOf('scratch');
  if (scratch < 0) throw new Error('Missing scratch source provenance.');
  const { save, predictedEmployees, predictedFiring, firmName, ...exact } = row;
  return { save: parts.slice(scratch + 1).join('/'), ...exact };
});
const fixture = {
  provenance: { fixtureSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    exeSha256: data.exeSha256, summary: data.summary,
    formula: data.formula, firingFormula: data.firingFormula },
  cases,
};
const target = path.resolve('data/calibration/native-employment.json');
fs.writeFileSync(target, JSON.stringify(fixture, null, 2) + '\n');
console.log(`Imported ${cases.length} exact native SAVE rows into ${target}`);
