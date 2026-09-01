type Vector3Tuple = [number, number, number];

export type ObjColor = [number, number, number, number];

export type ObjPosition = {
  value: Vector3Tuple;
  color?: ObjColor;
};

export type ObjFaceVertex = {
  position: number;
  texCoord: number;
  normal: number;
};

export type ObjTriangle = {
  vertices: [ObjFaceVertex, ObjFaceVertex, ObjFaceVertex];
  objectName: string;
  groupName: string;
  materialName: string | null;
  smoothingGroup: string | null;
  faceIndex: number;
};

export type ObjGroup = {
  key: string;
  name: string;
  materialName: string | null;
  triangles: ObjTriangle[];
};

export type ObjDocument = {
  positions: ObjPosition[];
  texCoords: [number, number, number][];
  normals: Vector3Tuple[];
  mtllibs: string[];
  groups: ObjGroup[];
};

export type ObjTextureMap = {
  path: string;
  scale: [number, number, number];
  offset: [number, number, number];
  bumpScale?: number;
  clamp?: boolean;
};

export type ObjMaterial = {
  name: string;
  diffuse: [number, number, number];
  specular: [number, number, number];
  emissive: [number, number, number];
  shininess: number;
  opacity: number;
  ior: number;
  diffuseMap?: ObjTextureMap;
  specularMap?: ObjTextureMap;
  normalMap?: ObjTextureMap;
  emissiveMap?: ObjTextureMap;
  alphaMap?: ObjTextureMap;
  metallic?: number;
  roughness?: number;
};

function stripComment(line: string) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === '#' && !quoted) {
      return line.slice(0, i);
    }
  }
  return line;
}

function tokenize(line: string) {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function parseNumber(value: string | undefined, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizeColor(values: number[]): ObjColor {
  const scale = values.slice(0, 3).some((value) => Math.abs(value) > 1) ? 1 / 255 : 1;
  const alpha = values[3] ?? 1;
  return [
    Math.max(0, Math.min(1, values[0] * scale)),
    Math.max(0, Math.min(1, values[1] * scale)),
    Math.max(0, Math.min(1, values[2] * scale)),
    Math.max(0, Math.min(1, alpha > 1 ? alpha / 255 : alpha))
  ];
}

function resolveIndex(value: string, count: number, label: string) {
  const index = Number.parseInt(value, 10);
  if (!Number.isInteger(index) || index === 0) {
    throw new Error(`Invalid OBJ ${label} index: ${value}`);
  }
  const resolved = index < 0 ? count + index : index - 1;
  if (resolved < 0 || resolved >= count) {
    throw new Error(`OBJ ${label} index out of range: ${value}`);
  }
  return resolved;
}

function parseFaceVertex(value: string, positionCount: number, texCoordCount: number, normalCount: number) {
  const parts = value.split('/');
  const position = resolveIndex(parts[0], positionCount, 'position');
  const texCoord =
    parts.length > 1 && parts[1] !== '' ? resolveIndex(parts[1], texCoordCount, 'texture coordinate') : -1;
  const normal = parts.length > 2 && parts[2] !== '' ? resolveIndex(parts[2], normalCount, 'normal') : -1;
  return { position, texCoord, normal };
}

function getGroupName(objectName: string, groupName: string) {
  if (objectName && groupName) {
    return `${objectName}/${groupName}`;
  }
  return objectName || groupName || 'Object';
}

function parseLines(source: string) {
  const lines: string[] = [];
  let continued = '';
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed.endsWith('\\')) {
      continued += `${trimmed.slice(0, -1)} `;
    } else {
      lines.push(continued + trimmed);
      continued = '';
    }
  }
  if (continued) {
    lines.push(continued);
  }
  return lines;
}

