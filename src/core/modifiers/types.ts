import { SerializedEditableMesh, Vec3 } from '../mesh/EditableMesh';

export type ModifierType = 'mirror' | 'subdivision' | 'solidify' | 'bevel';

export interface MirrorAxisFlags {
  x: boolean;
  y: boolean;
  z: boolean;
}

export interface MirrorModifierParams {
  axes: MirrorAxisFlags;
  merge: boolean;
  mergeDistance: number;
  clipping: boolean;
  bisect: MirrorAxisFlags;
  flipBisect: MirrorAxisFlags;
  mirrorObjectId: string | null;
}

export type SubdivisionLevel = 0 | 1 | 2 | 3;

export interface SubdivisionModifierParams {
  levels: SubdivisionLevel;
}

export interface SolidifyModifierParams {
  thickness: number;
  offset: number;
  evenThickness: boolean;
  fillRim: boolean;
  onlyRim: boolean;
  clamp: number;
}

export type BevelLimitMethod = 'angle' | 'all' | 'weight';

export interface BevelModifierParams {
  amount: number;
  segments: number;
  limitMethod: BevelLimitMethod;
  angleLimit: number;
  clampOverlap: boolean;
  hardenNormals: boolean;
  profile: number;
}

export interface ModifierSlot {
  id: string;
  type: ModifierType | string;
  enabled: boolean;
  showInViewport?: boolean;
  expanded?: boolean;
  params:
    | MirrorModifierParams
    | SubdivisionModifierParams
    | SolidifyModifierParams
    | BevelModifierParams
    | Record<string, unknown>;
}

export interface ModifierDiagnostic {
  modifierId: string;
  type: ModifierType | string;
  status: 'ok' | 'warning' | 'error';
  code?:
    | 'ngons_detected'
    | 'triangles_present'
    | 'non_manifold'
    | 'degenerate_faces'
    | 'empty_mesh'
    | 'budget_exceeded'
    | 'level_3_warning'
    | 'inconsistent_winding'
    | 'normals_warning'
    | 'no_rim_edges'
    | 'no_bevel_edges'
    | 'no_edge_weights'
    | 'overlap_clamped'
    | 'degenerate_thickness';
  message?: string;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  ngonCount: number;
  triangleCount: number;
  nonManifoldEdges: number;
  budgetExceeded?: boolean;
}

export interface ModifierEvaluationResult {
  mesh: SerializedEditableMesh;
  diagnostics: Record<string, ModifierDiagnostic>;
  hasActiveModifiers: boolean;
  fromCache: boolean;
}

