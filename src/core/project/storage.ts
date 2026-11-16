import {
  createDefaultScene,
  createDefaultSceneObject as createDefaultHierarchyObject,
  createHierarchyId,
  normalizeProjectHierarchy,
} from './hierarchy';
import {
  cloneDefaultRadialLayouts,
  DEFAULT_RADIAL_LAYOUTS,
  normalizeRadialSlotList,
} from '../radial/radialActions';
import {
  DEFAULT_PROPORTIONAL_EDITING_SETTINGS,
  normalizeProportionalSettings,
} from '../mesh/proportionalEditing';
import {
  ModelerSettings,
  ProjectData,
  ProjectSummary,
  SceneObjectData,
  TouchControlSettings,
  TouchModifierSettings,
  ViewportDisplayMode,
} from './types';

const INDEX_KEY = 'forma3d_projects_index_v1';
const PROJECT_PREFIX = 'forma3d_project_v1_';
const ACTIVE_PROJECT_KEY = 'forma3d_active_project_v1';
const SETTINGS_KEY = 'forma3d_settings_v1';

export const DEFAULT_TOUCH_MODIFIERS: TouchModifierSettings = {
  shift: {
    enabled: true,
    twoFingerHold: true,
    showScreenButton: true,
  },
  ctrl: {
    enabled: true,
    twoFingerHold: false,
    showScreenButton: true,
  },
  alt: {
    enabled: true,
    twoFingerHold: false,
    showScreenButton: true,
  },
};

export function createDefaultTouchSettings(): TouchControlSettings {
  return {
    oneFingerOrbit: true,
    oneFingerTapSelect: true,
    doubleTapBoxSelect: true,
    doubleTapIntervalMs: 320,
    twoFingerPinchZoom: true,
    twoFingerPan: true,
    twoFingerUndo: true,
    threeFingerRedo: true,
    longPressContextMenu: true,
    floatingMenuEnabled: true,
    floatingMenuCorner: 'bottom-right',
    floatingMenuSize: 'medium',
    floatingMenuCustomPos: null,
    modifierPanelEnabled: true,
    modifierPanelMode: 'toggle',
    modifiers: {
      shift: { ...DEFAULT_TOUCH_MODIFIERS.shift },
      ctrl: { ...DEFAULT_TOUCH_MODIFIERS.ctrl },
      alt: { ...DEFAULT_TOUCH_MODIFIERS.alt },
    },
    radialLayouts: cloneDefaultRadialLayouts(),
  };
}

export const DEFAULT_TOUCH_SETTINGS: TouchControlSettings =
  createDefaultTouchSettings();

export const DEFAULT_MODELER_SETTINGS: ModelerSettings = {
  displayMode: 'solid',
  xrayTransparency: 50,
  showFaceOrientation: false,
  showGrid: true,
  showAxes: true,
  xrayEditMode: false,
  gizmoSize: 1.25,
  snapEnabled: false,
  snapTranslateStep: 0.25,
  snapRotateDeg: 15,
  snapScaleStep: 0.1,
  multiSelectTouch: false,
  proportionalEditing: { ...DEFAULT_PROPORTIONAL_EDITING_SETTINGS },
  touch: createDefaultTouchSettings(),
};

export function normalizeTouchSettings(
  rawTouch?: Partial<TouchControlSettings> | null,
): TouchControlSettings {
  const base = createDefaultTouchSettings();
  if (!rawTouch) return base;
  const rawInterval =
    typeof rawTouch.doubleTapIntervalMs === 'number' &&
    !Number.isNaN(rawTouch.doubleTapIntervalMs)
      ? Math.max(180, Math.min(600, Math.round(rawTouch.doubleTapIntervalMs)))
      : base.doubleTapIntervalMs;
  const isLegacyModifierSchema = rawTouch.modifierPanelEnabled === undefined;
  return {
    ...base,
    ...rawTouch,
    doubleTapBoxSelect: rawTouch.doubleTapBoxSelect !== false,
    doubleTapIntervalMs: rawInterval,
    modifierPanelEnabled: rawTouch.modifierPanelEnabled !== false,
    modifierPanelMode: rawTouch.modifierPanelMode === 'hold' ? 'hold' : 'toggle',
    modifiers: {
      shift: {
        ...base.modifiers.shift,
        ...(rawTouch.modifiers?.shift ?? {}),
      },
      ctrl: isLegacyModifierSchema
        ? { ...base.modifiers.ctrl }
        : {
            ...base.modifiers.ctrl,
            ...(rawTouch.modifiers?.ctrl ?? {}),
          },
      alt: isLegacyModifierSchema
        ? { ...base.modifiers.alt }
        : {
            ...base.modifiers.alt,
            ...(rawTouch.modifiers?.alt ?? {}),
          },
    },
    radialLayouts: {
      object: normalizeRadialSlotList(
        rawTouch.radialLayouts?.object,
        DEFAULT_RADIAL_LAYOUTS.object,
      ),
      edit: normalizeRadialSlotList(
        rawTouch.radialLayouts?.edit,
        DEFAULT_RADIAL_LAYOUTS.edit,
      ),
      sculpt: normalizeRadialSlotList(
        rawTouch.radialLayouts?.sculpt,
        DEFAULT_RADIAL_LAYOUTS.sculpt,
      ),
    },
  };
}

function normalizeDisplayMode(
  mode: unknown,
  legacyXray?: boolean,
): ViewportDisplayMode {
  if (mode === 'wireframe' || mode === 'solid' || mode === 'xray') {
    return mode;
  }
  if (mode === 'material') {
    // Material preview is reserved for a future material system update
    return 'solid';
  }
  return legacyXray ? 'xray' : 'solid';
}