function parseTextureMap(value: string): ObjTextureMap | undefined {
  const tokens = tokenize(value);
  if (tokens.length === 0) {
    return undefined;
  }
  const scale: [number, number, number] = [1, 1, 1];
  const offset: [number, number, number] = [0, 0, 0];
  let bumpScale: number | undefined;
  let clamp: boolean | undefined;
  const filename: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase();
    if (token === '-s' || token === '-o' || token === '-t') {
      const values: number[] = [];
      while (values.length < 3 && i + 1 < tokens.length && Number.isFinite(Number(tokens[i + 1]))) {
        values.push(parseNumber(tokens[++i]));
      }
      if (values.length === 0) {
        continue;
      }
      if (token === '-s') {
        scale[0] = values[0];
        scale[1] = values[1] ?? 1;
        scale[2] = values[2] ?? 1;
      } else if (token === '-o') {
        offset[0] = values[0];
        offset[1] = values[1] ?? 0;
        offset[2] = values[2] ?? 0;
      }
      continue;
    }
    if (token === '-clamp' && i + 1 < tokens.length) {
      clamp = tokens[++i].toLowerCase() === 'on';
      continue;
    }
    if (token === '-bm' && i + 1 < tokens.length) {
      bumpScale = parseNumber(tokens[++i], 1);
      continue;
    }
    const optionArgCount: Record<string, number> = {
      '-blendu': 1,
      '-blendv': 1,
      '-boost': 1,
      '-cc': 1,
      '-imfchan': 1,
      '-mm': 2,
      '-texres': 1,
      '-type': 1
    };
    const argCount = optionArgCount[token];
    if (argCount !== undefined) {
      i += Math.min(argCount, tokens.length - i - 1);
      continue;
    }
    if (!token.startsWith('-')) {
      filename.push(tokens[i]);
    }
  }
  const path = filename.join(' ').trim();
  return path ? { path, scale, offset, bumpScale, clamp } : undefined;
}

function createMaterial(name: string): ObjMaterial {
  return {
    name,
    diffuse: [0.8, 0.8, 0.8],
    specular: [0, 0, 0],
    emissive: [0, 0, 0],
    shininess: 0,
    opacity: 1,
    ior: 1.5
  };
}

/**
 * Parses a Wavefront MTL document.
 *
 * @param source - MTL source text.
 * @returns Materials indexed by their `newmtl` name.
 * @public
 */
export function parseMtl(source: string): Map<string, ObjMaterial> {
  const materials = new Map<string, ObjMaterial>();
  let current: ObjMaterial | null = null;
  for (const rawLine of parseLines(source)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const separator = line.search(/\s/);
    const keyword = (separator < 0 ? line : line.slice(0, separator)).toLowerCase();
    const value = separator < 0 ? '' : line.slice(separator).trim();
    const tokens = tokenize(value);
    if (keyword === 'newmtl') {
      const name = value.trim();
      current = name ? createMaterial(name) : null;
      if (current) {
        materials.set(name, current);
      }
      continue;
    }
    if (!current) {
      continue;
    }
    switch (keyword) {
      case 'kd':
        current.diffuse = [
          parseNumber(tokens[0], current.diffuse[0]),
          parseNumber(tokens[1], current.diffuse[1]),
          parseNumber(tokens[2], current.diffuse[2])
        ];
        break;
      case 'ks':
        current.specular = [
          parseNumber(tokens[0], current.specular[0]),
          parseNumber(tokens[1], current.specular[1]),
          parseNumber(tokens[2], current.specular[2])
        ];
        break;
      case 'ke':
        current.emissive = [
          parseNumber(tokens[0], current.emissive[0]),
          parseNumber(tokens[1], current.emissive[1]),
          parseNumber(tokens[2], current.emissive[2])
        ];
        break;
      case 'ns':
        current.shininess = Math.max(0, parseNumber(tokens[0], current.shininess));
        break;
      case 'd':
        current.opacity = Math.max(0, Math.min(1, parseNumber(tokens[0], current.opacity)));
        break;
      case 'tr':
        current.opacity = 1 - Math.max(0, Math.min(1, parseNumber(tokens[0], 0)));
        break;
      case 'ni':
        current.ior = Math.max(1, parseNumber(tokens[0], current.ior));
        break;
      case 'pm':
        current.metallic = Math.max(0, Math.min(1, parseNumber(tokens[0])));
        break;
      case 'pr':
        current.roughness = Math.max(0, Math.min(1, parseNumber(tokens[0])));
        break;
      case 'map_kd':
        current.diffuseMap = parseTextureMap(value);
        break;
      case 'map_ks':
        current.specularMap = parseTextureMap(value);
        break;
      case 'map_ke':
        current.emissiveMap = parseTextureMap(value);
        break;
      case 'map_d':
      case 'map_opacity':
        current.alphaMap = parseTextureMap(value);
        break;
      case 'bump':
      case 'map_bump':
      case 'map_normal':
      case 'norm':
        current.normalMap = parseTextureMap(value);
        break;
    }
  }
  return materials;
}

