import { SerializedEditableMesh } from '../mesh/EditableMesh';
import { SceneObjectData } from '../project/types';
import { evaluateBevelModifier } from './bevelModifier';
import { evaluateMirrorModifier } from './mirrorModifier';
import { evaluateSolidifyModifier } from './solidifyModifier';
import { evaluateSubdivisionModifier } from './subdivisionModifier';
import {
  ModifierDiagnostic,
  ModifierEvaluationResult,
  ModifierSlot,
  ModifierTransformRef,
  normalizeBevelParams,
  normalizeMirrorParams,
  normalizeSolidifyParams,
  normalizeSubdivisionParams,
} from './types';

const MAX_CACHE_ENTRIES = 64;

const meshIdentityMap = new WeakMap<SerializedEditableMesh, number>();
let nextMeshIdentityId = 1;

function getMeshIdentityId(mesh: SerializedEditableMesh): number {
  let id = meshIdentityMap.get(mesh);
  if (id === undefined) {
    id = nextMeshIdentityId++;
    meshIdentityMap.set(mesh, id);
  }
  return id;
}

const evaluationCache = new Map<string, ModifierEvaluationResult>();

function touchLruCache(key: string, value: ModifierEvaluationResult): void {
  if (evaluationCache.has(key)) {
    evaluationCache.delete(key);
  } else if (evaluationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = evaluationCache.keys().next().value;
    if (oldestKey !== undefined) {
      evaluationCache.delete(oldestKey);
    }
  }
  evaluationCache.set(key, value);
}

export function clearModifierEvaluationCache(): void {
  evaluationCache.clear();
}

export function hasActiveViewportModifiers(modifiers?: ModifierSlot[]): boolean {
  if (!modifiers || modifiers.length === 0) return false;
  return modifiers.some((m) => m.enabled && m.showInViewport !== false);
}

export function buildTransformRefsFromObjects(
  objects: SceneObjectData[],
): ModifierTransformRef[] {
  return objects.map((o) => ({
    id: o.id,
    position: o.transform.position,
    rotation: o.transform.rotation,
    scale: o.transform.scale,
  }));
}

function buildModifierCacheKey(
  baseMesh: SerializedEditableMesh,
  modifiers: ModifierSlot[],
  ownerTransform?: ModifierTransformRef,
  sceneTransformRefs?: ModifierTransformRef[],
  stopAtModifierId?: string,
  isApplying = false,
): string {
  const baseId = getMeshIdentityId(baseMesh);
  const referencedMirrorIds = new Set<string>();
  const activeSpecs: Array<{
    id: string;
    type: string;
    enabled: boolean;
    showInViewport: boolean;
    params: unknown;
  }> = [];

  for (const mod of modifiers) {
    const isTarget = Boolean(stopAtModifierId && mod.id === stopAtModifierId);
    const shouldInclude = isApplying
      ? mod.enabled || isTarget
      : mod.enabled && mod.showInViewport !== false;

    if (shouldInclude) {
      if (mod.type === 'mirror') {
        const p = normalizeMirrorParams(mod.params);
        if (p.mirrorObjectId) referencedMirrorIds.add(p.mirrorObjectId);
        activeSpecs.push({
          id: mod.id,
          type: mod.type,
          enabled: true,
          showInViewport: mod.showInViewport !== false,
          params: p,
        });
      } else if (mod.type === 'subdivision') {
        activeSpecs.push({
          id: mod.id,
          type: mod.type,
          enabled: true,
          showInViewport: mod.showInViewport !== false,
          params: normalizeSubdivisionParams(mod.params),
        });
      } else if (mod.type === 'solidify') {
        activeSpecs.push({
          id: mod.id,
          type: mod.type,
          enabled: true,
          showInViewport: mod.showInViewport !== false,
          params: normalizeSolidifyParams(mod.params),
        });
      } else if (mod.type === 'bevel') {
        activeSpecs.push({
          id: mod.id,
          type: mod.type,
          enabled: true,
          showInViewport: mod.showInViewport !== false,
          params: normalizeBevelParams(mod.params),
        });
      }
    }

    if (isTarget) break;
  }

  const relevantRefs: ModifierTransformRef[] = [];
  if (referencedMirrorIds.size > 0 && sceneTransformRefs) {
    for (const ref of sceneTransformRefs) {
      if (referencedMirrorIds.has(ref.id)) {
        relevantRefs.push(ref);
      }
    }
  }

  return JSON.stringify({
    baseId,
    isApplying,
    stopAtModifierId: stopAtModifierId ?? null,
    mods: activeSpecs,
    owner: referencedMirrorIds.size > 0 ? ownerTransform ?? null : null,
    refs: relevantRefs,
  });
}

