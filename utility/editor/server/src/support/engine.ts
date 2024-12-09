import * as mysql from 'mysql';
import { DatabaseError } from './errcodes';

export interface IQuery {
  sql: string;
  param: any[];
}

export class Engine {
  private static engineMap: { [name: string]: Engine } = {};
  public static getInstance(name: string) {
    return this.engineMap[name] || null;
  }
  public static registerInstance(name: string, engine: Engine) {
    if (name && engine && !this.engineMap[name]) {
      this.engineMap[name] = engine;
      return true;
    }
    return false;
  }
  public static unregisterInstance(name: string) {
    if (this.engineMap[name]) {
      delete this.engineMap[name];
    }
  }
  public static createConnection(options: mysql.PoolConfig) {
    return mysql.createConnection(options);
  }
  public static async query_wo_pool(conn: mysql.Connection, q: IQuery | string) {
    let sql: string;
    let param: any[];
    if (typeof q === 'string') {
      sql = q;
      param = [];
    } else {
      sql = q.sql;
      param = q.param || [];
    }
    return new Promise<any>((resolve, reject) => {
      conn.query(sql, param, (err, rows) => {
        if (err) {
          const errmsg = `${err.message}\nSQL:${err.sql}`;
          console.error(`Engine.query_wo_pool():\n${errmsg}`);
          reject(new DatabaseError(errmsg, err.errno, err.code));
        } else {
          resolve(rows);
        }
      });
    });
  }
  public options: mysql.PoolConfig;
  private pool: mysql.Pool;
  public constructor(options: mysql.PoolConfig) {
    this.options = options;
    this.pool = mysql.createPool(this.options);
  }
  public async formatSQL(sql: string, params: unknown[]) {
    const conn = await this.getConnection();
    return conn.format(sql, params);
  }
  public close(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      if (this.pool) {
        this.pool.end((err) => {
          if (err) {
            console.error(`Engine.close(): ${err}`);
            reject(err);
          } else {
            resolve('Ok');
          }
        });
      } else {
        resolve('Ok');
      }
    });
  }
  public getConnection(): Promise<mysql.PoolConnection> {
    return new Promise<mysql.PoolConnection>(
      (resolve: (value?: any) => void, reject: (reason?: any) => void) => {
        this.pool.getConnection((err, connection) => {
          if (err) {
            const errmsg = `${err.message}\n`;
            console.error(`Engine.getConnection()\n${errmsg}\n${err.stack}`);
            reject(new DatabaseError(errmsg, err.errno, err.name));
          } else {
            resolve(connection);
          }
        });
      }
    );
  }
  public releaseConnection(connection: mysql.PoolConnection) {
    if (connection) {
      connection.release();
    }
  }
  public beginSession(): Promise<Engine.Session> {
    return new Promise<Engine.Session>((resolve, reject) => {
      const session = new Engine.Session(this);
      session
        .begin()
        .then(() => resolve(session))
        .catch((reason: DatabaseError) => {
          console.error(`Engine.beginSession(): \n${reason}\n$`);
          reject(reason);
        });
    });
  }
  public async query(q: IQuery | string) {
    const conn = await this.getConnection();
    const result = await Engine.query_wo_pool(conn, q);
    this.releaseConnection(conn);
    return result;
  }
  public async querySafe(q: IQuery | string) {
    const conn = await this.getConnection();
    let sql: string;
    let param: any[];
    if (typeof q === 'string') {
      sql = q;
      param = [];
    } else {
      sql = q.sql;
      param = q.param || [];
    }
    const stmt = conn.format(sql, param);
    const result = await Engine.query_wo_pool(conn, stmt);
    this.releaseConnection(conn);
    return result;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Engine {
  export class Col {
    public type: number;
    public column: string | null;
    public table: string | null;
    public aggfunc: string | null;
    public aggfield: string | null;
    public constructor(
      type: number,
      column: string | null,
      table: string | null,
      aggfunc: string | null,
      aggfield: string | null
    ) {
      this.type = type;
      this.column = column;
      this.table = table;
      this.aggfunc = aggfunc;
      this.aggfield = aggfield;
    }
  }
  export class Session {
    private engine: Engine;
    private connection: mysql.PoolConnection | null;
    public constructor(engine: Engine) {
      this.engine = engine;
      this.connection = null;
    }
    public begin(): Promise<any> {
      return new Promise<any>((resolve, reject) => {
        this.engine.getConnection().then(
          (conn) => {
            this.connection = conn;
            this.connection.beginTransaction((err) => {
              if (err) {
                this.engine.releaseConnection(this.connection);
                this.connection = null;
                const errmsg = `${err.message}\nSQL:${err.sql}`;
                console.error(`Session.begin():\n${errmsg}`);
                reject(new DatabaseError(errmsg, err.errno, err.name));
              } else {
                resolve(null);
              }
            });
          },
          (reason: DatabaseError) => {
            console.error(`Session.begin()\n${reason.message}`);
            reject(reason);
          }
        );
      });
    }
    public end(): Promise<any> {
      return new Promise<any>((resolve, reject) => {
        if (this.connection) {
          this.connection.commit((err) => {
            if (err) {
              const errmsg = `${err.message}\nSQL:${err.sql}`;
              console.error(`Session.end():\n${errmsg}`);
              reject(new DatabaseError(errmsg, err.errno, err.name));
            } else {
              this.engine.releaseConnection(this.connection);
              this.connection = null;
              resolve(null);
            }
          });
        } else {
          console.error('Session.end(): connection is null');
          reject(new DatabaseError('数据库连接错误', 0, '数据库连接失败'));
        }
      });
    }
    public async cancel() {
      return new Promise<any>((resolve, reject) => {
        if (this.connection) {
          this.connection.rollback((err) => {
            this.engine.releaseConnection(this.connection);
            this.connection = null;
            if (err) {
              const errmsg = `${err.message}\nSQL:${err.sql}`;
              console.error(`Session.cancel():\n${errmsg}`);
              reject(new DatabaseError(errmsg, err.errno, ''));
            } else {
              resolve(null);
            }
          });
        } else {
          resolve(null);
        }
      });
    }
    public async query(q: IQuery | string) {
      if (this.connection) {
        return Engine.query_wo_pool(this.connection, q);
      }
      return this.engine.query(q);
    }
  }
}
