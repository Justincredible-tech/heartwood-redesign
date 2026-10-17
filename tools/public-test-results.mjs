import assert from 'node:assert/strict';

// Node completion events use marker presence, including empty strings and false
// context reasons. Convert that protocol into the shared Node/Python booleans.
export function normalizeNodeTestDirectives(data) {
  assert(data && typeof data === 'object', 'Node test completion data is required');
  return {skip: data.skip !== undefined, todo: data.todo !== undefined};
}

export function summarizePublicTests(roster, events, optionalNative) {
  assert(Array.isArray(roster) && roster.length > 0, 'A nonempty public test roster is required');
  assert(new Set(roster).size === roster.length, 'Duplicate public test files');
  const rows = new Map(roster.map(file => [ file, {
    file: file,
    tests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0
  } ]));
  const errors = [];
  let unassignedFailures = 0;
  for (const event of events) {
    if (!event || ![ 'pass', 'fail' ].includes(event.type)) {
      errors.push('Invalid test completion event');
      continue;
    }
    if ((event.skip !== undefined && typeof event.skip !== 'boolean') ||
        (event.todo !== undefined && typeof event.todo !== 'boolean')) {
      errors.push('Invalid test completion directive flags');
      continue;
    }
    const row = rows.get(event.file);
    if (!row) {
      if (event.type === 'fail') unassignedFailures++; else errors.push('Unexpected test file: ' + event.file);
      continue;
    }
    row.tests++;
    if (event.skip) row.skipped++;
    else if (event.todo) row.todo++;
    else if (event.type === 'fail') row.failed++;
    else row.passed++;
  }
  for (const row of rows.values()) {
    if (!row.tests || !row.passed) errors.push('Required file has no passing executed test: ' + row.file);
    if (row.skipped || row.todo) errors.push('Required file skipped tests or left TODOs: ' + row.file);
    if (row.failed) errors.push('Required tests failed: ' + row.file);
  }
  if (unassignedFailures) errors.push('Unassigned test/load failures: ' + unassignedFailures);
  const list = [ ...rows.values() ];
  const count = key => list.reduce((total, row) => total + row[key], 0);
  return {
    schema: 1,
    status: errors.length ? 'FAIL' : 'PASS',
    tests: count('tests'),
    passed: count('passed'),
    failed: count('failed') + unassignedFailures,
    skipped: count('skipped'),
    mandatorySkipped: count('skipped'),
    mandatoryFiles: list.length,
    todo: count('todo'),
    roster: list,
    optionalNative: optionalNative,
    errors: errors
  };
}

export function validatePublicTestResult(result, roster) {
  assert(result && result.schema === 1 && result.status === 'PASS', 'No successful public-test completion');
  assert(Number.isSafeInteger(result.tests) && result.tests > 0, 'Empty public tests cannot pass');
  assert(result.failed === 0 && result.skipped === 0 && result.todo === 0, 'Required test omissions/failures');
  assert.equal(result.mandatorySkipped, 0, 'Required test omissions');
  assert.equal(result.mandatoryFiles, roster.length, 'Required test file count changed');
  assert(Array.isArray(result.errors) && result.errors.length === 0, 'Public test errors');
  assert(Array.isArray(result.roster) && result.roster.length === roster.length, 'Public test roster mismatch');
  assert.deepEqual(result.roster.map(row => row.file), roster, 'Public test membership changed');
  for (const row of result.roster) {
    assert(Number.isSafeInteger(row.tests) && row.tests > 0 && row.tests === row.passed, 'Empty/incomplete file');
    assert(row.failed === 0 && row.skipped === 0 && row.todo === 0, 'Skipped/failed required file');
  }
  assert.equal(result.tests, result.roster.reduce((total, row) => total + row.tests, 0));
  assert.equal(result.passed, result.tests);
  return result;
}
