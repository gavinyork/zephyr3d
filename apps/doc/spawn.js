const crossSpawn = require('cross-spawn');

function spawn(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(cmd ?? process.cwd(), args, {
      cwd: cwd,
      env: Object.assign({ FORCE_COLOR: "1" }, process.env),
      stdio: 'pipe'
    });

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
    })
    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    })
    child.on('error', function (data) { console.log(chalk.red(data)); });
    child.on('close', (code) => resolve(code));
    spawn.children.push(child);
  });
}

function spawnSync(cmd, args, cwd) {
  const child = crossSpawn.sync(cmd ?? process.cwd(), args, {
    cwd: cwd,
    env: Object.assign({ FORCE_COLOR: "1" }, process.env),
    stdio: 'inherit'
  });

  if (child.status !== 0) {
    process.exit(child.status);
  }
}

spawn.children = [];
spawn.killAll = function () {
  spawn.children.forEach((proc) => {
    proc.stdin.end();
  });
}

function handleInterrupts(callback) {
  if (!callback) {
    callback = () => {
      spawn.killAll();
      process.exit();
    };
  }

  if (process.platform === "win32") {
    require("readline")
      .createInterface({
        input: process.stdin,
        output: process.stdout
      });
  }

  ['SIGINT', 'SIGTERM'].forEach(function (sig) {
    process.on(sig, function () {
      callback();
    });
  });
}

module.exports = {
  spawn: spawn,
  spawnSync: spawnSync,
  handleInterrupts
};