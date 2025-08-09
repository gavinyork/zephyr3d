import type { SerializableClass } from './types';

export class JSONProp {
  parent: JSONData;
  name: string;
  constructor(data: JSONData) {
    this.parent = data;
    if (this.parent && !(this.parent instanceof JSONArray)) {
      for (let i = 1; ; i++) {
        const name = `field${i}`;
        if (!this.parent.value.find((p) => p?.name === name)) {
          this.name = name;
          break;
        }
      }
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

export class JSONBool extends JSONProp {
  value: boolean;
  constructor(data: JSONData, value = false) {
    super(data);
    this.value = value;
  }
}

export class JSONData extends JSONProp {
  value: (JSONNumber | JSONString | JSONBool | JSONData)[];
  data: object;
  isnull: boolean;
  isundefined: boolean;
  constructor(parent: JSONData, data: object = {}) {
    super(parent);
    this.updateObject(data);
  }
  updateObject(data: object) {
    this.value = [];
    this.data = data;
    this.isnull = this.data === null;
    if (this.data) {
      this.parseObject();
    }
  }
  parseObject() {
    for (const key of Object.keys(this.data)) {
      const val = this.data[key];
      let prop: JSONString | JSONNumber | JSONBool | JSONData;
      if (typeof val === 'string') {
        prop = new JSONString(this, val);
      } else if (typeof val === 'number') {
        prop = new JSONNumber(this, val);
      } else if (typeof val === 'boolean') {
        prop = new JSONBool(this, val);
      } else if (typeof val === 'object') {
        prop = Array.isArray(val) ? new JSONArray(this, val) : new JSONData(this, val);
      } else {
        continue;
      }
      prop.name = key;
      this.value.push(prop);
    }
  }
  updateProps(): object {
    for (const key of Object.keys(this.data)) {
      delete this.data[key];
    }
    for (const prop of this.value) {
      if (prop instanceof JSONData) {
        this.data[prop.name] = prop.data;
      } else {
        this.data[prop.name] = prop.value;
      }
    }
    return this.data;
  }
}

export class JSONArray extends JSONData {
  constructor(parent: JSONData, data: unknown[] = []) {
    super(parent);
    this.updateObject(data);
  }
  updateObject(data: object) {
    this.value = [];
    this.data = data;
    this.isnull = this.data === null;
    if (this.data) {
      this.parseObject();
    }
  }
  parseObject() {
    const data = this.data as unknown[];
    if (data?.length > 0) {
      for (let i = 0; i < data.length; i++) {
        const val = data[i];
        let prop: JSONString | JSONNumber | JSONBool | JSONData;
        if (typeof val === 'string') {
          prop = new JSONString(this, val);
        } else if (typeof val === 'number') {
          prop = new JSONNumber(this, val);
        } else if (typeof val === 'boolean') {
          prop = new JSONBool(this, val);
        } else if (typeof val === 'object') {
          prop = !val ? null : Array.isArray(val) ? new JSONArray(this, val) : new JSONData(this, val);
        } else {
          continue;
        }
        this.value.push(prop);
      }
    }
  }
  updateProps(): object {
    const data = this.data as unknown[];
    data.splice(0, data.length);
    for (let i = 0; i < this.value.length; i++) {
      const prop = this.value[i];
      if (prop instanceof JSONArray) {
        this.data[i] = prop.data;
      } else if (prop instanceof JSONData) {
        this.data[i] = prop.data;
      } else {
        this.data[i] = prop?.value ?? null;
      }
    }
    return this.data;
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
          isHidden(this: JSONProp) {
            return !this.parent || this.parent instanceof JSONArray;
          },
          get(this: JSONProp, value) {
            value.str[0] = this.name;
          },
          set(this: JSONProp, value) {
            const data = this.parent;
            if (data && value.str[0] && !data.value.find((p) => p !== this && p.name === value.str[0])) {
              this.name = value.str[0];
              this.parent.updateProps();
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
          isHidden() {
            return this.name.startsWith('.');
          },
          get(this: JSONString, value) {
            value.str[0] = this.value;
          },
          set(this: JSONString, value) {
            if (this.value !== value.str[0]) {
              this.value = value.str[0];
              this.parent.updateProps();
            }
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
          isHidden() {
            return this.name.startsWith('.');
          },
          get(this: JSONNumber, value) {
            value.num[0] = this.value;
          },
          set(this: JSONNumber, value) {
            if (this.value !== value.num[0]) {
              this.value = value.num[0];
              this.parent.updateProps();
            }
          }
        }
      ];
    }
  };
}

export function getJSONBoolClass(): SerializableClass {
  return {
    ctor: JSONBool,
    parent: JSONProp,
    noTitle: true,
    createFunc(ctx: JSONData) {
      return { obj: new JSONBool(ctx) };
    },
    getProps() {
      return [
        {
          name: 'value',
          type: 'bool',
          isHidden() {
            return this.name.startsWith('.');
          },
          get(this: JSONBool, value) {
            value.bool[0] = this.value;
          },
          set(this: JSONBool, value) {
            if (this.value !== value.bool[0]) {
              this.value = value.bool[0];
              this.parent.updateProps();
            }
          }
        }
      ];
    }
  };
}

export function getJSONObjectClass(): SerializableClass {
  return {
    ctor: JSONData,
    parent: JSONProp,
    noTitle: true,
    createFunc(ctx) {
      return { obj: new JSONData(ctx instanceof JSONData ? ctx : null) };
    },
    getProps() {
      return [
        {
          name: 'JSONData',
          type: 'object_array',
          options: { objectTypes: [JSONString, JSONNumber, JSONBool, JSONData, JSONArray] },
          default: [],
          isNullable() {
            return false;
          },
          isHidden() {
            return this.name.startsWith('.');
          },
          get(this: JSONData, value) {
            value.object = this.value.slice();
          },
          set(this: JSONData, value, index) {
            if (value === null) {
              this.isnull = true;
            } else if (index >= 0) {
              this.value[index] = value.object[0] as JSONString | JSONNumber | JSONBool | JSONData;
              this.updateProps();
            } else {
              this.value = value.object.slice() as (JSONString | JSONNumber | JSONBool | JSONData)[];
              this.updateProps();
            }
          },
          create(this: JSONData, ctor) {
            const c = ctor as typeof JSONString | typeof JSONNumber | typeof JSONBool | typeof JSONData;
            return c ? new c(this) : null;
          },
          add(this: JSONData, value, index) {
            this.value.splice(index, 0, value.object[0] as JSONString | JSONNumber | JSONBool | JSONData);
            this.updateProps();
          },
          delete(this: JSONData, index) {
            this.value.splice(index, 1);
            this.updateProps();
          }
        }
      ];
    }
  };
}

export function getJSONArrayClass(): SerializableClass {
  return {
    ctor: JSONArray,
    parent: JSONProp,
    noTitle: true,
    createFunc(ctx) {
      return { obj: new JSONArray(ctx instanceof JSONData || ctx instanceof JSONArray ? ctx : null) };
    },
    getProps() {
      return [
        {
          name: 'JSONArray',
          type: 'object_array',
          options: { objectTypes: [JSONString, JSONNumber, JSONBool, JSONData, JSONArray] },
          default: [],
          isNullable() {
            return true;
          },
          get(this: JSONArray, value) {
            value.object = this.value.slice();
          },
          set(this: JSONArray, value, index) {
            if (value === null) {
              this.isnull = true;
            } else if (index >= 0) {
              this.value[index] = value.object[0] as
                | JSONString
                | JSONNumber
                | JSONBool
                | JSONData
                | JSONArray;
              this.updateProps();
            } else {
              this.value = value.object.slice() as (
                | JSONString
                | JSONNumber
                | JSONBool
                | JSONData
                | JSONArray
              )[];
              this.updateProps();
            }
          },
          create(this: JSONArray, ctor, index) {
            const c = ctor as
              | typeof JSONString
              | typeof JSONNumber
              | typeof JSONBool
              | typeof JSONData
              | typeof JSONArray;
            const prop = c ? new c(this) : null;
            if (prop) {
              prop.name = String(index);
            }
            return prop;
          },
          add(this: JSONArray, value, index) {
            this.value.splice(
              index,
              0,
              value.object[0] as JSONString | JSONNumber | JSONBool | JSONData | JSONArray
            );
            this.updateProps();
          },
          delete(this: JSONArray, index) {
            this.value.splice(index, 1);
            this.updateProps();
          }
        }
      ];
    }
  };
}
