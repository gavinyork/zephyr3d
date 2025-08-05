import { SerializableClass } from '../types';

export class JSONProp {
  parent: JSONData;
  name: string;
  constructor(data: JSONData) {
    this.parent = data;
    if (this.parent) {
      let i = 1;
      while (true) {
        if (!data.value.find((p) => p.name === `prop${i}`)) {
          break;
        }
      }
      this.name = `field${i}`;
    } else {
      this.name = '';
    }
  }
}

export class JSONString extends JSONProp {
  value: string;
  constructor(data: JSONData, value = '') {
    super(data);
    this.value = value;
  }
}

export class JSONNumber extends JSONProp {
  value: number;
  constructor(data: JSONData, value = 0) {
    super(data);
    this.value = value;
  }
}

export class JSONData extends JSONProp {
  value: JSONProp[];
  data: object;
  constructor(parent: JSONData) {
    super(parent);
    this.value = [];
  }
  static fromObject(obj: object): JSONData {
    if (!obj) {
      return null;
    }
    const data = new JSONData(null);
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      let prop: JSONProp;
      if (typeof val === 'string') {
        prop = new JSONString(data, val);
      } else if (typeof val === 'number') {
        prop = new JSONNumber(data, val);
      } else if (typeof val === 'object' && val !== null) {
        prop = JSONData.fromObject(val);
        (prop as JSONData).parent = data;
      } else {
        continue;
      }
      prop.name = key;
      data.value.push(prop);
    }
    return data;
  }
  static toObject(data: JSONData): object {
    if (!data) {
      return null;
    }
    const obj = {};
    for (const prop of data.value) {
      if (prop instanceof JSONString) {
        obj[prop.name] = prop.value;
      } else if (prop instanceof JSONNumber) {
        obj[prop.name] = prop.value;
      } else if (prop instanceof JSONData) {
        obj[prop.name] = JSONData.toObject(prop);
      }
    }
    return obj;
  }
}

export function getJSONPropClass(): SerializableClass {
  return {
    ctor: JSONProp,
    noTitle: true,
    createFunc(ctx: JSONData) {
      return { obj: new JSONProp(ctx) };
    },
    getProps() {
      return [
        {
          name: 'name',
          type: 'string',
          default: '',
          get(this: JSONProp, value) {
            value.str[0] = this.name;
          },
          set(this: JSONProp, value) {
            const data = this.parent;
            if (!data.value.find((p) => p !== this && p.name === value.str[0])) {
              this.name = value.str[0];
            }
          }
        }
      ];
    }
  };
}

export function getJSONStringClass(): SerializableClass {
  return {
    ctor: JSONString,
    parent: JSONProp,
    noTitle: true,
    createFunc(ctx: JSONData) {
      return { obj: new JSONString(ctx) };
    },
    getProps() {
      return [
        {
          name: 'value',
          type: 'string',
          get(this: JSONString, value) {
            value.str[0] = this.value;
          },
          set(this: JSONString, value) {
            this.value = value.str[0];
          }
        }
      ];
    }
  };
}

export function getJSONNumberClass(): SerializableClass {
  return {
    ctor: JSONNumber,
    parent: JSONProp,
    noTitle: true,
    createFunc(ctx: JSONData) {
      return { obj: new JSONString(ctx) };
    },
    getProps() {
      return [
        {
          name: 'value',
          type: 'float',
          get(this: JSONNumber, value) {
            value.num[0] = this.value;
          },
          set(this: JSONNumber, value) {
            this.value = value.num[0];
          }
        }
      ];
    }
  };
}

export function getJSONClass(): SerializableClass {
  return {
    ctor: JSONData,
    createFunc(ctx) {
      return { obj: new JSONData(ctx instanceof JSONData ? ctx : null) };
    },
    getProps() {
      return [
        {
          name: 'JSONData',
          type: 'object_array',
          options: { objectTypes: [JSONString, JSONNumber, JSONData] },
          default: [],
          isNullable() {
            return true;
          },
          get(this: JSONData, value) {
            value.object = this.value.slice();
          },
          set(this: JSONData, value, index) {
            this.value = value.object.slice() as JSONProp[];
          },
          create(this: JSONData, ctor) {
            const c = ctor as typeof JSONString | typeof JSONNumber | typeof JSONData;
            return c ? new c(this) : null;
          },
          add(this: JSONData, value, index) {
            this.value.splice(index, 0, value.object[0] as JSONString | JSONNumber | JSONData);
          },
          delete(this: JSONData, index) {
            return this.value.splice(index, 1)[0];
          }
        }
      ];
    }
  };
}