function normalizeXrayTransparency(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_MODELER_SETTINGS.xrayTransparency;
  }
  return Math.max(10, Math.min(90, Math.round(value)));
}

export function loadSettingsLocally(): ModelerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_MODELER_SETTINGS,
        touch: createDefaultTouchSettings(),
      };
    }
    const parsed = JSON.parse(raw) as Partial<ModelerSettings>;
    const displayMode = normalizeDisplayMode(
      parsed.displayMode,
      parsed.xrayEditMode,
    );
    return {
      ...DEFAULT_MODELER_SETTINGS,
      ...parsed,
      displayMode,
      xrayEditMode: displayMode === 'xray',
      xrayTransparency: normalizeXrayTransparency(parsed.xrayTransparency),
      showFaceOrientation: Boolean(parsed.showFaceOrientation),
      proportionalEditing: normalizeProportionalSettings(
        parsed.proportionalEditing,
      ),
      touch: normalizeTouchSettings(parsed.touch),
    };
  } catch {
    return {
      ...DEFAULT_MODELER_SETTINGS,
      proportionalEditing: { ...DEFAULT_PROPORTIONAL_EDITING_SETTINGS },
      touch: createDefaultTouchSettings(),
    };
  }
}

export function saveSettingsLocally(settings: ModelerSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

/**
 * Future-ready exporter interface for OBJ, STL, GLB formats.
 */
export interface MeshExporter {
  readonly format: 'obj' | 'stl' | 'glb';
  readonly extension: string;
  readonly mimeType: string;
  exportScene(project: ProjectData): Promise<Blob>;
}

export function generateId(prefix: string): string {
  return createHierarchyId(prefix);
}

export function createDefaultSceneObject(collectionId = 'col_default'): SceneObjectData {
  return createDefaultHierarchyObject(collectionId);
}

export function createNewProject(name = 'Proyecto Sin Título'): ProjectData {
  const now = Date.now();
  const initialScene = createDefaultScene('Scene', true);
  return {
    version: 2,
    coordinateSystem: 'z-up',
    id: generateId('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    activeSceneId: initialScene.id,
    scenes: [initialScene],
  };
}

export function listSavedProjects(): ProjectSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectSummary[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

const IDB_NAME = 'forma3d_projects_db_v1';
const IDB_STORE = 'projects';

function openProjectsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveProjectToIndexedDb(project: ProjectData): Promise<void> {
  const db = await openProjectsDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadProjectFromIndexedDb(
  projectId: string,
): Promise<ProjectData | null> {
  const db = await openProjectsDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(projectId);
      req.onsuccess = () => {
        const normalized = normalizeProjectHierarchy(req.result);
        resolve(normalized);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function deleteProjectFromIndexedDb(projectId: string): Promise<void> {
  const db = await openProjectsDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function saveProjectLocally(project: ProjectData): ProjectData {
  const updated: ProjectData = {
    ...project,
    version: 2,
    coordinateSystem: 'z-up',
    updatedAt: Date.now(),
  };

  try {
    localStorage.setItem(`${PROJECT_PREFIX}${updated.id}`, JSON.stringify(updated));
  } catch {
    // Project payload (e.g., high-resolution reference images or large meshes) may exceed localStorage quota.
    // Remove stale localStorage copy so IndexedDB remains authoritative for this project.
    try {
      localStorage.removeItem(`${PROJECT_PREFIX}${updated.id}`);
    } catch {
      // Ignore
    }
  }

  // Always persist full project (including embedded reference image data URLs) in IndexedDB
  void saveProjectToIndexedDb(updated);

  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, updated.id);
    const totalObjects = updated.scenes.reduce(
      (sum, scene) => sum + scene.objects.length,
      0,
    );
    const index = listSavedProjects().filter((p) => p.id !== updated.id);
    index.unshift({
      id: updated.id,
      name: updated.name,
      updatedAt: updated.updatedAt,
      objectCount: totalObjects,
    });
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Ignore metadata quota error
  }

  return updated;
}

export function loadProjectLocally(projectId: string): ProjectData | null {
  try {
    const raw = localStorage.getItem(`${PROJECT_PREFIX}${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeProjectHierarchy(parsed);
    if (!normalized) return null;
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    return normalized;
  } catch {
    return null;
  }
}

export async function loadProjectFromAnyStorage(
  projectId: string,
): Promise<ProjectData | null> {
  const fromIdb = await loadProjectFromIndexedDb(projectId);
  const fromLs = loadProjectLocally(projectId);
  if (fromIdb && fromLs) {
    return fromIdb.updatedAt >= fromLs.updatedAt ? fromIdb : fromLs;
  }
  const chosen = fromIdb ?? fromLs;
  if (chosen) {
    try {
      localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    } catch {
      // Ignore
    }
  }
  return chosen;
}

export function deleteProjectLocally(projectId: string): void {
  localStorage.removeItem(`${PROJECT_PREFIX}${projectId}`);
  void deleteProjectFromIndexedDb(projectId);
  const index = listSavedProjects().filter((p) => p.id !== projectId);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  if (localStorage.getItem(ACTIVE_PROJECT_KEY) === projectId) {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
}

export function getActiveStoredProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function loadInitialProject(): ProjectData {
  const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (activeId) {
    const loaded = loadProjectLocally(activeId);
    if (loaded) return loaded;
  }
  const list = listSavedProjects();
  if (list.length > 0) {
    const loaded = loadProjectLocally(list[0].id);
    if (loaded) return loaded;
  }
  const fresh = createNewProject('Escena Inicial');
  return saveProjectLocally(fresh);
}
