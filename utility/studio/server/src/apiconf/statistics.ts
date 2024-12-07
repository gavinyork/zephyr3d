import type * as helper from './helper';

export const STAT_API = {
  path: ['/api'],
  interfaces: {}
};

export const STAT_HANDLERS: helper.ApiFunctions<typeof STAT_API.interfaces> = {};
