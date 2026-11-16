import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Download,
  Eye,
  FileBox,
  FilePlus2,
  FileText,
  Focus,
  FolderOpen,
  Grid3X3,
  Image as ImageIcon,
  Layers,
  Lock,
  Menu,
  PanelRight,
  Save,
  Settings,
  Sparkles,
  Triangle,
  Upload,
  Camera,
} from 'lucide-react';
import { EditSelectionMode } from '../core/mesh/operations';
import {
  CameraProjection,
  ViewportDisplayMode,
  WorkMode,
} from '../core/project/types';
import { ProportionalIcon } from './ProportionalEditingBar';
import {
  DISPLAY_MODES,
  getXrayDescriptor,
  ShadingModeIcon,
  XRAY_PRESETS,
} from './ViewportDisplaySelector';

type TopMenuKey = 'file' | 'viewport' | 'mode';

export interface SceneStatsInfo {
  objectCount: number;
  selectedObjectCount: number;
  selectedComponentCount: number;
  activeObjectName: string | null;
  vertices: number;
  edges: number;
  faces: number;
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
}

interface TopBarProps {
  projectName: string;
  hasUnsavedChanges: boolean;
  workMode: WorkMode;
  editSelectionMode: EditSelectionMode;
  canEditSelected: boolean;
  hasSelectedObject: boolean;
  displayMode: ViewportDisplayMode;
  xrayTransparency: number;
  showFaceOrientation: boolean;
  proportionalEnabled?: boolean;
  projection: CameraProjection;
  showOutliner: boolean;
  sceneStats?: SceneStatsInfo;
  onCreateProjectModal: () => void;
  onOpenProjectModal: () => void;
  onSaveProject: () => void;
  onSaveAsProjectModal: () => void;
  onOpenSettingsModal: () => void;
  onImportObj: () => void;
  onImportStl: () => void;
  onImportJpg: () => void;
  onImportPng: () => void;
  onExportSelected: () => void;
  onExportScene: () => void;
  onExportObj: () => void;
  onExportStl: () => void;
  onSelectDisplayMode: (mode: ViewportDisplayMode) => void;
  onChangeXrayTransparency: (value: number) => void;
  onToggleFaceOrientation: () => void;
  onToggleProportional?: () => void;
  onChangeProjection: (projection: CameraProjection) => void;
  onFocusSelected: () => void;
  onToggleWorkMode: (mode: WorkMode) => void;
  onChangeEditSelectionMode: (mode: EditSelectionMode) => void;
  onToggleOutliner: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  hasUnsavedChanges,
  workMode,
  editSelectionMode,
  canEditSelected,
  hasSelectedObject,
  displayMode,
  xrayTransparency,
  showFaceOrientation,
  proportionalEnabled = false,
  projection,
  showOutliner,
  sceneStats,
  onCreateProjectModal,
  onOpenProjectModal,
  onSaveProject,
  onSaveAsProjectModal,
  onOpenSettingsModal,
  onImportObj,
  onImportStl,
  onImportJpg,
  onImportPng,
  onExportSelected,
  onExportScene,
  onExportObj,
  onExportStl,
  onSelectDisplayMode,
  onChangeXrayTransparency,
  onToggleFaceOrientation,
  onToggleProportional,
  onChangeProjection,
  onFocusSelected,
  onToggleWorkMode,
  onChangeEditSelectionMode,
  onToggleOutliner,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openMenu, setOpenMenu] = useState<{
    key: TopMenuKey;
    left: number;
    top: number;
  } | null>(null);

  const fileBtnRef = useRef<HTMLButtonElement | null>(null);
  const viewportBtnRef = useRef<HTMLButtonElement | null>(null);
  const modeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openMenu]);

  useEffect(() => {
    if (isCollapsed && openMenu) {
      setOpenMenu(null);
    }
  }, [isCollapsed, openMenu]);

  const toggleMenu = (
    key: TopMenuKey,
    btnRef: React.RefObject<HTMLButtonElement | null>,
    menuWidth: number,
  ) => {
    if (openMenu?.key === key) {
      setOpenMenu(null);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    const rawLeft = rect ? rect.left : 12;
    const clampedLeft = Math.max(
      8,
      Math.min(window.innerWidth - menuWidth - 8, rawLeft),
    );
    const top = rect ? rect.bottom + 6 : 50;
    setOpenMenu({ key, left: clampedLeft, top });
  };

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        aria-label="Desplegar barra superior"
        title="Mostrar barra superior"
        className="fixed top-2.5 left-3 z-30 min-h-[40px] px-3 rounded-lg bg-[#181a1f]/95 hover:bg-[#23262e] active:bg-[#2c313b] border border-[#343a47] shadow-xl text-xs font-semibold text-[#e4e6eb] flex items-center gap-2 transition-colors touch-manipulation"
      >
        <Menu className="w-4 h-4 text-[#ff9900]" />
        <span className="whitespace-nowrap">Menú</span>
        <ChevronDown className="w-3.5 h-3.5 text-[#9ca3af]" />
      </button>
    );
  }

  return (
    <>
      <header className="h-12 shrink-0 bg-[#181a1f] border-b border-[#2b2e36] px-2.5 sm:px-3.5 flex items-center justify-between gap-3 z-30">
        {/* Left: Brand & Active Project Name */}
        <div className="hidden md:flex items-center gap-2 min-w-0 max-w-[220px] shrink">
          <span className="text-xs font-bold tracking-tight text-[#f3f4f6] whitespace-nowrap shrink-0">
            Forma3D
          </span>
          <span className="text-[#4b5563]" aria-hidden="true">
            ·
          </span>
          <span className="text-xs text-[#9ca3af] truncate" title={projectName}>
            {projectName}
            {hasUnsavedChanges ? ' *' : ''}
          </span>
        </div>

        {/* Center/Primary: 4 Main Compact Accesses (Archivo, Viewport, Modo, Panel) */}
        <nav
          aria-label="Barra principal"
          className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto cad-scroll"
        >
          <button
            ref={fileBtnRef}
            type="button"
            onClick={() => toggleMenu('file', fileBtnRef, 288)}
            aria-expanded={openMenu?.key === 'file'}
            aria-haspopup="menu"
            className={`min-h-[38px] px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors touch-manipulation ${
              openMenu?.key === 'file'
                ? 'bg-[#2c313b] border-[#ff9900]/65 text-[#ff9900]'
                : 'bg-[#22252d] hover:bg-[#2a2e38] border-[#323640] text-[#e4e6eb]'
            }`}
          >
            <FileText className="w-4 h-4 text-[#ff9900] shrink-0" />
            <span>Archivo</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
          </button>

          <button
            ref={viewportBtnRef}
            type="button"
            onClick={() => toggleMenu('viewport', viewportBtnRef, 276)}
            aria-expanded={openMenu?.key === 'viewport'}
            aria-haspopup="menu"
            className={`min-h-[38px] px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors touch-manipulation ${
              openMenu?.key === 'viewport'
                ? 'bg-[#2c313b] border-[#ff9900]/65 text-[#ff9900]'
                : 'bg-[#22252d] hover:bg-[#2a2e38] border-[#323640] text-[#e4e6eb]'
            }`}
          >
            <Eye className="w-4 h-4 text-[#ff9900] shrink-0" />
            <span>Viewport</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
          </button>

          <button
            ref={modeBtnRef}
            type="button"
            onClick={() => toggleMenu('mode', modeBtnRef, 248)}
            aria-expanded={openMenu?.key === 'mode'}
            aria-haspopup="menu"
            className={`min-h-[38px] px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors touch-manipulation ${
              openMenu?.key === 'mode'
                ? 'bg-[#2c313b] border-[#ff9900]/65 text-[#ff9900]'
                : workMode === 'edit'
                  ? 'bg-[#2a2216] hover:bg-[#352a19] border-[#ff9900]/45 text-[#ffb84d]'
                  : 'bg-[#22252d] hover:bg-[#2a2e38] border-[#323640] text-[#e4e6eb]'
            }`}
          >
            {workMode === 'edit' ? (
              <Triangle className="w-4 h-4 text-[#ff9900] shrink-0" />
            ) : (
              <Box className="w-4 h-4 text-[#ff9900] shrink-0" />
            )}
            <span>Modo</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => {
              setOpenMenu(null);
              onToggleOutliner();
            }}
            aria-pressed={showOutliner}
            className={`min-h-[38px] px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors touch-manipulation ${
              showOutliner
                ? 'bg-[#2c313b] border-[#ff9900]/65 text-[#ff9900]'
                : 'bg-[#22252d] hover:bg-[#2a2e38] border-[#323640] text-[#e4e6eb]'
            }`}
          >
            <PanelRight className="w-4 h-4 shrink-0" />
            <span>Panel</span>
          </button>
        </nav>

        {/* Right: Collapse Top Bar Button */}
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null);
            setIsCollapsed(true);
          }}
          aria-label="Contraer barra superior"
          title="Contraer barra superior para ampliar el viewport"
          className="min-h-[38px] px-2.5 rounded-md bg-[#22252d] hover:bg-[#2c3039] border border-[#323640] text-[#9ca3af] hover:text-white flex items-center gap-1 text-xs font-medium shrink-0 transition-colors touch-manipulation"
        >
          <ChevronUp className="w-4 h-4" />
          <span className="hidden sm:inline">Ocultar</span>
        </button>
      </header>

      {/* Dropdown Popover Backdrop + Single Open Menu */}
      {openMenu && (
        <div
          className="fixed inset-0 z-40"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setOpenMenu(null);
            }
          }}
        >
          {/* A. ARCHIVO MENU */}
          {openMenu.key === 'file' && (
            <div
              role="menu"
              aria-label="Menú Archivo"
              style={{ left: openMenu.left, top: openMenu.top }}
              onPointerDown={(e) => e.stopPropagation()}
              className="fixed w-[288px] max-h-[78vh] overflow-y-auto cad-scroll rounded-xl bg-[#181a1f] border border-[#343a47] shadow-2xl p-1.5 space-y-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onCreateProjectModal();
                }}
                className="w-full min-h-[42px] px-2.5 rounded-lg hover:bg-[#252932] active:bg-[#2e333f] text-xs font-medium text-[#e4e6eb] flex items-center gap-2.5 text-left transition-colors"
              >
                <FilePlus2 className="w-4 h-4 text-[#ff9900] shrink-0" />
                <span>Crear proyecto</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onOpenProjectModal();
                }}
                className="w-full min-h-[42px] px-2.5 rounded-lg hover:bg-[#252932] active:bg-[#2e333f] text-xs font-medium text-[#e4e6eb] flex items-center gap-2.5 text-left transition-colors"
              >
                <FolderOpen className="w-4 h-4 text-[#ff9900] shrink-0" />
                <span>Abrir proyecto</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onSaveProject();
                }}
                className="w-full min-h-[42px] px-2.5 rounded-lg hover:bg-[#252932] active:bg-[#2e333f] text-xs font-medium text-[#e4e6eb] flex items-center justify-between gap-2 text-left transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <Save className="w-4 h-4 text-[#ff9900] shrink-0" />
                  <span>Guardar</span>
                </span>
                {hasUnsavedChanges && (
                  <span className="text-[10px] font-medium text-[#ff9900]">
                    Sin guardar
                  </span>
                )}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onSaveAsProjectModal();
                }}
                className="w-full min-h-[42px] px-2.5 rounded-lg hover:bg-[#252932] active:bg-[#2e333f] text-xs font-medium text-[#e4e6eb] flex items-center gap-2.5 text-left transition-colors"
              >
                <CopyPlus className="w-4 h-4 text-[#cbd5e1] shrink-0" />
                <span>Guardar como</span>
              </button>

              <div className="my-1 border-t border-[#272b34]" />

              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold text-[#8e95a2] flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-[#ff9900]" />
                <span>Importar</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onImportObj();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <FileBox className="w-3.5 h-3.5 text-[#ff9900] shrink-0" />
                  <span>OBJ</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onImportStl();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <FileBox className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
                  <span>STL</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onImportJpg();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                  <span>JPG</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onImportPng();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />
                  <span>PNG</span>
                </button>
              </div>

              <div className="my-1 border-t border-[#272b34]" />

              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold text-[#8e95a2] flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-[#ff9900]" />
                <span>Exportar</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasSelectedObject}
                  onClick={() => {
                    setOpenMenu(null);
                    onExportSelected();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] disabled:opacity-40 disabled:pointer-events-none text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <Box className="w-3.5 h-3.5 text-[#ff9900] shrink-0" />
                  <span className="truncate">Seleccionado</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onExportScene();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-[#a78bfa] shrink-0" />
                  <span className="truncate">Escena</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onExportObj();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#cbd5e1] shrink-0" />
                  <span>OBJ</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onExportStl();
                  }}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#1e2128] hover:bg-[#272b35] text-xs font-medium text-[#e4e6eb] flex items-center gap-2 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
                  <span>STL</span>
                </button>
              </div>

              <div className="my-1 border-t border-[#272b34]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onOpenSettingsModal();
                }}
                className="w-full min-h-[42px] px-2.5 rounded-lg hover:bg-[#252932] active:bg-[#2e333f] text-xs font-medium text-[#e4e6eb] flex items-center gap-2.5 text-left transition-colors"
              >
                <Settings className="w-4 h-4 text-[#9ca3af] shrink-0" />
                <span>Configuración</span>
              </button>

              {sceneStats && (
                <>
                  <div className="my-1 border-t border-[#272b34]" />
                  <div className="mx-1 p-2 rounded-lg bg-[#121418] border border-[#262932] space-y-1 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#cbd5e1] truncate">
                        {sceneStats.activeObjectName ?? 'Sin selección'}
                      </span>
                      <span className="font-mono-tabular text-[#8e95a2] shrink-0">
                        {sceneStats.objectCount} obj.
                      </span>
                    </div>
                    <div className="flex items-center justify-between font-mono-tabular text-[#9ca3af]">
                      <span>V: {sceneStats.vertices}</span>
                      <span>A: {sceneStats.edges}</span>
                      <span>C: {sceneStats.faces}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* B. VIEWPORT MENU */}
          {openMenu.key === 'viewport' && (
            <div
              role="menu"
              aria-label="Menú Viewport"
              style={{ left: openMenu.left, top: openMenu.top }}
              onPointerDown={(e) => e.stopPropagation()}
              className="fixed w-[276px] max-h-[78vh] overflow-y-auto cad-scroll rounded-xl bg-[#181a1f] border border-[#343a47] shadow-2xl p-1.5 space-y-1"
            >
              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold text-[#8e95a2]">
                Modo de visualización
              </div>

              {DISPLAY_MODES.map((mode) => {
                const isActive = !mode.disabled && displayMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    disabled={Boolean(mode.disabled)}
                    onClick={() => {
                      if (mode.disabled) return;
                      onSelectDisplayMode(mode.id);
                    }}
                    className={`w-full min-h-[42px] px-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left transition-colors ${
                      mode.disabled
                        ? 'opacity-50 cursor-not-allowed text-[#7e8592]'
                        : isActive
                          ? 'bg-[#2c313b] border border-[#ff9900]/65 text-[#ff9900]'
                          : 'hover:bg-[#252932] text-[#e4e6eb] border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <ShadingModeIcon mode={mode.id} active={isActive} />
                      <span className="truncate">{mode.label}</span>
                    </span>
                    {mode.disabled ? (
                      <span className="flex items-center gap-1 text-[10px] text-[#8e95a2] shrink-0">
                        <Lock className="w-3 h-3" />
                        <span>Próximamente</span>
                      </span>
                    ) : isActive ? (
                      <Check className="w-4 h-4 text-[#ff9900] shrink-0" />
                    ) : null}
                  </button>
                );
              })}

              {/* X-Ray Transparency Slider (visible when X-Ray is active) */}
              {displayMode === 'xray' && (
                <div className="mx-1 mt-1 p-2.5 rounded-lg bg-[#121418] border border-[#2d323d] space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-[#e4e6eb]">
                      Transparencia X-Ray
                    </span>
                    <span className="font-mono-tabular font-semibold text-[#ff9900]">
                      {xrayTransparency}% · {getXrayDescriptor(xrayTransparency)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={90}
                    step={5}
                    value={xrayTransparency}
                    aria-label="Nivel de transparencia X-Ray"
                    onChange={(e) =>
                      onChangeXrayTransparency(parseInt(e.target.value, 10))
                    }
                    className="w-full h-5 accent-[#ff9900] cursor-pointer touch-pan-x"
                  />
                  <div className="grid grid-cols-5 gap-1">
                    {XRAY_PRESETS.map((preset) => {
                      const selected = xrayTransparency === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => onChangeXrayTransparency(preset.value)}
                          className={`h-7 rounded text-[10px] font-mono-tabular font-semibold border transition-colors ${
                            selected
                              ? 'bg-[#2c313b] border-[#ff9900]/75 text-[#ff9900]'
                              : 'bg-[#181b21] border-[#292d37] text-[#9ca3af] hover:text-white'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="my-1 border-t border-[#272b34]" />

              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold text-[#8e95a2]">
                Superposiciones e inspección
              </div>

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showFaceOrientation}
                onClick={onToggleFaceOrientation}
                className={`w-full min-h-[42px] px-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left transition-colors ${
                  showFaceOrientation
                    ? 'bg-[#2c313b] border border-[#3b82f6]/65 text-[#93c5fd]'
                    : 'hover:bg-[#252932] text-[#e4e6eb] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="inline-flex w-4 h-4 rounded-sm overflow-hidden border border-white/25 shrink-0"
                    aria-hidden="true"
                  >
                    <span className="w-1/2 h-full bg-[#2563eb]" />
                    <span className="w-1/2 h-full bg-[#e03131]" />
                  </span>
                  <span className="truncate">Face Orientation</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-[#8e95a2]">Azul/Rojo</span>
                  {showFaceOrientation && (
                    <Check className="w-4 h-4 text-[#60a5fa] shrink-0" />
                  )}
                </span>
              </button>

              <div className="my-1 border-t border-[#272b34]" />

              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold text-[#8e95a2]">
                Cámara y proyección
              </div>

              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={projection === 'perspective'}
                  onClick={() => {
                    onChangeProjection('perspective');
                    setOpenMenu(null);
                  }}
                  className={`min-h-[40px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    projection === 'perspective'
                      ? 'bg-[#2c313b] border-[#ff9900]/65 text-[#ff9900]'
                      : 'bg-[#1e2128] hover:bg-[#272b35] border-transparent text-[#d1d5db]'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5 shrink-0" />
                  <span>Perspectiva</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={projection === 'orthographic'}
                  onClick={() => {
                    onChangeProjection('orthographic');
                    setOpenMenu(null);
                  }}
                  className={`min-h-[40px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    projection === 'orthographic'
                      ? 'bg-[#2c313b] border-[#60a5fa]/65 text-[#93c5fd]'
                      : 'bg-[#1e2128] hover:bg-[#272b35] border-transparent text-[#d1d5db]'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5 shrink-0" />
                  <span>Ortográfica</span>
                </button>
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onFocusSelected();
                }}
                className="w-full min-h-[42px] px-2.5 rounded-lg hover:bg-[#252932] active:bg-[#2e333f] text-xs font-medium text-[#e4e6eb] flex items-center gap-2.5 text-left transition-colors"
              >
                <Focus className="w-4 h-4 text-[#ff9900] shrink-0" />
                <span>Encuadrar objeto seleccionado</span>
              </button>
            </div>
          )}

          {/* C. MODO MENU */}
          {openMenu.key === 'mode' && (
            <div
              role="menu"
              aria-label="Menú Modo"
              style={{ left: openMenu.left, top: openMenu.top }}
              onPointerDown={(e) => e.stopPropagation()}
              className="fixed w-[248px] max-h-[78vh] overflow-y-auto cad-scroll rounded-xl bg-[#181a1f] border border-[#343a47] shadow-2xl p-1.5 space-y-1"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={workMode === 'object'}
                onClick={() => {
                  onToggleWorkMode('object');
                  setOpenMenu(null);
                }}
                className={`w-full min-h-[42px] px-2.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-2 text-left transition-colors ${
                  workMode === 'object'
                    ? 'bg-[#2c313b] border border-[#ff9900]/65 text-[#ff9900]'
                    : 'hover:bg-[#252932] text-[#e4e6eb] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Box className="w-4 h-4 shrink-0" />
                  <span>Modo Objeto</span>
                </span>
                {workMode === 'object' && <Check className="w-4 h-4 shrink-0" />}
              </button>

              <button
                type="button"
                role="menuitemradio"
                aria-checked={workMode === 'edit'}
                disabled={!canEditSelected && workMode !== 'edit'}
                onClick={() => {
                  onToggleWorkMode('edit');
                  setOpenMenu(null);
                }}
                className={`w-full min-h-[42px] px-2.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-2 text-left transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  workMode === 'edit'
                    ? 'bg-[#2c313b] border border-[#ff9900]/65 text-[#ff9900]'
                    : 'hover:bg-[#252932] text-[#e4e6eb] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Triangle className="w-4 h-4 shrink-0" />
                  <span>Modo Edición</span>
                </span>
                {workMode === 'edit' && <Check className="w-4 h-4 shrink-0" />}
              </button>

              {/* Edit Selection Submodes (Vértices, Aristas, Caras) + Proportional Editing */}
              {workMode === 'edit' && (
                <>
                  <div className="mx-1 p-1 rounded-lg bg-[#121418] border border-[#2a2e38] grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: 'vertex', label: 'Vértices' },
                        { id: 'edge', label: 'Aristas' },
                        { id: 'face', label: 'Caras' },
                      ] as const
                    ).map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          onChangeEditSelectionMode(sub.id);
                          setOpenMenu(null);
                        }}
                        className={`min-h-[34px] rounded-md text-[11px] font-semibold transition-colors ${
                          editSelectionMode === sub.id
                            ? 'bg-[#2c313b] text-[#ff9900]'
                            : 'text-[#9ca3af] hover:text-white'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>

                  {onToggleProportional && (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={proportionalEnabled}
                      onClick={() => {
                        onToggleProportional();
                        setOpenMenu(null);
                      }}
                      className={`w-full min-h-[40px] px-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left transition-colors ${
                        proportionalEnabled
                          ? 'bg-[#2a1f10] border border-[#ff9900]/65 text-[#ffb84d]'
                          : 'hover:bg-[#252932] text-[#e4e6eb] border border-transparent'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <ProportionalIcon className="w-4 h-4 shrink-0" />
                        <span className="truncate">Edición proporcional</span>
                      </span>
                      <span className="text-[10px] font-mono-tabular text-[#8e95a2] shrink-0">
                        {proportionalEnabled ? 'ON · O' : 'O'}
                      </span>
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                role="menuitemradio"
                aria-checked={false}
                aria-disabled="true"
                disabled
                className="w-full min-h-[42px] px-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left opacity-50 cursor-not-allowed text-[#7e8592]"
              >
                <span className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>Modo Escultura</span>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-[#8e95a2] shrink-0">
                  <Lock className="w-3 h-3" />
                  <span>Próximamente</span>
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};
