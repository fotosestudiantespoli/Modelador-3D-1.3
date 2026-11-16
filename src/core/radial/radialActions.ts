export type RadialWorkMode = 'object' | 'edit' | 'sculpt';

export type RadialActionCategoryId =
  | 'navigation'
  | 'selection'
  | 'transform'
  | 'creation'
  | 'modification'
  | 'deletion'
  | 'history'
  | 'general';

export interface RadialCategoryMeta {
  id: RadialActionCategoryId;
  label: string;
}

export const RADIAL_ACTION_CATEGORIES: RadialCategoryMeta[] = [
  { id: 'navigation', label: '1. Navegación' },
  { id: 'selection', label: '2. Selección' },
  { id: 'transform', label: '3. Transformación' },
  { id: 'creation', label: '4. Creación de geometría' },
  { id: 'modification', label: '5. Modificación de geometría' },
  { id: 'deletion', label: '6. Eliminación' },
  { id: 'history', label: '7. Historial' },
  { id: 'general', label: '8. Herramientas generales' },
];

export type RadialActionId =
  // 1. Navegación
  | 'focus_camera'
  | 'view_iso'
  | 'view_front'
  | 'view_top'
  | 'view_right'
  | 'toggle_projection'
  // 2. Selección
  | 'select_all'
  | 'deselect_all'
  | 'mode_vertex'
  | 'mode_edge'
  | 'mode_face'
  | 'toggle_multi_select'
  | 'toggle_shift_modifier'
  // 3. Transformación
  | 'tool_select'
  | 'tool_move'
  | 'tool_rotate'
  | 'tool_scale'
  | 'axis_free'
  | 'axis_x'
  | 'axis_y'
  | 'axis_z'
  | 'toggle_proportional'
  | 'toggle_proportional_connected'
  // 4. Creación de geometría
  | 'open_add_menu'
  | 'add_plane'
  | 'add_cube'
  | 'add_circle'
  | 'add_uv_sphere'
  | 'add_cylinder'
  | 'add_pyramid'
  | 'add_suzanne'
  | 'fill_mesh'
  // 5. Modificación de geometría
  | 'op_extrude'
  | 'op_inset'
  | 'op_subdivide'
  | 'op_bevel'
  | 'op_loop_cut'
  | 'op_merge'
  | 'op_merge_by_distance'
  | 'connect_vertex_path'
  | 'op_recalculate_normals'
  | 'op_flip_normals'
  | 'duplicate_object'
  // 6. Eliminación
  | 'delete_contextual'
  | 'dissolve_quick'
  | 'delete_edges_verts'
  | 'delete_faces_edges'
  // 7. Historial
  | 'undo'
  | 'redo'
  // 8. Herramientas generales
  | 'work_object'
  | 'work_edit'
  | 'toggle_xray'
  | 'toggle_face_orientation'
  | 'toggle_grid'
  | 'save_project'
  | 'open_settings';

export type RadialIconKey =
  | 'focus'
  | 'compass'
  | 'view_front'
  | 'view_top'
  | 'view_right'
  | 'camera'
  | 'check_square'
  | 'deselect'
  | 'vertex'
  | 'edge'
  | 'face'
  | 'multi_select'
  | 'shift'
  | 'pointer'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'axis_free'
  | 'axis_x'
  | 'axis_y'
  | 'axis_z'
  | 'proportional'
  | 'proportional_connected'
  | 'plus'
  | 'plane'
  | 'cube'
  | 'circle'
  | 'sphere'
  | 'cylinder'
  | 'pyramid'
  | 'suzanne'
  | 'fill'
  | 'extrude'
  | 'inset'
  | 'subdivide'
  | 'bevel'
  | 'loop_cut'
  | 'merge'
  | 'merge_dist'
  | 'connect_path'
  | 'recalculate_normals'
  | 'flip_normals'
  | 'duplicate'
  | 'trash'
  | 'dissolve'
  | 'undo'
  | 'redo'
  | 'work_object'
  | 'work_edit'
  | 'xray'
  | 'face_orientation'
  | 'grid'
  | 'save'
  | 'settings';

export interface RadialActionDefinition {
  id: RadialActionId;
  label: string;
  shortLabel: string;
  description: string;
  category: RadialActionCategoryId;
  icon: RadialIconKey;
  danger?: boolean;
  /** Modes where this action has direct functional effect */
  supportedModes: RadialWorkMode[];
}

