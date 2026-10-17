import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('unknown/empty profiler selections and invalid scales fail before allocating a browser',()=>{
  const tool=fileURLToPath(new URL('../tools/profile-leaf-hover.mjs',import.meta.url));
  for(const overrides of [{HW_ACTIVITIES:'typo'},{HW_ACTIVITIES:''},{HW_HOVER_VARIANTS:'unknown'},{HW_HOVER_VARIANTS:''},{HW_DPR:'NaN'},{HW_CPU:'0'}]){
    const r=spawnSync(process.execPath,[tool],{
      env:{...process.env,HW_ALLOW_EXTERNAL:'',HW_ACTIVITIES:'sweep',HW_HOVER_VARIANTS:'shipped',...overrides},encoding:'utf8',timeout:5000,
    });
    assert.equal(r.error,undefined,'invalid selection leaked setup resources: '+JSON.stringify(overrides));
    assert.equal(r.status,1,r.stderr);
    assert.match(r.stderr,/Unknown HW_|HW_DPR must be positive/);
    assert.doesNotMatch(r.stdout,/"gpu"|"frames"/,'invalid selection reached the measurement');
  }
});
