import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as support from './support';
import * as apiconf from './apiconf/apidef';
import 'express-async-errors';

export class StudioApp {
  private static _instance: StudioApp = null;
  private _logDir: string;
  private _workspace: string;
  constructor() {
    this._logDir = path.resolve(os.homedir(), '.zephyr3d-studio', 'logs');
    fs.mkdirSync(this._logDir, { recursive: true });
    this._workspace = path.resolve(os.homedir(), '.zephyr3d-studio', 'projects');
    fs.mkdirSync(this._workspace, { recursive: true });
  }
  public static getInstance() {
    if (!this._instance) {
      this._instance = new StudioApp();
    }
    return this._instance;
  }
  get workspace(): string {
    return this._workspace;
  }
  get logDir(): string {
    return this._logDir;
  }
  public startup(argv: string[]) {
    const app = express();
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.set('view cache', false);
    app.set('etag', false);
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());
    app.all('*', (req, res, next) => {
      res.header('Access-Control-Allow-Origin', req.headers.origin);
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type,Content-Length,Authorization,Accept,X-Requested-With,X-PA-Version,Cookie'
      );
      res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
      res.header('Access-Control-Expose-Headers', 'Set-Cookie;');
      res.header('Access-Control-Allow-Credentials', 'true');
      next();
    });

    app.use('/', express.static(path.join(__dirname, 'static')));

    support.RouteTool.loadRouters(app, apiconf.API_DEFINE);

    app.use((req: express.Request, res: express.Response) => {
      res.sendStatus(404);
    });

    app.use((err: any, req: express.Request, res: express.Response) => {
      console.error(`${err.toString()}\n${err.stack}`);
      res.sendStatus(500);
    });

    const httpPort = Number(argv[2]) || 8000;
    const server = http.createServer(app);
    server.listen(httpPort, '0.0.0.0');
    server.on('error', (error: any) => {
      throw error;
    });
    server.on('listening', () => {
      const addr = server.address();
      const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;
      console.info(`Server started on ${bind}`);
    });
  }
}
