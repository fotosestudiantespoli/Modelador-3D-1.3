import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileBox,
  Image as ImageIcon,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import { LoadedImageReferencePayload } from '../core/io/imageReference';
import { analyzeExportTargets } from '../core/io/objExport';
import { validateCandidatesForStlExport } from '../core/io/stlExport';
import { StlInspectionResult } from '../core/io/stlImport';
import {
  ReferenceImageOrientation,
  SceneObjectData,
} from '../core/project/types';

export interface PendingStlImport {
  fileName: string;
  fileSizeBytes: number;
  buffer: ArrayBuffer;
  inspection: StlInspectionResult;
}

export type ExportScope = 'selected' | 'multiple' | 'scene';
export type ExportFormat = 'obj' | 'stl';

export interface ExportRequestConfig {
  format: ExportFormat;
  scope: ExportScope;
  selectedIds: string[];
  applyTransform: boolean;
  exportScale: number;
  stlBinary: boolean;
}

/* ============================================================================
 * STL Import Configuration Modal (Scale & Metadata Preview)
 * ========================================================================== */
export const StlImportModal: React.FC<{
  pending: PendingStlImport;
  onCancel: () => void;
  onConfirm: (scale: number) => void;
}> = ({ pending, onCancel, onConfirm }) => {
  const [scale, setScale] = useState<string>('1');
  const numericScale = parseFloat(scale);
  const isValid = Number.isFinite(numericScale) && numericScale > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[#181a1f] border border-[#2f3440] shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#262931] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FileBox className="w-4 h-4 text-[#ff9900] shrink-0" />
            <h2 className="text-sm font-semibold text-[#f3f4f6] truncate">
              Importar modelo STL
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-md hover:bg-[#262a33] text-[#9ca3af] hover:text-white flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-[#121418] border border-[#262931] p-3 space-y-1.5 text-xs">
            <div className="font-semibold text-[#f3f4f6] truncate">
              {pending.fileName}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#9ca3af] font-mono-tabular">
              <span>
                Formato:{' '}
                <strong className="text-[#e4e6eb]">
                  {pending.inspection.format === 'binary' ? 'Binario' : 'ASCII'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Triángulos:{' '}
                <strong className="text-[#e4e6eb]">
                  {pending.inspection.triangleCount.toLocaleString()}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Tamaño:{' '}
                <strong className="text-[#e4e6eb]">
                  {(pending.fileSizeBytes / 1024).toFixed(1)} KB
                </strong>
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#d1d5db]">
              Escala de importación
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: '1:1', value: '1' },
                { label: '0.1', value: '0.1' },
                { label: 'cm → m', value: '0.01' },
                { label: 'mm → m', value: '0.001' },
              ].map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setScale(preset.value)}
                  className={`h-9 rounded-md text-xs font-medium border transition-colors ${
                    scale === preset.value
                      ? 'bg-[#2a2f3a] border-[#ff9900] text-[#ff9900]'
                      : 'bg-[#121418] border-[#2b2e36] text-[#cbd5e1] hover:bg-[#20232b]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="number"
              step="any"
              min="0.0001"
              value={scale}
              onChange={(e) => setScale(e.target.value)}
              className="w-full h-10 px-3 rounded-md bg-[#111317] border border-[#2b2e36] focus:border-[#ff9900] text-sm font-mono-tabular text-[#f3f4f6] outline-none"
              placeholder="Factor de escala personalizado (ej. 1)"
            />
            <p className="text-[11px] text-[#8e95a2]">
              Los archivos STL no incluyen unidades físicas. Ajusta la escala si
              el modelo proviene en milímetros o centímetros.
            </p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[#262931] bg-[#15171b] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-md bg-[#23262d] hover:bg-[#2d313b] text-xs font-medium text-[#d1d5db] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={() => onConfirm(numericScale)}
            className="h-10 px-4 rounded-md bg-[#d97706] hover:bg-[#e5840b] disabled:opacity-45 text-xs font-semibold text-[#111215] flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>Importar STL</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * Reference Image Import Modal (Orientation & Proportions Preview)
 * ========================================================================== */
export const ReferenceImageImportModal: React.FC<{
  payload: LoadedImageReferencePayload;
  onCancel: () => void;
  onConfirm: (orientation: ReferenceImageOrientation) => void;
}> = ({ payload, onCancel, onConfirm }) => {
  const [orientation, setOrientation] =
    useState<ReferenceImageOrientation>('front');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[#181a1f] border border-[#2f3440] shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#262931] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ImageIcon className="w-4 h-4 text-[#38bdf8] shrink-0" />
            <h2 className="text-sm font-semibold text-[#f3f4f6] truncate">
              Añadir referencia de imagen
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-md hover:bg-[#262a33] text-[#9ca3af] hover:text-white flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-[#111317] border border-[#262931] p-2.5 flex items-center gap-3">
            <img
              src={payload.imageDataUrl}
              alt={payload.fileName}
              className="w-16 h-16 rounded object-contain bg-[#181a1f] border border-[#2b2e36] shrink-0"
            />
            <div className="min-w-0 space-y-1 text-xs">
              <div className="font-semibold text-[#f3f4f6] truncate">
                {payload.fileName}
              </div>
              <div className="text-[#9ca3af] font-mono-tabular">
                {payload.naturalWidth} × {payload.naturalHeight} px
              </div>
              <div className="text-[11px] text-[#38bdf8]">
                Tipo: Referencia de imagen (proporción original conservada)
              </div>
            </div>
          </div>

          {payload.wasResizedForWebGL && (
            <div className="rounded-md bg-[#2a2114] border border-[#ff9900]/40 px-3 py-2 text-[11px] text-[#fbd38d]">
              La imagen se ajustó a un máximo de 4096 px para garantizar
              compatibilidad gráfica en iPad.
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#d1d5db]">
              Orientación inicial en el visor
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'front', label: 'Frontal (-Y)' },
                  { id: 'back', label: 'Posterior (+Y)' },
                  { id: 'left', label: 'Lateral izquierda (-X)' },
                  { id: 'right', label: 'Lateral derecha (+X)' },
                  { id: 'top', label: 'Superior (+Z)' },
                  { id: 'bottom', label: 'Inferior (-Z)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOrientation(opt.id)}
                  className={`h-9 px-2.5 rounded-md text-xs font-medium border text-left transition-colors ${
                    orientation === opt.id
                      ? 'bg-[#2a2f3a] border-[#ff9900] text-[#ff9900]'
                      : 'bg-[#121418] border-[#2b2e36] text-[#cbd5e1] hover:bg-[#20232b]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[#262931] bg-[#15171b] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-md bg-[#23262d] hover:bg-[#2d313b] text-xs font-medium text-[#d1d5db] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(orientation)}
            className="h-10 px-4 rounded-md bg-[#d97706] hover:bg-[#e5840b] text-xs font-semibold text-[#111215] flex items-center gap-1.5 transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>Añadir referencia</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * Export Model Modal (OBJ / STL with Diagnostics & Compatibility Check)
 * ========================================================================== */
export const ExportModelModal: React.FC<{
  initialFormat: ExportFormat;
  initialScope: ExportScope;
  sceneObjects: SceneObjectData[];
  selectedObjectId: string | null;
  onCancel: () => void;
  onExport: (config: ExportRequestConfig) => void;
}> = ({
  initialFormat,
  initialScope,
  sceneObjects,
  selectedObjectId,
  onCancel,
  onExport,
}) => {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [scope, setScope] = useState<ExportScope>(
    initialScope === 'selected' && !selectedObjectId ? 'scene' : initialScope,
  );
  const [multiIds, setMultiIds] = useState<string[]>(() => {
    const valid = sceneObjects
      .filter((o) => o.objectType === 'mesh')
      .map((o) => o.id);
    if (selectedObjectId && valid.includes(selectedObjectId)) {
      return [selectedObjectId];
    }
    return valid;
  });
  const [applyTransform, setApplyTransform] = useState(true);
  const [stlBinary, setStlBinary] = useState(true);
  const [scaleStr, setScaleStr] = useState('1');

  const exportScale = parseFloat(scaleStr);
  const validScale = Number.isFinite(exportScale) && exportScale > 0;

  const targetCandidates = useMemo(() => {
    if (scope === 'selected') {
      const sel = sceneObjects.find((o) => o.id === selectedObjectId);
      return sel ? [sel] : [];
    }
    if (scope === 'multiple') {
      const idSet = new Set(multiIds);
      return sceneObjects.filter((o) => idSet.has(o.id));
    }
    return sceneObjects;
  }, [multiIds, sceneObjects, scope, selectedObjectId]);

  const objReport = useMemo(
    () => analyzeExportTargets(targetCandidates),
    [targetCandidates],
  );
  const stlValidation = useMemo(
    () =>
      format === 'stl' ? validateCandidatesForStlExport(targetCandidates) : null,
    [format, targetCandidates],
  );

  const canExport =
    validScale &&
    objReport.validMeshes.length > 0 &&
    (format === 'obj' ||
      (stlValidation !== null && stlValidation.blockingErrors.length === 0));

  const toggleMultiId = (id: string) => {
    setMultiIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[90vh] rounded-xl bg-[#181a1f] border border-[#2f3440] shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[#262931] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-[#ff9900]" />
            <h2 className="text-sm font-semibold text-[#f3f4f6]">
              Exportar modelo 3D
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-md hover:bg-[#262a33] text-[#9ca3af] hover:text-white flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto cad-scroll">
          {/* Format Selector */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-[#d1d5db]">Formato</div>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#111317] border border-[#262931]">
              <button
                type="button"
                onClick={() => setFormat('obj')}
                className={`h-9 rounded-md text-xs font-semibold transition-colors ${
                  format === 'obj'
                    ? 'bg-[#2a2f3a] text-[#ff9900]'
                    : 'text-[#9ca3af] hover:text-white'
                }`}
              >
                OBJ (Wavefront)
              </button>
              <button
                type="button"
                onClick={() => setFormat('stl')}
                className={`h-9 rounded-md text-xs font-semibold transition-colors ${
                  format === 'stl'
                    ? 'bg-[#2a2f3a] text-[#ff9900]'
                    : 'text-[#9ca3af] hover:text-white'
                }`}
              >
                STL (Malla triangular)
              </button>
            </div>
          </div>

          {/* Scope Selector */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-[#d1d5db]">Alcance</div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={!selectedObjectId}
                onClick={() => setScope('selected')}
                className={`h-9 px-2 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 ${
                  scope === 'selected'
                    ? 'bg-[#2a2f3a] border-[#ff9900] text-[#ff9900]'
                    : 'bg-[#121418] border-[#2b2e36] text-[#cbd5e1] hover:bg-[#20232b]'
                }`}
              >
                Seleccionado
              </button>
              <button
                type="button"
                onClick={() => setScope('multiple')}
                className={`h-9 px-2 rounded-md text-xs font-medium border transition-colors ${
                  scope === 'multiple'
                    ? 'bg-[#2a2f3a] border-[#ff9900] text-[#ff9900]'
                    : 'bg-[#121418] border-[#2b2e36] text-[#cbd5e1] hover:bg-[#20232b]'
                }`}
              >
                Varios objetos
              </button>
              <button
                type="button"
                onClick={() => setScope('scene')}
                className={`h-9 px-2 rounded-md text-xs font-medium border transition-colors ${
                  scope === 'scene'
                    ? 'bg-[#2a2f3a] border-[#ff9900] text-[#ff9900]'
                    : 'bg-[#121418] border-[#2b2e36] text-[#cbd5e1] hover:bg-[#20232b]'
                }`}
              >
                Escena completa
              </button>
            </div>
          </div>

          {/* Multi-object Checklist */}
          {scope === 'multiple' && (
            <div className="rounded-lg bg-[#121418] border border-[#262931] p-2.5 max-h-36 overflow-y-auto cad-scroll space-y-1">
              {sceneObjects.length === 0 ? (
                <div className="text-xs text-[#8e95a2] py-1">
                  No hay objetos en la escena activa.
                </div>
              ) : (
                sceneObjects.map((obj) => {
                  const isRef = obj.objectType === 'reference_image';
                  const checked = multiIds.includes(obj.id);
                  return (
                    <label
                      key={obj.id}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-[#1c1f26] ${
                        isRef ? 'opacity-65' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMultiId(obj.id)}
                          className="w-4 h-4 accent-[#ff9900]"
                        />
                        <span className="truncate text-[#e4e6eb]">
                          {obj.name}
                        </span>
                      </span>
                      <span className="text-[11px] text-[#8e95a2] shrink-0">
                        {isRef ? 'Referencia (omitida)' : 'Malla'}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          )}

          {/* Export Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[#d1d5db]">
                Coordenadas
              </div>
              <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-[#111317] border border-[#262931]">
                <button
                  type="button"
                  onClick={() => setApplyTransform(true)}
                  className={`h-8 rounded text-[11px] font-medium transition-colors ${
                    applyTransform
                      ? 'bg-[#2a2f3a] text-[#ff9900]'
                      : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  Transformadas
                </button>
                <button
                  type="button"
                  onClick={() => setApplyTransform(false)}
                  className={`h-8 rounded text-[11px] font-medium transition-colors ${
                    !applyTransform
                      ? 'bg-[#2a2f3a] text-[#ff9900]'
                      : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  Locales
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#d1d5db]">
                Escala de exportación
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  value={scaleStr}
                  onChange={(e) => setScaleStr(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md bg-[#111317] border border-[#2b2e36] focus:border-[#ff9900] text-xs font-mono-tabular text-[#f3f4f6] outline-none"
                />
                {format === 'stl' && (
                  <button
                    type="button"
                    onClick={() => setScaleStr(scaleStr === '1000' ? '1' : '1000')}
                    className="h-9 px-2.5 rounded-md bg-[#20232b] hover:bg-[#2a2e38] border border-[#2f3440] text-[11px] font-medium text-[#cbd5e1] whitespace-nowrap shrink-0"
                    title="Convertir metros a milímetros (×1000)"
                  >
                    m→mm
                  </button>
                )}
              </div>
            </div>
          </div>

          {format === 'stl' && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[#d1d5db]">
                Codificación STL
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#111317] border border-[#262931]">
                <button
                  type="button"
                  onClick={() => setStlBinary(true)}
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    stlBinary
                      ? 'bg-[#2a2f3a] text-[#ff9900]'
                      : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  Binario (Compacto)
                </button>
                <button
                  type="button"
                  onClick={() => setStlBinary(false)}
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    !stlBinary
                      ? 'bg-[#2a2f3a] text-[#ff9900]'
                      : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  ASCII (Texto)
                </button>
              </div>
            </div>
          )}

          {/* Compatibility & Skipped Objects Notice */}
          {objReport.skippedObjects.length > 0 && (
            <div className="rounded-lg bg-[#231d14] border border-[#ff9900]/40 p-3 space-y-1 text-xs">
              <div className="font-semibold text-[#fbbf24] flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Se omitirán {objReport.skippedObjects.length} objeto(s) no
                  compatibles
                </span>
              </div>
              <ul className="text-[11px] text-[#e5cfa0] space-y-0.5 pl-5 list-disc">
                {objReport.skippedObjects.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    {s.name}: {s.reason}
                  </li>
                ))}
                {objReport.skippedObjects.length > 4 && (
                  <li>
                    Y {objReport.skippedObjects.length - 4} elemento(s) más...
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* STL Geometry Diagnostics & Warnings */}
          {format === 'stl' && stlValidation && (
            <div className="rounded-lg bg-[#121418] border border-[#262931] p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#e4e6eb]">
                  Comprobación de malla STL
                </span>
                <span className="font-mono-tabular text-[11px] text-[#9ca3af]">
                  {stlValidation.validMeshes.length} malla(s) ·{' '}
                  {stlValidation.totalTriangles.toLocaleString()} triángulos
                </span>
              </div>

              {stlValidation.blockingErrors.length > 0 && (
                <div className="rounded bg-[#2d1619] border border-[#ef4444]/50 p-2 text-[11px] text-[#fca5a5] space-y-0.5">
                  {stlValidation.blockingErrors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}

              {stlValidation.warnings.length > 0 ? (
                <div className="rounded bg-[#261d12] border border-[#f59e0b]/40 p-2 space-y-1 text-[11px] text-[#fde68a]">
                  <div className="font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#f59e0b]" />
                    <span>Advertencias detectadas en la malla</span>
                  </div>
                  <ul className="space-y-0.5 pl-4 list-disc">
                    {stlValidation.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                stlValidation.blockingErrors.length === 0 && (
                  <div className="text-[11px] text-[#9ca3af]">
                    Índices de vértices, caras y normales verificados sin errores
                    topológicos evidentes.
                  </div>
                )
              )}

              <p className="text-[11px] text-[#8e95a2] leading-relaxed">
                Nota: Exportar a STL genera la geometría triangulada, pero no
                garantiza por sí solo que el modelo sea apto para impresión 3D
                sin revisar su estanqueidad, escala física y espesor.
              </p>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#262931] bg-[#15171b] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-[#9ca3af] font-mono-tabular">
            {objReport.validMeshes.length} objeto(s) válido(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-10 px-4 rounded-md bg-[#23262d] hover:bg-[#2d313b] text-xs font-medium text-[#d1d5db] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canExport}
              onClick={() =>
                onExport({
                  format,
                  scope,
                  selectedIds: multiIds,
                  applyTransform,
                  exportScale,
                  stlBinary,
                })
              }
              className="h-10 px-4 rounded-md bg-[#d97706] hover:bg-[#e5840b] disabled:opacity-40 text-xs font-semibold text-[#111215] flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Exportar {format.toUpperCase()}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * Operation Progress & Error Feedback Overlays
 * ========================================================================== */
export const IoProgressModal: React.FC<{
  title: string;
  label: string;
  progress: number;
}> = ({ title, label, progress }) => {
  const pct = Math.max(4, Math.min(100, Math.round(progress * 100)));
  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-[#181a1f] border border-[#2f3440] p-4 shadow-2xl space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#f3f4f6]">
          <Loader2 className="w-4 h-4 text-[#ff9900] animate-spin shrink-0" />
          <span>{title}</span>
        </div>
        <div className="text-xs text-[#9ca3af]">{label}</div>
        <div className="h-2 w-full rounded-full bg-[#111317] overflow-hidden border border-[#262931]">
          <div
            className="h-full bg-[#ff9900] transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-right text-[11px] font-mono-tabular text-[#cbd5e1]">
          {pct}%
        </div>
      </div>
    </div>
  );
};

export const IoErrorModal: React.FC<{
  title: string;
  message: string;
  onClose: () => void;
}> = ({ title, message, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
    <div className="w-full max-w-sm rounded-xl bg-[#181a1f] border border-[#ef4444]/40 p-4 shadow-2xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#fca5a5]">
          <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0" />
          <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-md hover:bg-[#262a33] text-[#9ca3af] hover:text-white flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-[#e4e6eb] leading-relaxed">{message}</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-md bg-[#262a33] hover:bg-[#323744] text-xs font-medium text-white"
        >
          Entendido
        </button>
      </div>
    </div>
  </div>
);
