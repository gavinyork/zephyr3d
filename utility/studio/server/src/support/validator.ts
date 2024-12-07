export interface ParamValidatorOptions<T> {
  list?: unknown[];
  listMap?: unknown[];
  listType?: 0 | 1;
  nullable?: boolean;
  required?: boolean;
  defaultValue?: T;
}

export interface ParamArrayValidatorOptions<T> extends ParamValidatorOptions<T[]> {
  arrayLengthMin?: number;
  arrayLengthMax?: number;
}

export abstract class BaseParamValidator {
  abstract validate(value: unknown): { value?: unknown; succeeded: boolean };
}

export abstract class ParamValidator<
  T,
  OptionType extends ParamValidatorOptions<T>
> extends BaseParamValidator {
  public options: OptionType;
  public constructor(options?: OptionType) {
    super();
    this.options = Object.assign({}, options || {}) as OptionType;
  }
  public validate(value: unknown): { value?: unknown; succeeded: boolean } {
    if (value === null) {
      if (this.options.nullable) {
        return { value: null, succeeded: true };
      }
      return { succeeded: false };
    }
    if (value === undefined && this.options.required) {
      return { succeeded: false };
    }
    const val = this.preprocessValue(value);
    if (this.options.list) {
      if (this.options.listType === 0) {
        const index = this.options.list.indexOf(val);
        if (index >= 0) {
          if (val !== undefined) {
            return { value: this.options.listMap ? this.options.listMap[index] : val, succeeded: true };
          }
        } else {
          return { succeeded: false };
        }
      } else if (this.options.list.indexOf(val) >= 0) {
        return { succeeded: false };
      }
    }
    if (val === undefined) {
      return { value: this.options.defaultValue, succeeded: true };
    }
    if (this.testValue(val)) {
      return { value: val, succeeded: true };
    }
    return { succeeded: false };
  }
  protected abstract preprocessValue(value: unknown): unknown;
  protected abstract testValue(value: unknown): boolean;
}

export interface NumberValidatorOptions extends ParamValidatorOptions<number> {
  rangeMin?: number;
  rangeMax?: number;
}

export class NumberValidator extends ParamValidator<number, NumberValidatorOptions> {
  protected preprocessValue(value: unknown): unknown {
    return value !== undefined ? Number(value) : value;
  }
  protected testValue(value: unknown): boolean {
    const n = value as number;
    if (Number.isNaN(n)) {
      return false;
    }
    if (this.options.rangeMin !== undefined && n < this.options.rangeMin) {
      return false;
    }
    if (this.options.rangeMax !== undefined && n > this.options.rangeMax) {
      return false;
    }
    return true;
  }
}

export interface NumberArrayValidatorOptions extends ParamArrayValidatorOptions<number> {
  rangeMin?: number;
  rangeMax?: number;
}

export class NumberArrayValidator extends ParamValidator<number[], NumberArrayValidatorOptions> {
  protected preprocessValue(value: unknown): unknown {
    return Array.isArray(value) ? value : [value];
  }
  protected testValue(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    if (
      (this.options.arrayLengthMin !== undefined && value.length < this.options.arrayLengthMin) ||
      (this.options.arrayLengthMax !== undefined && value.length > this.options.arrayLengthMax)
    ) {
      return false;
    }
    const isTestMin = this.options.rangeMin !== undefined;
    const isTestMax = this.options.rangeMax !== undefined;
    for (let i = 0; i < value.length; i++) {
      const n = Number(value[i]);
      if (Number.isNaN(n)) {
        return false;
      }
      if ((isTestMin && n < this.options.rangeMin) || (isTestMax && n > this.options.rangeMax)) {
        return false;
      }
      value[i] = n;
    }
    return true;
  }
}

