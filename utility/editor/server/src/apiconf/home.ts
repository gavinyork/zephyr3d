import path from 'path';
import type * as helper from './helper';
import fs from 'fs';

export const HOME_API = {
  path: ['/'],
  interfaces: {
    index: {
      method: 'get',
      path: '/'
    }
  }
};

export const HOME_HANDLERS: helper.ApiFunctions<typeof HOME_API.interfaces> = {
  async index(req, res) {
    const config = {
      apiBaseUrl: process.env.API_BASE_URL || '/api'
    };
    let html = await fs.promises.readFile(path.resolve(__dirname, 'static', 'index.html'), 'utf-8');
    html = html.replace('</head>', `<meta name="api-base-url" content="${config.apiBaseUrl}"></head>`);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
};