export interface ModifierTransformRef {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export const MODIFIER_LABELS: Record<ModifierType, string> = {
  mirror: 'Mirror (Espejo)',
  subdivision: 'Subdivision Surface',
  solidify: 'Solidify (Grosor)',
  bevel: 'Bevel (Bisel)',
};

export const TABLET_SUBDIV_MAX_LEVEL: SubdivisionLevel = 3;
export const TABLET_SUBDIV_FACE_BUDGET = 24_000;
export const TABLET_SOLIDIFY_FACE_BUDGET = 24_000;
export const TABLET_BEVEL_MAX_SEGMENTS = 6;
export const TABLET_BEVEL_FACE_BUDGET = 24_000;

export function createDefaultMirrorParams(): MirrorModifierParams {
  return {
    axes: { x: true, y: false, z: false },
    merge: true,
    mergeDistance: 0.005,
    clipping: false,
    bisect: { x: false, y: false, z: false },
    flipBisect: { x: false, y: false, z: false },
    mirrorObjectId: null,
  };
}

export function createDefaultSubdivisionParams(): SubdivisionModifierParams {
  return {
    levels: 1,
  };
}

export function createDefaultSolidifyParams(): SolidifyModifierParams {
  return {
    thickness: 0.2,
    offset: -1,
    evenThickness: true,
    fillRim: true,
    onlyRim: false,
    clamp: 0,
  };
}

export function createDefaultBevelParams(): BevelModifierParams {
  return {
    amount: 0.1,
    segments: 1,
    limitMethod: 'angle',
    angleLimit: 30,
    clampOverlap: true,
    hardenNormals: false,
    profile: 0.5,
  };
}

export function normalizeMirrorParams(raw?: unknown): MirrorModifierParams {
  const def = createDefaultMirrorParams();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<MirrorModifierParams>;
  const rawMergeDist =
    typeof r.mergeDistance === 'number' && Number.isFinite(r.mergeDistance)
      ? Math.max(0.0001, Math.min(0.5, r.mergeDistance))
      : def.mergeDistance;
  return {
    axes: {
      x: typeof r.axes?.x === 'boolean' ? r.axes.x : def.axes.x,
      y: typeof r.axes?.y === 'boolean' ? r.axes.y : def.axes.y,
      z: typeof r.axes?.z === 'boolean' ? r.axes.z : def.axes.z,
    },
    merge: typeof r.merge === 'boolean' ? r.merge : def.merge,
    mergeDistance: rawMergeDist,
    clipping: typeof r.clipping === 'boolean' ? r.clipping : def.clipping,
    bisect: {
      x: typeof r.bisect?.x === 'boolean' ? r.bisect.x : def.bisect.x,
      y: typeof r.bisect?.y === 'boolean' ? r.bisect.y : def.bisect.y,
      z: typeof r.bisect?.z === 'boolean' ? r.bisect.z : def.bisect.z,
    },
    flipBisect: {
      x:
        typeof r.flipBisect?.x === 'boolean'
          ? r.flipBisect.x
          : def.flipBisect.x,
      y:
        typeof r.flipBisect?.y === 'boolean'
          ? r.flipBisect.y
          : def.flipBisect.y,
      z:
        typeof r.flipBisect?.z === 'boolean'
          ? r.flipBisect.z
          : def.flipBisect.z,
    },
    mirrorObjectId:
      typeof r.mirrorObjectId === 'string' && r.mirrorObjectId
        ? r.mirrorObjectId
        : null,
  };
}

export function normalizeSubdivisionParams(
  raw?: unknown,
): SubdivisionModifierParams {
  const def = createDefaultSubdivisionParams();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<SubdivisionModifierParams>;
  const lvl =
    typeof r.levels === 'number' && Number.isFinite(r.levels)
      ? (Math.max(0, Math.min(3, Math.round(r.levels))) as SubdivisionLevel)
      : def.levels;
  return { levels: lvl };
}

export function normalizeSolidifyParams(
  raw?: unknown,
): SolidifyModifierParams {
  const def = createDefaultSolidifyParams();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<SolidifyModifierParams> & { clamp?: number | boolean };
  const thickness =
    typeof r.thickness === 'number' && Number.isFinite(r.thickness)
      ? Math.max(-5, Math.min(5, Number(r.thickness.toFixed(4))))
      : def.thickness;
  const offset =
    typeof r.offset === 'number' && Number.isFinite(r.offset)
      ? Math.max(-1, Math.min(1, Number(r.offset.toFixed(3))))
      : def.offset;
  let clamp = def.clamp;
  if (typeof r.clamp === 'number' && Number.isFinite(r.clamp)) {
    clamp = Math.max(0, Math.min(2, Number(r.clamp.toFixed(3))));
  } else if (typeof r.clamp === 'boolean') {
    clamp = r.clamp ? 1 : 0;
  }

  return {
    thickness,
    offset,
    evenThickness:
      typeof r.evenThickness === 'boolean'
        ? r.evenThickness
        : def.evenThickness,
    fillRim: typeof r.fillRim === 'boolean' ? r.fillRim : def.fillRim,
    onlyRim: typeof r.onlyRim === 'boolean' ? r.onlyRim : def.onlyRim,
    clamp,
  };
}

export function normalizeBevelParams(raw?: unknown): BevelModifierParams {
  const def = createDefaultBevelParams();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<BevelModifierParams>;
  const amount =
    typeof r.amount === 'number' && Number.isFinite(r.amount)
      ? Math.max(0, Math.min(2, Number(r.amount.toFixed(4))))
      : def.amount;
  const segments =
    typeof r.segments === 'number' && Number.isFinite(r.segments)
      ? Math.max(1, Math.min(TABLET_BEVEL_MAX_SEGMENTS, Math.round(r.segments)))
      : def.segments;
  const limitMethod: BevelLimitMethod =
    r.limitMethod === 'all' || r.limitMethod === 'weight'
      ? r.limitMethod
      : 'angle';
  const angleLimit =
    typeof r.angleLimit === 'number' && Number.isFinite(r.angleLimit)
      ? Math.max(0, Math.min(180, Number(r.angleLimit.toFixed(1))))
      : def.angleLimit;
  const profile =
    typeof r.profile === 'number' && Number.isFinite(r.profile)
      ? Math.max(0.05, Math.min(1, Number(r.profile.toFixed(3))))
      : def.profile;

  return {
    amount,
    segments,
    limitMethod,
    angleLimit,
    clampOverlap:
      typeof r.clampOverlap === 'boolean' ? r.clampOverlap : def.clampOverlap,
    hardenNormals:
      typeof r.hardenNormals === 'boolean'
        ? r.hardenNormals
        : def.hardenNormals,
    profile,
  };
}

export function normalizeModifierSlot(
  raw: unknown,
  fallbackId: string,
): ModifierSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ModifierSlot>;
  const type = typeof r.type === 'string' ? r.type : '';
  if (!type) return null;
  const id = typeof r.id === 'string' && r.id ? r.id : fallbackId;
  const enabled = typeof r.enabled === 'boolean' ? r.enabled : true;
  const showInViewport =
    typeof r.showInViewport === 'boolean' ? r.showInViewport : true;
  const expanded = typeof r.expanded === 'boolean' ? r.expanded : true;

  if (type === 'mirror') {
    return {
      id,
      type: 'mirror',
      enabled,
      showInViewport,
      expanded,
      params: normalizeMirrorParams(r.params),
    };
  }
  if (type === 'subdivision') {
    return {
      id,
      type: 'subdivision',
      enabled,
      showInViewport,
      expanded,
      params: normalizeSubdivisionParams(r.params),
    };
  }
  if (type === 'solidify') {
    return {
      id,
      type: 'solidify',
      enabled,
      showInViewport,
      expanded,
      params: normalizeSolidifyParams(r.params),
    };
  }
  if (type === 'bevel') {
    return {
      id,
      type: 'bevel',
      enabled,
      showInViewport,
      expanded,
      params: normalizeBevelParams(r.params),
    };
  }

  return {
    id,
    type,
    enabled,
    showInViewport,
    expanded,
    params:
      r.params && typeof r.params === 'object'
        ? { ...(r.params as Record<string, unknown>) }
        : {},
  };
}
