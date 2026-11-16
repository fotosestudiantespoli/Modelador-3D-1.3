import { SerializedEditableMesh, Vec3 } from '../mesh/EditableMesh';
import { PrimitiveType } from '../mesh/primitives';
import {
  ProportionalEditingSettings,
  ProportionalFalloff,
} from '../mesh/proportionalEditing';
import { RadialMenuLayouts } from '../radial/radialActions';

export type {
  ProportionalEditingSettings,
  ProportionalFalloff,
} from '../mesh/proportionalEditing';

export type WorkMode = 'object' | 'edit';
export type TransformTool = 'select' | 'move' | 'rotate' | 'scale';
export type AxisConstraint = 'free' | 'x' | 'y' | 'z';
export type CameraProjection = 'perspective' | 'orthographic';

export interface ObjectTransform {
  position: Vec3;
  rotation: Vec3; // Euler radians [x, y, z]
  scale: Vec3;
}

import type { ModifierSlot } from '../modifiers/types';
export type { ModifierSlot, ModifierType } from '../modifiers/types';

export interface MaterialSlot {
  color: string;
  roughness: number;
  metalness: number;
}

export type SceneObjectType =
  | 'mesh'
  | 'camera'
  | 'light'
  | 'empty'
  | 'reference_image';

export type ReferenceImageOrientation =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'free';

export type ReferenceImageDepthMode = 'back' | 'front';

export interface ReferenceImageData {
  imageDataUrl: string;
  fileName: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  opacity: number;
  orientation: ReferenceImageOrientation;
  depthMode: ReferenceImageDepthMode;
  aspectRatio: number;
}

export interface SceneObjectData {
  id: string;
  name: string;
  objectType: SceneObjectType;
  primitiveType: PrimitiveType | 'custom';
  collectionId: string;
  visible: boolean;
  locked: boolean;
  transform: ObjectTransform;
  mesh: SerializedEditableMesh;
  material: MaterialSlot;
  modifiers: ModifierSlot[];
  referenceImage?: ReferenceImageData;
}

export interface CollectionData {
  id: string;
  name: string;
  sceneId: string;
  parentId: string | null;
  expanded: boolean;
}

export interface SceneData {
  id: string;
  name: string;
  activeCollectionId: string;
  collections: CollectionData[];
  objects: SceneObjectData[];
}

export interface ProjectData {
  version: number;
  coordinateSystem?: 'z-up' | 'y-up';
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  activeSceneId: string;
  scenes: SceneData[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  objectCount: number;
}

export type FloatingMenuCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type FloatingMenuSize = 'small' | 'medium' | 'large';

export type TouchModifierKey = 'shift' | 'ctrl' | 'alt';

export type TouchModifierBehaviorMode = 'toggle' | 'hold';

export type TouchModifierState = Record<TouchModifierKey, boolean>;

export interface TouchModifierSlotConfig {
  enabled: boolean;
  twoFingerHold: boolean;
  showScreenButton: boolean;
}

export type TouchModifierSettings = Record<
  TouchModifierKey,
  TouchModifierSlotConfig
>;

export interface TouchControlSettings {
  oneFingerOrbit: boolean;
  oneFingerTapSelect: boolean;
  doubleTapBoxSelect: boolean;
  doubleTapIntervalMs: number;
  twoFingerPinchZoom: boolean;
  twoFingerPan: boolean;
  twoFingerUndo: boolean;
  threeFingerRedo: boolean;
  longPressContextMenu: boolean;
  floatingMenuEnabled: boolean;
  floatingMenuCorner: FloatingMenuCorner;
  floatingMenuSize: FloatingMenuSize;
  floatingMenuCustomPos: { xPct: number; yPct: number } | null;
  modifierPanelEnabled: boolean;
  modifierPanelMode: TouchModifierBehaviorMode;
  modifiers: TouchModifierSettings;
  radialLayouts: RadialMenuLayouts;
}

export type ViewportDisplayMode = 'wireframe' | 'solid' | 'xray' | 'material';

export interface ModelerSettings {
  displayMode: ViewportDisplayMode;
  xrayTransparency: number;
  showFaceOrientation?: boolean;
  showGrid: boolean;
  showAxes: boolean;
  xrayEditMode: boolean;
  gizmoSize: number;
  snapEnabled: boolean;
  snapTranslateStep: number;
  snapRotateDeg: number;
  snapScaleStep: number;
  multiSelectTouch: boolean;
  proportionalEditing: ProportionalEditingSettings;
  touch: TouchControlSettings;
}
