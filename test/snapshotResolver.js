/**
 * Routes Jest snapshots into a per-depth-convention directory so the
 * standard-Z and reverse-Z test runs maintain independent snapshot sets:
 *
 *   <testdir>/__snapshots__/reverse/<testfile>.snap   (default)
 *   <testdir>/__snapshots__/standard/<testfile>.snap
 */

const path = require('path');

const convention = process.env.Z_CONVENTION === 'standard' ? 'standard' : 'reverse';

module.exports = {
  resolveSnapshotPath(testPath, snapshotExtension) {
    return path.join(
      path.dirname(testPath),
      '__snapshots__',
      convention,
      path.basename(testPath) + snapshotExtension
    );
  },
  resolveTestPath(snapshotFilePath, snapshotExtension) {
    return path.join(
      path.dirname(path.dirname(path.dirname(snapshotFilePath))),
      path.basename(snapshotFilePath, snapshotExtension)
    );
  },
  testPathForConsistencyCheck: path.join('consistency_check', '__tests__', 'example.test.js')
};