export const RADIAL_ACTION_LIBRARY: RadialActionDefinition[] = [
  // 1. Navegación
  {
    id: 'focus_camera',
    label: 'Centrar en selección',
    shortLabel: 'Centrar',
    description: 'Encuadra el objeto seleccionado en la vista 3D',
    category: 'navigation',
    icon: 'focus',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'view_iso',
    label: 'Vista 3D isométrica',
    shortLabel: 'Vista 3D',
    description: 'Restablece la cámara en perspectiva isométrica',
    category: 'navigation',
    icon: 'compass',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'view_front',
    label: 'Vista Frontal',
    shortLabel: 'Frontal',
    description: 'Alinea la cámara al eje frontal (-Y)',
    category: 'navigation',
    icon: 'view_front',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'view_top',
    label: 'Vista Superior',
    shortLabel: 'Superior',
    description: 'Alinea la cámara desde arriba (+Z)',
    category: 'navigation',
    icon: 'view_top',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'view_right',
    label: 'Vista Derecha',
    shortLabel: 'Derecha',
    description: 'Alinea la cámara al lateral derecho (+X)',
    category: 'navigation',
    icon: 'view_right',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'toggle_projection',
    label: 'Perspectiva / Ortográfica',
    shortLabel: 'Persp/Orto',
    description: 'Alterna entre proyección Perspectiva y Ortográfica',
    category: 'navigation',
    icon: 'camera',
    supportedModes: ['object', 'edit', 'sculpt'],
  },

  // 2. Selección
  {
    id: 'select_all',
    label: 'Seleccionar todo',
    shortLabel: 'Sel. todo',
    description: 'Selecciona todos los componentes activos en Edición',
    category: 'selection',
    icon: 'check_square',
    supportedModes: ['edit'],
  },
  {
    id: 'deselect_all',
    label: 'Limpiar selección',
    shortLabel: 'Deselec.',
    description: 'Limpia la selección actual de componentes o de objeto',
    category: 'selection',
    icon: 'deselect',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'mode_vertex',
    label: 'Modo Vértices',
    shortLabel: 'Vértices',
    description: 'Cambia el submodo de Edición a Vértices',
    category: 'selection',
    icon: 'vertex',
    supportedModes: ['edit'],
  },
  {
    id: 'mode_edge',
    label: 'Modo Aristas',
    shortLabel: 'Aristas',
    description: 'Cambia el submodo de Edición a Aristas',
    category: 'selection',
    icon: 'edge',
    supportedModes: ['edit'],
  },
  {
    id: 'mode_face',
    label: 'Modo Caras',
    shortLabel: 'Caras',
    description: 'Cambia el submodo de Edición a Caras',
    category: 'selection',
    icon: 'face',
    supportedModes: ['edit'],
  },
  {
    id: 'toggle_multi_select',
    label: 'Selección múltiple táctil',
    shortLabel: 'Múltiple',
    description: 'Activa o desactiva la acumulación automática por toque',
    category: 'selection',
    icon: 'multi_select',
    supportedModes: ['edit'],
  },
  {
    id: 'toggle_shift_modifier',
    label: 'Alternar SHIFT en pantalla',
    shortLabel: 'SHIFT',
    description:
      'Activa o desactiva el modificador SHIFT para agregar o quitar elementos de la selección',
    category: 'selection',
    icon: 'shift',
    supportedModes: ['object', 'edit'],
  },

  // 3. Transformación
  {
    id: 'tool_select',
    label: 'Herramienta Seleccionar',
    shortLabel: 'Selec.',
    description: 'Activa selección directa sin manipulador de transformación',
    category: 'transform',
    icon: 'pointer',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'tool_move',
    label: 'Mover',
    shortLabel: 'Mover',
    description: 'Activa el manipulador de traslación (G)',
    category: 'transform',
    icon: 'move',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'tool_rotate',
    label: 'Rotar',
    shortLabel: 'Rotar',
    description: 'Activa el manipulador de rotación (R)',
    category: 'transform',
    icon: 'rotate',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'tool_scale',
    label: 'Escalar',
    shortLabel: 'Escalar',
    description: 'Activa el manipulador de escala (S)',
    category: 'transform',
    icon: 'scale',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'axis_free',
    label: 'Eje Libre',
    shortLabel: 'Eje Libre',
    description: 'Libera la restricción de ejes en el manipulador',
    category: 'transform',
    icon: 'axis_free',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'axis_x',
    label: 'Restringir a Eje X',
    shortLabel: 'Eje X',
    description: 'Restringe transformaciones al eje rojo X',
    category: 'transform',
    icon: 'axis_x',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'axis_y',
    label: 'Restringir a Eje Y',
    shortLabel: 'Eje Y',
    description: 'Restringe transformaciones al eje verde Y',
    category: 'transform',
    icon: 'axis_y',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'axis_z',
    label: 'Restringir a Eje Z',
    shortLabel: 'Eje Z',
    description: 'Restringe transformaciones al eje celeste Z',
    category: 'transform',
    icon: 'axis_z',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'toggle_proportional',
    label: 'Edición Proporcional (O)',
    shortLabel: 'Proporc.',
    description:
      'Activa o desactiva la deformación gradual de vértices cercanos en Modo Edición (O)',
    category: 'transform',
    icon: 'proportional',
    supportedModes: ['edit'],
  },
  {
    id: 'toggle_proportional_connected',
    label: 'Solo Conectados (Alt+O)',
    shortLabel: 'Conect.',
    description:
      'Limita la edición proporcional únicamente a vértices conectados topológicamente',
    category: 'transform',
    icon: 'proportional_connected',
    supportedModes: ['edit'],
  },

  // 4. Creación de geometría
  {
    id: 'open_add_menu',
    label: 'Agregar primitiva (selector)',
    shortLabel: 'Agregar',
    description: 'Abre el selector rápido de primitivas 3D',
    category: 'creation',
    icon: 'plus',
    supportedModes: ['object'],
  },
  {
    id: 'add_plane',
    label: 'Agregar Plano',
    shortLabel: 'Plano',
    description: 'Inserta un plano cuadrangular editable en la escena',
    category: 'creation',
    icon: 'plane',
    supportedModes: ['object'],
  },
  {
    id: 'add_cube',
    label: 'Agregar Cubo',
    shortLabel: 'Cubo',
    description: 'Inserta una nueva malla Cubo en la escena',
    category: 'creation',
    icon: 'cube',
    supportedModes: ['object'],
  },
  {
    id: 'add_circle',
    label: 'Agregar Círculo',
    shortLabel: 'Círculo',
    description: 'Inserta un anillo poligonal en la escena',
    category: 'creation',
    icon: 'circle',
    supportedModes: ['object'],
  },
  {
    id: 'add_uv_sphere',
    label: 'Agregar Esfera UV',
    shortLabel: 'Esfera',
    description: 'Inserta una esfera UV editable en la escena',
    category: 'creation',
    icon: 'sphere',
    supportedModes: ['object'],
  },
  {
    id: 'add_cylinder',
    label: 'Agregar Cilindro',
    shortLabel: 'Cilindro',
    description: 'Inserta un cilindro editable en la escena',
    category: 'creation',
    icon: 'cylinder',
    supportedModes: ['object'],
  },
  {
    id: 'add_pyramid',
    label: 'Agregar Pirámide',
    shortLabel: 'Pirámide',
    description: 'Inserta una pirámide editable en la escena',
    category: 'creation',
    icon: 'pyramid',
    supportedModes: ['object'],
  },
  {
    id: 'add_suzanne',
    label: 'Agregar Suzanne',
    shortLabel: 'Suzanne',
    description: 'Inserta la malla poligonal Suzanne (cabeza de mono)',
    category: 'creation',
    icon: 'suzanne',
    supportedModes: ['object'],
  },
  {
    id: 'fill_mesh',
    label: 'Crear cara (Make Face)',
    shortLabel: 'Crear cara',
    description:
      'Crea una cara nueva o arista a partir de vértices o aristas seleccionadas (F)',
    category: 'creation',
    icon: 'fill',
    supportedModes: ['edit'],
  },

  // 5. Modificación de geometría
  {
    id: 'op_extrude',
    label: 'Extruir (Extrude)',
    shortLabel: 'Extruir',
    description: 'Extruye vértices, aristas o caras seleccionadas (E)',
    category: 'modification',
    icon: 'extrude',
    supportedModes: ['edit'],
  },
  {
    id: 'op_inset',
    label: 'Insertar caras (Inset)',
    shortLabel: 'Inset',
    description: 'Crea un margen interior en las caras seleccionadas (I)',
    category: 'modification',
    icon: 'inset',
    supportedModes: ['edit'],
  },
  {
    id: 'op_subdivide',
    label: 'Subdividir (Subdivide)',
    shortLabel: 'Subdividir',
    description: 'Divide las caras o aristas seleccionadas con suavizado',
    category: 'modification',
    icon: 'subdivide',
    supportedModes: ['edit'],
  },
  {
    id: 'op_bevel',
    label: 'Biselar (Bevel)',
    shortLabel: 'Bevel',
    description: 'Bisela aristas, vértices o bordes de caras (B)',
    category: 'modification',
    icon: 'bevel',
    supportedModes: ['edit'],
  },
  {
    id: 'op_loop_cut',
    label: 'Corte de Bucle (Loop Cut)',
    shortLabel: 'Bucle',
    description: 'Inserta cortes continuos alrededor de un bucle de quads (K)',
    category: 'modification',
    icon: 'loop_cut',
    supportedModes: ['edit'],
  },
  {
    id: 'op_merge',
    label: 'Fusionar vértices (Merge)',
    shortLabel: 'Fusionar',
    description: 'Colapsa vértices seleccionados al centro o punto medio (M)',
    category: 'modification',
    icon: 'merge',
    supportedModes: ['edit'],
  },
  {
    id: 'op_merge_by_distance',
    label: 'Fusionar por distancia',
    shortLabel: 'Fus. dist.',
    description: 'Suelda vértices duplicados o cercanos dentro de un umbral',
    category: 'modification',
    icon: 'merge_dist',
    supportedModes: ['edit'],
  },
  {
    id: 'connect_vertex_path',
    label: 'Connect Vertex Path (J)',
    shortLabel: 'Conectar (J)',
    description:
      'Crea aristas entre vértices seleccionados y divide las caras atravesadas (J)',
    category: 'modification',
    icon: 'connect_path',
    supportedModes: ['edit'],
  },
  {
    id: 'op_recalculate_normals',
    label: 'Recalculate Outside',
    shortLabel: 'Recalcular',
    description:
      'Recalcula y orienta las normales de las caras cerradas hacia el exterior',
    category: 'modification',
    icon: 'recalculate_normals',
    supportedModes: ['edit'],
  },
  {
    id: 'op_flip_normals',
    label: 'Flip Normals',
    shortLabel: 'Invertir N.',
    description:
      'Invierte la orientación de las normales de las caras seleccionadas o de toda la malla',
    category: 'modification',
    icon: 'flip_normals',
    supportedModes: ['edit'],
  },
  {
    id: 'duplicate_object',
    label: 'Duplicar objeto',
    shortLabel: 'Duplicar',
    description: 'Crea una copia del objeto seleccionado',
    category: 'modification',
    icon: 'duplicate',
    supportedModes: ['object'],
  },

  // 6. Eliminación
  {
    id: 'delete_contextual',
    label: 'Eliminar selección',
    shortLabel: 'Eliminar',
    description: 'Elimina el objeto activo o los componentes seleccionados',
    category: 'deletion',
    icon: 'trash',
    danger: true,
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'dissolve_quick',
    label: 'Disolver selección',
    shortLabel: 'Disolver',
    description: 'Disuelve los componentes manteniendo la continuidad de la malla',
    category: 'deletion',
    icon: 'dissolve',
    danger: true,
    supportedModes: ['edit'],
  },
  {
    id: 'delete_edges_verts',
    label: 'Eliminar aristas y vértices',
    shortLabel: 'Aris.+Vért.',
    description: 'Elimina las aristas seleccionadas junto con sus vértices',
    category: 'deletion',
    icon: 'trash',
    danger: true,
    supportedModes: ['edit'],
  },
  {
    id: 'delete_faces_edges',
    label: 'Eliminar caras y aristas',
    shortLabel: 'Caras+Aris.',
    description: 'Elimina las caras seleccionadas y sus aristas libres',
    category: 'deletion',
    icon: 'trash',
    danger: true,
    supportedModes: ['edit'],
  },

  // 7. Historial
  {
    id: 'undo',
    label: 'Deshacer (Undo)',
    shortLabel: 'Deshacer',
    description: 'Revierte la última operación realizada',
    category: 'history',
    icon: 'undo',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'redo',
    label: 'Rehacer (Redo)',
    shortLabel: 'Rehacer',
    description: 'Reaplica la última operación revertida',
    category: 'history',
    icon: 'redo',
    supportedModes: ['object', 'edit', 'sculpt'],
  },

  // 8. Herramientas generales
  {
    id: 'work_object',
    label: 'Cambiar a Modo Objeto',
    shortLabel: 'M. Objeto',
    description: 'Pasa al modo de escena y manipulación de objetos',
    category: 'general',
    icon: 'work_object',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'work_edit',
    label: 'Cambiar a Modo Edición',
    shortLabel: 'M. Edición',
    description: 'Entra a editar vértices, aristas y caras del objeto',
    category: 'general',
    icon: 'work_edit',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'toggle_xray',
    label: 'Alternar Rayos X',
    shortLabel: 'Rayos X',
    description: 'Activa o desactiva la vista translúcida X-Ray y selección posterior',
    category: 'general',
    icon: 'xray',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'toggle_face_orientation',
    label: 'Face Orientation',
    shortLabel: 'Orientación',
    description:
      'Muestra caras exteriores en azul y caras invertidas en rojo sin alterar materiales',
    category: 'general',
    icon: 'face_orientation',
    supportedModes: ['object', 'edit'],
  },
  {
    id: 'toggle_grid',
    label: 'Mostrar / Ocultar cuadrícula',
    shortLabel: 'Cuadrícula',
    description: 'Alterna la visibilidad de la cuadrícula de referencia',
    category: 'general',
    icon: 'grid',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'save_project',
    label: 'Guardar proyecto',
    shortLabel: 'Guardar',
    description: 'Guarda el estado actual del proyecto localmente',
    category: 'general',
    icon: 'save',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
  {
    id: 'open_settings',
    label: 'Abrir configuración',
    shortLabel: 'Ajustes',
    description: 'Abre el panel de configuración y controles táctiles',
    category: 'general',
    icon: 'settings',
    supportedModes: ['object', 'edit', 'sculpt'],
  },
];

export const RADIAL_ACTION_MAP: Record<RadialActionId, RadialActionDefinition> =
  RADIAL_ACTION_LIBRARY.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<RadialActionId, RadialActionDefinition>,
  );

