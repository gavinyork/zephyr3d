import fs from 'fs';
import path from 'path';
import { StudioApp } from '../app';
import { serverError } from './errcodes';

const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;

function format(n: number): string {
  return `00${n}`.slice(-2);
}

function normalizeName(name: string): string {
  const dt = new Date();
  return `${name}-${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}

function recreateLogStream(name: string) {
  try {
    for (const k in streams) {
      if (k.startsWith(`${name}-`)) {
        streams[k]?.stream?.close();
        delete streams[k];
      }
    }
    const logPath = StudioApp.getInstance().logDir;
    fs.mkdirSync(logPath, { recursive: true });
    const filename = path.join(logPath, `${name}.log`);
    const stream = fs.createWriteStream(filename, { flags: 'a', encoding: 'utf8' });
    streams[name] = { stream };
  } catch (err) {
    console.log(`create log stream failed: ${err}`);
  }
  return streams[name].stream;
}

const streams: { [name: string]: { stream: fs.WriteStream } } = {};
let isConsoleEnabled = true;
let isStdoutEnabled = true;
const callbacks: ((stream: string, chunk: string) => void)[] = [];

export function addCallback(callback: (stream: string, chunk: string) => void) {
  if (callback && callbacks.indexOf(callback) < 0) {
    callbacks.push(callback);
  }
}

export function removeCallback(callback: (stream: string, chunk: string) => void) {
  const index = callbacks.indexOf(callback);
  if (index >= 0) {
    callbacks.splice(index, 1);
  }
}

function internalLog(
  stream: string,
  chunk: string,
  banner: string,
  noprefix: boolean,
  flush: boolean
): string {
  for (const cb of callbacks) {
    try {
      cb(stream, chunk);
    } catch (err) {}
  }
  const name = normalizeName(stream);
  let wss = streams[name]?.stream;
  if (!wss || wss.closed) {
    wss = recreateLogStream(name);
  }
  const text = `${noprefix ? '' : `${prefix()} `}${banner ? `[${banner}] ` : ''}${chunk}`;
  if (wss) {
    wss.write(`${text}\n`);
    if (flush) {
      wss.close();
      delete streams[name];
    }
  }
  if (isConsoleEnabled) {
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    console.log(text);
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  } else if (isStdoutEnabled) {
    process.stdout.write(`${text}\n`);
  }
  return text;
}

async function closeStream(stream: fs.WriteStream) {
  return new Promise<void>((resolve, reject) => {
    if (!stream || stream.closed) {
      resolve();
    } else {
      stream.on('close', resolve);
      stream.on('error', resolve);
      stream.close();
    }
  });
}

export async function close() {
  for (const k in streams) {
    await closeStream(streams[k]?.stream);
    delete streams[k];
  }
}

export function prefix(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${format(dt.getMonth() + 1)}-${format(dt.getDate())} ${format(
    dt.getHours()
  )}:${format(dt.getMinutes())}:${format(dt.getSeconds())}`;
}

export function createLogStream(name: string) {
  name = normalizeName(name);
  if (streams[name]) {
    return streams[name].stream;
  }
  return recreateLogStream(name);
}

export function log(stream: string, chunk: string, banner = '', noprefix = false) {
  internalLog(stream, chunk, banner, noprefix, false);
}

export function info(chunk: string) {
  internalLog('server', chunk, 'INFO', false, false);
}

export function debug(chunk: string) {
  internalLog('server', chunk, 'DEBUG', false, false);
}

export function warning(chunk: string) {
  internalLog('server', chunk, 'WARN', false, false);
}

export function error(chunk: string) {
  internalLog('errors', chunk, 'ERROR', false, false);
  internalLog('server', chunk, 'ERROR', false, false);
}

export function fatal(chunk: string): never {
  internalLog('server', chunk, 'FATAL', false, false);
  serverError(internalLog('errors', chunk, 'FATAL', false, true));
}

export function getLogFileName(name: string): string {
  return streams[normalizeName(name)]?.stream?.path as string;
}

export function enableStdout(enable: boolean) {
  isStdoutEnabled = enable;
}

export function stdoutEnabled(): boolean {
  return isStdoutEnabled;
}

export function enableConsole(enable: boolean) {
  isConsoleEnabled = !!enable;
}

export function consoleEnabled(): boolean {
  return isConsoleEnabled;
}