/**
 * Parses a Wavefront OBJ document.
 *
 * Faces are triangulated with a fan. Position, texture-coordinate and normal
 * indices are resolved during parsing, including negative relative indices.
 *
 * @param source - OBJ source text.
 * @returns Parsed OBJ data.
 * @public
 */
export function parseObj(source: string): ObjDocument {
  const positions: ObjPosition[] = [];
  const texCoords: [number, number, number][] = [];
  const normals: Vector3Tuple[] = [];
  const mtllibs: string[] = [];
  const groups: ObjGroup[] = [];
  const groupsByKey = new Map<string, ObjGroup>();
  let objectName = '';
  let groupName = '';
  let materialName: string | null = null;
  let smoothingGroup: string | null = null;
  let faceIndex = 0;

  const getOrCreateGroup = () => {
    const key = `${objectName}\0${groupName}\0${materialName ?? ''}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        key,
        name: getGroupName(objectName, groupName),
        materialName,
        triangles: []
      };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    return group;
  };

  for (const rawLine of parseLines(source)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const separator = line.search(/\s/);
    const keyword = (separator < 0 ? line : line.slice(0, separator)).toLowerCase();
    const value = separator < 0 ? '' : line.slice(separator).trim();
    const tokens = tokenize(value);
    switch (keyword) {
      case 'v': {
        if (tokens.length < 3) {
          continue;
        }
        const values = tokens.map((token) => parseNumber(token));
        const w = values.length >= 7 ? values[3] || 1 : 1;
        const offset = values.length >= 7 ? 4 : 3;
        const position: ObjPosition = {
          value: [values[0] / w, values[1] / w, values[2] / w]
        };
        if (values.length >= offset + 3) {
          position.color = normalizeColor(values.slice(offset, offset + 4));
        }
        positions.push(position);
        break;
      }
      case 'vt':
        if (tokens.length >= 1) {
          texCoords.push([parseNumber(tokens[0]), parseNumber(tokens[1]), parseNumber(tokens[2])]);
        }
        break;
      case 'vn':
        if (tokens.length >= 3) {
          normals.push([parseNumber(tokens[0]), parseNumber(tokens[1]), parseNumber(tokens[2])]);
        }
        break;
      case 'f': {
        if (tokens.length < 3) {
          continue;
        }
        const vertices = tokens.map((token) =>
          parseFaceVertex(token, positions.length, texCoords.length, normals.length)
        );
        const group = getOrCreateGroup();
        for (let i = 1; i < vertices.length - 1; i++) {
          group.triangles.push({
            vertices: [vertices[0], vertices[i], vertices[i + 1]],
            objectName,
            groupName,
            materialName,
            smoothingGroup,
            faceIndex
          });
        }
        faceIndex++;
        break;
      }
      case 'o':
        objectName = value;
        break;
      case 'g':
        groupName = tokens.join(' ');
        break;
      case 'usemtl':
        materialName = value || null;
        break;
      case 'mtllib':
        mtllibs.push(...tokens);
        break;
      case 's': {
        const smoothing = value.toLowerCase();
        smoothingGroup = !smoothing || smoothing === 'off' || smoothing === '0' ? null : value;
        break;
      }
    }
  }
  return { positions, texCoords, normals, mtllibs, groups };
}
