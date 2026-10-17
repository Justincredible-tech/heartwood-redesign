// Runs in the test child's worker thread, so a blocked test cannot block its deadline.
import { parentPort, workerData } from 'node:worker_threads';

const {launcherPid: launcherPid, deadlineAt: deadlineAt} = workerData;

if (!Number.isSafeInteger(launcherPid) || launcherPid < 1 || !Number.isSafeInteger(deadlineAt)) {
  throw Error('Invalid public-test watchdog owner/deadline');
}

function launcherExists() {
  try {
    process.kill(launcherPid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

const timer = setInterval(() => {
  const expired = Date.now() >= deadlineAt;
  if (!expired && launcherExists()) return;
  // Only this worker's own test process is signalled. No host-wide process scan.
    process.kill(process.pid, 'SIGKILL');
}, 100);

parentPort.once('message', message => {
  if (message !== 'complete') return;
  clearInterval(timer);
  parentPort.close();
});
