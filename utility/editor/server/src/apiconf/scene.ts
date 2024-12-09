import type * as helper from './helper';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { StudioApp } from '../app';
import { successResponse } from '../support';

export const SCENE_API = {
  path: ['/api'],
  interfaces: {
    createScene: {
      method: 'post',
      path: '/scene',
      params: {
        name: {
          name: '场景名称',
          type: 'string',
          required: true,
          nullable: false,
          default: ''
        }
      }
    }
  }
};

export const SCENE_HANDLERS: helper.ApiFunctions<typeof SCENE_API.interfaces> = {
  async createScene(req, res, next, params) {
    const uuid = randomUUID();
    const pathname = path.resolve(StudioApp.getInstance().workspace, 'scenes', uuid);
    await fs.promises.mkdir(pathname, {
      recursive: true
    });
    const sceneMetaData = {
      name: params.name
    };
    await fs.promises.writeFile(
      path.resolve(pathname, 'metadata.json'),
      JSON.stringify(sceneMetaData, null, '  '),
      'utf-8'
    );
    successResponse(res, {
      name: params.name,
      uuid: uuid
    });
  }
};