export function evaluateObjectModifiers(
  baseMesh: SerializedEditableMesh,
  modifiers: ModifierSlot[] = [],
  options: {
    ownerTransform?: ModifierTransformRef;
    sceneTransformRefs?: ModifierTransformRef[];
    stopAtModifierId?: string;
    isApplying?: boolean;
  } = {},
): ModifierEvaluationResult {
  const isApplying = Boolean(options.isApplying);

  if (!modifiers || modifiers.length === 0) {
    return {
      mesh: baseMesh,
      diagnostics: {},
      hasActiveModifiers: false,
      fromCache: false,
    };
  }

  const cacheKey = buildModifierCacheKey(
    baseMesh,
    modifiers,
    options.ownerTransform,
    options.sceneTransformRefs,
    options.stopAtModifierId,
    isApplying,
  );
  const cached = evaluationCache.get(cacheKey);
  if (cached) {
    touchLruCache(cacheKey, cached);
    return { ...cached, fromCache: true };
  }

  let currentMesh = baseMesh;
  const diagnostics: Record<string, ModifierDiagnostic> = {};
  let appliedCount = 0;

  for (const mod of modifiers) {
    const isTarget = Boolean(
      options.stopAtModifierId && mod.id === options.stopAtModifierId,
    );
    const shouldRun = isApplying
      ? mod.enabled || isTarget
      : mod.enabled && mod.showInViewport !== false;

    if (!shouldRun) {
      if (isTarget) break;
      continue;
    }

    if (mod.type === 'mirror') {
      const res = evaluateMirrorModifier(currentMesh, mod.params, mod.id, {
        ownerTransform: options.ownerTransform,
        sceneTransformRefs: options.sceneTransformRefs,
        isApplying,
      });
      currentMesh = res.mesh;
      diagnostics[mod.id] = res.diagnostic;
      appliedCount++;
    } else if (mod.type === 'subdivision') {
      const res = evaluateSubdivisionModifier(currentMesh, mod.params, mod.id, {
        isApplying,
      });
      diagnostics[mod.id] = res.diagnostic;
      if (res.diagnostic.status !== 'error') {
        currentMesh = res.mesh;
        appliedCount++;
      } else if (isApplying) {
        // On apply failure, preserve current mesh and stop immediately
        const errResult: ModifierEvaluationResult = {
          mesh: baseMesh,
          diagnostics,
          hasActiveModifiers: appliedCount > 0,
          fromCache: false,
        };
        return errResult;
      }
    } else if (mod.type === 'solidify') {
      const res = evaluateSolidifyModifier(currentMesh, mod.params, mod.id, {
        isApplying,
      });
      diagnostics[mod.id] = res.diagnostic;
      if (res.diagnostic.status !== 'error') {
        currentMesh = res.mesh;
        appliedCount++;
      } else if (isApplying) {
        return {
          mesh: baseMesh,
          diagnostics,
          hasActiveModifiers: appliedCount > 0,
          fromCache: false,
        };
      }
    } else if (mod.type === 'bevel') {
      const res = evaluateBevelModifier(currentMesh, mod.params, mod.id, {
        isApplying,
      });
      diagnostics[mod.id] = res.diagnostic;
      if (res.diagnostic.status !== 'error') {
        currentMesh = res.mesh;
        appliedCount++;
      } else if (isApplying) {
        return {
          mesh: baseMesh,
          diagnostics,
          hasActiveModifiers: appliedCount > 0,
          fromCache: false,
        };
      }
    }

    if (isTarget) break;
  }

  const result: ModifierEvaluationResult = {
    mesh: currentMesh,
    diagnostics,
    hasActiveModifiers: appliedCount > 0,
    fromCache: false,
  };
  touchLruCache(cacheKey, result);
  return result;
}

export interface ApplyModifierResult {
  success: boolean;
  mesh?: SerializedEditableMesh;
  remainingModifiers?: ModifierSlot[];
  diagnostic?: ModifierDiagnostic;
  error?: string;
}

export function applySingleModifierToMesh(
  baseMesh: SerializedEditableMesh,
  modifiers: ModifierSlot[],
  targetModifierId: string,
  ownerTransform?: ModifierTransformRef,
  sceneTransformRefs?: ModifierTransformRef[],
): ApplyModifierResult {
  const targetIdx = modifiers.findIndex((m) => m.id === targetModifierId);
  if (targetIdx < 0) {
    return { success: false, error: 'Modificador no encontrado.' };
  }

  const evalRes = evaluateObjectModifiers(baseMesh, modifiers, {
    ownerTransform,
    sceneTransformRefs,
    stopAtModifierId: targetModifierId,
    isApplying: true,
  });

  // Check if any evaluated modifier up to target reported a blocking error
  for (let i = 0; i <= targetIdx; i++) {
    const mod = modifiers[i];
    const diag = evalRes.diagnostics[mod.id];
    if (diag && diag.status === 'error') {
      return {
        success: false,
        diagnostic: diag,
        error:
          diag.message ??
          'No se puede aplicar el modificador por errores de topología.',
      };
    }
  }

  const targetDiag = evalRes.diagnostics[targetModifierId];
  // Remove modifiers baked into base mesh (enabled modifiers before target + target itself)
  const remainingModifiers = modifiers.filter((mod, idx) => {
    if (idx === targetIdx) return false;
    if (idx < targetIdx && mod.enabled) return false;
    return true;
  });

  return {
    success: true,
    mesh: evalRes.mesh,
    remainingModifiers,
    diagnostic: targetDiag,
  };
}

/**
 * Returns cloned SceneObjectData entries with active modifiers baked for temporary export
 * (OBJ / STL), never mutating the underlying project objects.
 */
export function evaluateObjectsForExport(
  targets: SceneObjectData[],
  allSceneObjects: SceneObjectData[],
): SceneObjectData[] {
  const refs = buildTransformRefsFromObjects(allSceneObjects);
  return targets.map((obj) => {
    if (
      obj.objectType !== 'mesh' ||
      !obj.modifiers ||
      obj.modifiers.length === 0
    ) {
      return obj;
    }
    const owner: ModifierTransformRef = {
      id: obj.id,
      position: obj.transform.position,
      rotation: obj.transform.rotation,
      scale: obj.transform.scale,
    };
    const res = evaluateObjectModifiers(obj.mesh, obj.modifiers, {
      ownerTransform: owner,
      sceneTransformRefs: refs,
      isApplying: true,
    });
    if (!res.hasActiveModifiers) return obj;
    return {
      ...obj,
      mesh: res.mesh,
      modifiers: [],
    };
  });
}