export const RADIAL_SLOT_COUNT = 8;

export type RadialSlotList = (RadialActionId | null)[];

export type RadialMenuLayouts = Record<RadialWorkMode, RadialSlotList>;

export const DEFAULT_RADIAL_LAYOUTS: RadialMenuLayouts = {
  object: [
    'open_add_menu',
    'tool_move',
    'tool_rotate',
    'tool_scale',
    'duplicate_object',
    'delete_contextual',
    'focus_camera',
    'work_edit',
  ],
  edit: [
    'op_extrude',
    'op_inset',
    'op_subdivide',
    'op_bevel',
    'op_loop_cut',
    'fill_mesh',
    'op_merge',
    'delete_contextual',
  ],
  sculpt: [
    'undo',
    'redo',
    'focus_camera',
    'view_iso',
    'toggle_projection',
    'toggle_grid',
    'work_object',
    null,
  ],
};

export function cloneDefaultRadialLayouts(): RadialMenuLayouts {
  return {
    object: [...DEFAULT_RADIAL_LAYOUTS.object],
    edit: [...DEFAULT_RADIAL_LAYOUTS.edit],
    sculpt: [...DEFAULT_RADIAL_LAYOUTS.sculpt],
  };
}

export function normalizeRadialSlotList(
  input: unknown,
  fallback: RadialSlotList,
): RadialSlotList {
  if (!Array.isArray(input)) {
    return [...fallback];
  }
  const out: RadialSlotList = [];
  for (let i = 0; i < RADIAL_SLOT_COUNT; i++) {
    const val = input[i];
    if (val === null) {
      out.push(null);
    } else if (typeof val === 'string' && val in RADIAL_ACTION_MAP) {
      out.push(val as RadialActionId);
    } else {
      out.push(fallback[i] ?? null);
    }
  }
  return out;
}

export function isValidRadialActionId(id: unknown): id is RadialActionId {
  return typeof id === 'string' && id in RADIAL_ACTION_MAP;
}