export class IntValidator extends ParamValidator<number, NumberValidatorOptions> {
  protected preprocessValue(value: unknown): unknown {
    return value !== undefined ? Number(value) : value;
  }
  protected testValue(value: unknown): boolean {
    const n = value as number;
    if (Number.isNaN(n)) {
      return false;
    }
    if (n !== (n | 0)) {
      return false;
    }
    if (this.options.rangeMin !== undefined && n < this.options.rangeMin) {
      return false;
    }
    if (this.options.rangeMax !== undefined && n > this.options.rangeMax) {
      return false;
    }
    return true;
  }
}

export class IntArrayValidator extends ParamValidator<number[], NumberArrayValidatorOptions> {
  protected preprocessValue(value: unknown): unknown {
    return Array.isArray(value) ? value : [value];
  }
  protected testValue(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    if (
      (this.options.arrayLengthMin !== undefined && value.length < this.options.arrayLengthMin) ||
      (this.options.arrayLengthMax !== undefined && value.length > this.options.arrayLengthMax)
    ) {
      return false;
    }
    const shouldTestMin = this.options.rangeMin !== undefined;
    const shouldTestMax = this.options.rangeMax !== undefined;
    for (let i = 0; i < value.length; i++) {
      const n = Number(value[i]);
      if (Number.isNaN(n)) {
        return false;
      }
      if (n !== (n | 0)) {
        return false;
      }
      if ((shouldTestMin && n < this.options.rangeMin) || (shouldTestMax && n > this.options.rangeMax)) {
        return false;
      }
      value[i] = n;
    }
    return true;
  }
}

export interface StringValidatorOptions extends ParamValidatorOptions<string> {
  lengthMin?: number;
  lengthMax?: number;
}

export class StringValidator extends ParamValidator<string, StringValidatorOptions> {
  protected preprocessValue(value: unknown): unknown {
    return value;
  }
  protected testValue(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    if (this.options.lengthMin !== undefined && value.length < this.options.lengthMin) {
      return false;
    }
    if (this.options.lengthMax !== undefined && value.length > this.options.lengthMax) {
      return false;
    }
    return true;
  }
}

export interface StringArrayValidatorOptions extends ParamArrayValidatorOptions<string> {
  lengthMin?: number;
  lengthMax?: number;
}

export class StringArrayValidator extends ParamValidator<string[], StringArrayValidatorOptions> {
  protected preprocessValue(value: unknown): unknown {
    return Array.isArray(value) ? value : [value];
  }
  protected testValue(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    if (
      (this.options.arrayLengthMin !== undefined && value.length < this.options.arrayLengthMin) ||
      (this.options.arrayLengthMax !== undefined && value.length > this.options.arrayLengthMax)
    ) {
      return false;
    }
    const shouldTestMin = this.options.lengthMin !== undefined;
    const shouldTestMax = this.options.lengthMax !== undefined;
    for (const val of value) {
      if (typeof val !== 'string') {
        return false;
      }
      if (
        (shouldTestMin && val.length < this.options.lengthMin) ||
        (shouldTestMax && val.length > this.options.lengthMax)
      ) {
        return false;
      }
    }
    return true;
  }
}

export class ObjectValidator extends ParamValidator<object, ParamValidatorOptions<object>> {
  protected preprocessValue(value: unknown): unknown {
    return value;
  }
  protected testValue(value: unknown): boolean {
    const prototype = Object.getPrototypeOf(value);
    return (
      prototype === null || prototype === Object.getPrototypeOf({}) || prototype === Object.getPrototypeOf([])
    );
  }
}

export class ObjectArrayValidator extends ParamValidator<object[], ParamArrayValidatorOptions<object>> {
  protected preprocessValue(value: unknown): unknown {
    return Array.isArray(value) ? value : [value];
  }
  protected testValue(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    if (
      (this.options.arrayLengthMin !== undefined && value.length < this.options.arrayLengthMin) ||
      (this.options.arrayLengthMax !== undefined && value.length > this.options.arrayLengthMax)
    ) {
      return false;
    }
    for (const val of value) {
      const prototype = Object.getPrototypeOf(val);
      if (prototype !== null && prototype !== Object.getPrototypeOf({})) {
        return false;
      }
    }
    return true;
  }
}
