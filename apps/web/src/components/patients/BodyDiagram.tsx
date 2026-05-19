import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { BodyMarker } from '@/types/evaluation';

interface BodyDiagramProps {
  markers: BodyMarker[];
  onAddMarker?: (marker: Omit<BodyMarker, 'id'>) => void;
  onRemoveMarker?: (markerId: string) => void;
  readOnly?: boolean;
  className?: string;
}

const severityColors = {
  low: 'bg-chart-4 border-chart-4',
  medium: 'bg-chart-3 border-chart-3',
  high: 'bg-destructive border-destructive',
};

const severityLabels = {
  low: 'Leve',
  medium: 'Moderado',
  high: 'Severo',
};

export function BodyDiagram({
  markers,
  onAddMarker,
  onRemoveMarker,
  readOnly = false,
  className,
}: BodyDiagramProps) {
  const [activeView, setActiveView] = useState<'front' | 'back'>('front');
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newMarker, setNewMarker] = useState<{
    x: number;
    y: number;
    label: string;
    severity: 'low' | 'medium' | 'high';
    notes: string;
  } | null>(null);

  const filteredMarkers = markers.filter((m) => m.view === activeView);

  const handleDiagramClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !isAdding) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setNewMarker({ x, y, label: '', severity: 'medium', notes: '' });
  };

  const handleSaveMarker = () => {
    if (newMarker && newMarker.label && onAddMarker) {
      onAddMarker({
        x: newMarker.x,
        y: newMarker.y,
        view: activeView,
        label: newMarker.label,
        severity: newMarker.severity,
        notes: newMarker.notes,
      });
      setNewMarker(null);
      setIsAdding(false);
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveView('front')}
            className={cn(
              'px-4 py-2 text-sm rounded-md transition-colors',
              activeView === 'front'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            Vista Anterior
          </button>
          <button
            type="button"
            onClick={() => setActiveView('back')}
            className={cn(
              'px-4 py-2 text-sm rounded-md transition-colors',
              activeView === 'back'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            Vista Posterior
          </button>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setIsAdding(!isAdding)}
            className={cn(
              'px-4 py-2 text-sm rounded-md transition-colors',
              isAdding
                ? 'bg-chart-1 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {isAdding ? 'Cancelar' : '+ Agregar marca'}
          </button>
        )}
      </div>

      {isAdding && (
        <p className="text-sm text-chart-1">
          Hacé clic en el diagrama para marcar una zona afectada
        </p>
      )}

      {/* Body Diagram */}
      <div className="flex gap-6">
        <div
          className={cn(
            'relative bg-muted/30 rounded-lg border-2 border-dashed border-border flex-1 aspect-[1/2] max-w-[300px]',
            isAdding && 'cursor-crosshair border-chart-1',
          )}
          onClick={handleDiagramClick}
        >
          {/* Body Silhouette SVG */}
          {/* TODO: Reemplazar con un SVG más detallado y preciso, posiblemente con paths separados para cada región del cuerpo para permitir una interacción más específica. */}
          <svg
            viewBox="0 0 100 200"
            className="w-full h-full text-muted-foreground/30"
            fill="currentColor" 
          >
            {activeView === 'front' ? (
              <>
                <ellipse cx="50" cy="15" rx="12" ry="14" />
                <rect x="45" y="28" width="10" height="8" />
                <path d="M30 36 L70 36 L75 100 L25 100 Z" />
                <path d="M30 38 L15 80 L18 82 L35 45 Z" />
                <path d="M70 38 L85 80 L82 82 L65 45 Z" />
                <ellipse cx="14" cy="85" rx="4" ry="6" />
                <ellipse cx="86" cy="85" rx="4" ry="6" />
                <path d="M30 100 L28 160 L38 160 L42 100 Z" />
                <path d="M70 100 L72 160 L62 160 L58 100 Z" />
                <ellipse cx="33" cy="170" rx="8" ry="12" />
                <ellipse cx="67" cy="170" rx="8" ry="12" />
              </>
            ) : (
              <>
                <ellipse cx="50" cy="15" rx="12" ry="14" />
                <rect x="45" y="28" width="10" height="8" />
                <path d="M30 36 L70 36 L72 100 L28 100 Z" />
                <line
                  x1="50"
                  y1="36"
                  x2="50"
                  y2="100"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeDasharray="2"
                  opacity="0.5"
                />
                <path d="M30 38 L15 80 L18 82 L35 45 Z" />
                <path d="M70 38 L85 80 L82 82 L65 45 Z" />
                <ellipse cx="14" cy="85" rx="4" ry="6" />
                <ellipse cx="86" cy="85" rx="4" ry="6" />
                <path d="M30 100 L28 160 L38 160 L42 100 Z" />
                <path d="M70 100 L72 160 L62 160 L58 100 Z" />
                <ellipse cx="33" cy="170" rx="8" ry="12" />
                <ellipse cx="67" cy="170" rx="8" ry="12" />
              </>
            )}
          </svg>

          {/* Markers */}
          {filteredMarkers.map((marker) => (
            <button
              type="button"
              key={marker.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedMarker(selectedMarker === marker.id ? null : marker.id);
              }}
              className={cn(
                'absolute w-5 h-5 rounded-full border-2 transform -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-125',
                severityColors[marker.severity],
                selectedMarker === marker.id && 'ring-2 ring-primary ring-offset-2',
              )}
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              title={marker.label}
            />
          ))}

          {/* New marker preview */}
          {newMarker && (
            <div
              className="absolute w-5 h-5 rounded-full border-2 border-dashed border-chart-1 bg-chart-1/50 transform -translate-x-1/2 -translate-y-1/2 animate-pulse"
              style={{ left: `${newMarker.x}%`, top: `${newMarker.y}%` }}
            />
          )}
        </div>

        {/* Marker Details / Add Form */}
        <div className="flex-1 min-w-[250px]">
          {newMarker ? (
            <div className="space-y-4 p-4 bg-muted/30 rounded-lg">
              <h4 className="font-medium text-foreground">Nueva marca</h4>
              <div>
                <label className="text-sm text-muted-foreground">Etiqueta *</label>
                <input
                  type="text"
                  value={newMarker.label}
                  onChange={(e) => setNewMarker({ ...newMarker, label: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-md text-foreground"
                  placeholder="Ej: Tensión en trapecio"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Severidad</label>
                <div className="flex gap-2 mt-1">
                  {(['low', 'medium', 'high'] as const).map((sev) => (
                    <button
                      type="button"
                      key={sev}
                      onClick={() => setNewMarker({ ...newMarker, severity: sev })}
                      className={cn(
                        'px-3 py-1 text-sm rounded-md border transition-colors',
                        newMarker.severity === sev
                          ? severityColors[sev] + ' text-white'
                          : 'border-border text-muted-foreground hover:border-foreground',
                      )}
                    >
                      {severityLabels[sev]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Notas</label>
                <textarea
                  value={newMarker.notes}
                  onChange={(e) => setNewMarker({ ...newMarker, notes: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-md text-foreground resize-none"
                  rows={2}
                  placeholder="Observaciones adicionales..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveMarker}
                  disabled={!newMarker.label}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setNewMarker(null)}
                  className="px-4 py-2 border border-border rounded-md text-muted-foreground hover:bg-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : selectedMarker ? (
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
              {(() => {
                const marker = markers.find((m) => m.id === selectedMarker);
                if (!marker) return null;
                return (
                  <>
                    <div className="flex items-start justify-between">
                      <h4 className="font-medium text-foreground">{marker.label}</h4>
                      <span
                        className={cn(
                          'text-xs px-2 py-1 rounded-full text-white',
                          severityColors[marker.severity],
                        )}
                      >
                        {severityLabels[marker.severity]}
                      </span>
                    </div>
                    {marker.notes && (
                      <p className="text-sm text-muted-foreground">{marker.notes}</p>
                    )}
                    {!readOnly && onRemoveMarker && (
                      <button
                        type="button"
                        onClick={() => {
                          onRemoveMarker(marker.id);
                          setSelectedMarker(null);
                        }}
                        className="text-sm text-destructive hover:underline"
                      >
                        Eliminar marca
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="font-medium text-foreground">
                Marcas en {activeView === 'front' ? 'vista anterior' : 'vista posterior'}
              </h4>
              {filteredMarkers.length > 0 ? (
                <div className="space-y-2">
                  {filteredMarkers.map((marker) => (
                    <button
                      type="button"
                      key={marker.id}
                      onClick={() => setSelectedMarker(marker.id)}
                      className="w-full text-left p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn('w-3 h-3 rounded-full', severityColors[marker.severity])} />
                        <span className="text-sm text-foreground">{marker.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No hay marcas en esta vista</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">Severidad:</span>
        {(['low', 'medium', 'high'] as const).map((sev) => (
          <div key={sev} className="flex items-center gap-1">
            <div className={cn('w-3 h-3 rounded-full', severityColors[sev])} />
            <span className="text-muted-foreground">{severityLabels[sev]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
