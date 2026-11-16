import React, { useEffect, useRef, useState } from 'react';
import { CopyPlus, FolderOpen, Plus, Save, Trash2, X } from 'lucide-react';
import { ProjectSummary } from '../core/project/types';

export type ProjectModalMode = 'create' | 'open' | 'save_as';

interface ProjectModalProps {
  initialMode?: ProjectModalMode;
  currentProjectId: string;
  currentProjectName: string;
  savedProjects: ProjectSummary[];
  onClose: () => void;
  onCreateProject: (name: string) => void;
  onSaveAsProject: (name: string) => void;
  onOpenProject: (id: string) => void;
  onSaveCurrent: () => void;
  onDeleteProject: (id: string) => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  initialMode = 'open',
  currentProjectId,
  currentProjectName,
  savedProjects,
  onClose,
  onCreateProject,
  onSaveAsProject,
  onOpenProject,
  onSaveCurrent,
  onDeleteProject,
}) => {
  const [newName, setNewName] = useState('');
  const [saveAsName, setSaveAsName] = useState(`${currentProjectName} copia`);
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const saveAsInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialMode === 'create') {
      window.setTimeout(() => createInputRef.current?.focus(), 40);
    } else if (initialMode === 'save_as') {
      window.setTimeout(() => {
        saveAsInputRef.current?.focus();
        saveAsInputRef.current?.select();
      }, 40);
    }
  }, [initialMode]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateProject(newName.trim() || 'Nuevo Proyecto');
    setNewName('');
    onClose();
  };

  const handleSaveAs = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveAsProject(saveAsName.trim() || `${currentProjectName} copia`);
    onClose();
  };

  const title =
    initialMode === 'create'
      ? 'Crear Nuevo Proyecto'
      : initialMode === 'save_as'
        ? 'Guardar Proyecto Como'
        : 'Abrir Proyecto Local';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-[#1c1e24] border border-[#323640] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 border-b border-[#2b2e36] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#f3f4f6]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-md hover:bg-[#2a2e38] text-[#9ca3af] hover:text-white flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto cad-scroll">
          {/* Save Current */}
          <div className="p-3 rounded-md bg-[#15171c] border border-[#2b2e36] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-[#9ca3af]">Proyecto actual</div>
              <div className="text-sm font-semibold text-[#f3f4f6] truncate">
                {currentProjectName}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onSaveCurrent();
              }}
              className="h-10 px-3.5 rounded-md bg-[#d97706] hover:bg-[#e5840b] text-[#111215] text-xs font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>Guardar</span>
            </button>
          </div>

          {/* Save Project As */}
          {initialMode === 'save_as' && (
            <form
              onSubmit={handleSaveAs}
              className="p-3 rounded-md bg-[#15171c] border border-[#ff9900]/45 space-y-2"
            >
              <label className="block text-xs font-semibold text-[#ff9900]">
                Nombre de la nueva copia
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={saveAsInputRef}
                  type="text"
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  placeholder="Nombre de la copia..."
                  className="flex-1 h-10 px-3 rounded-md bg-[#111317] border border-[#2f333d] focus:border-[#ff9900] text-xs text-[#f3f4f6] outline-none"
                />
                <button
                  type="submit"
                  className="h-10 px-3.5 rounded-md bg-[#ff9900] hover:bg-[#ffa726] text-xs font-bold text-[#111215] flex items-center gap-1.5 shrink-0"
                >
                  <CopyPlus className="w-4 h-4" />
                  <span>Guardar copia</span>
                </button>
              </div>
            </form>
          )}

          {/* Create New Project */}
          <form
            onSubmit={handleCreate}
            className={`space-y-1.5 ${
              initialMode === 'create'
                ? 'p-3 rounded-md bg-[#15171c] border border-[#ff9900]/45'
                : ''
            }`}
          >
            <label
              className={`block text-xs font-medium ${
                initialMode === 'create' ? 'text-[#ff9900] font-semibold' : 'text-[#b4bac4]'
              }`}
            >
              Crear nuevo proyecto
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={createInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del proyecto..."
                className="flex-1 h-10 px-3 rounded-md bg-[#111317] border border-[#2f333d] focus:border-[#ff9900] text-xs text-[#f3f4f6] outline-none"
              />
              <button
                type="submit"
                className="h-10 px-3.5 rounded-md bg-[#2a2f3a] hover:bg-[#353b48] border border-[#3c4250] text-xs font-semibold text-[#f3f4f6] flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4 text-[#ff9900]" />
                <span>Crear</span>
              </button>
            </div>
          </form>

          {/* Saved Projects List */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-[#b4bac4]">
              Proyectos guardados ({savedProjects.length})
            </div>

            {savedProjects.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8e95a2] border border-dashed border-[#2b2e36] rounded-md">
                No hay proyectos guardados aún.
              </div>
            ) : (
              <div className="space-y-1.5">
                {savedProjects.map((proj) => {
                  const isCurrent = proj.id === currentProjectId;
                  return (
                    <div
                      key={proj.id}
                      className={`p-2.5 rounded-md border flex items-center justify-between gap-2 ${
                        isCurrent
                          ? 'bg-[#252932] border-[#ff9900]/45'
                          : 'bg-[#16181d] border-[#292c34]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-[#eceef2] truncate">
                          {proj.name}
                        </div>
                        <div className="text-[11px] text-[#8e95a2] font-mono-tabular">
                          {proj.objectCount} obj. ·{' '}
                          {new Date(proj.updatedAt).toLocaleString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenProject(proj.id);
                            onClose();
                          }}
                          className="h-9 px-3 rounded bg-[#2a2f3a] hover:bg-[#353b48] text-xs font-medium text-[#f3f4f6] flex items-center gap-1.5"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-[#ff9900]" />
                          <span>Abrir</span>
                        </button>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => onDeleteProject(proj.id)}
                            className="h-9 w-9 rounded bg-[#251a1d] hover:bg-[#3a2226] text-[#e06c75] flex items-center justify-center"
                            title="Eliminar proyecto guardado"
                            aria-label={`Eliminar ${proj.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
