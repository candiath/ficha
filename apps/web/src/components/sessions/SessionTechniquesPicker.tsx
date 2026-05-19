import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { techniqueApi, techniqueKeys } from '@/services/techniques';
import { bodyRegionApi, bodyRegionKeys } from '@/services/bodyRegions';
import { muscularChainApi, muscularChainKeys } from '@/services/muscularChains';

export interface TechniqueEntry {
  id: string;
  techniqueId: string;
  techniqueName: string;
  bodyRegionId: string;
  bodyRegionName: string;
  muscularChainId: string;
  muscularChainName: string;
  variantNotes: string;
}

interface Props {
  value: TechniqueEntry[];
  onChange: (entries: TechniqueEntry[]) => void;
}

export default function SessionTechniquesPicker({ value, onChange }: Props) {
  const { data: techniques = [] } = useQuery({
    queryKey: techniqueKeys.all,
    queryFn: techniqueApi.list,
  });

  const { data: bodyRegions = [] } = useQuery({
    queryKey: bodyRegionKeys.all,
    queryFn: bodyRegionApi.list,
  });

  const { data: muscularChains = [] } = useQuery({
    queryKey: muscularChainKeys.all,
    queryFn: muscularChainApi.list,
  });

  const [selectedTechnique, setSelectedTechnique] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedChain, setSelectedChain] = useState('');
  const [variantNotes, setVariantNotes] = useState('');

  function addEntry() {
    if (!selectedTechnique) return;
    const technique = techniques.find((t) => t.id === selectedTechnique);
    if (!technique) return;
    const region = bodyRegions.find((r) => r.id === selectedRegion);
    const chain = muscularChains.find((c) => c.id === selectedChain);

    const entry: TechniqueEntry = {
      id: crypto.randomUUID(),
      techniqueId: technique.id,
      techniqueName: technique.name,
      bodyRegionId: region?.id ?? '',
      bodyRegionName: region?.name ?? '',
      muscularChainId: chain?.id ?? '',
      muscularChainName: chain?.name ?? '',
      variantNotes,
    };

    onChange([...value, entry]);
    setSelectedTechnique('');
    setSelectedRegion('');
    setSelectedChain('');
    setVariantNotes('');
  }

  function removeEntry(id: string) {
    onChange(value.filter((e) => e.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Técnicas aplicadas</p>
      </div>

      {/* Fila para agregar */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Técnica *</label>
          <Select value={selectedTechnique} onValueChange={(v) => setSelectedTechnique(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Elegir técnica" />
            </SelectTrigger>
            <SelectContent>
              {techniques.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-2">
                    {t.name}
                    {t.isGlobal && (
                      <span className="text-[10px] text-muted-foreground font-normal">
                        (global)
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Región corporal</label>
          <Select value={selectedRegion} onValueChange={(v) => setSelectedRegion(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Opcional" />
            </SelectTrigger>
            <SelectContent>
              {bodyRegions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cadena muscular</label>
          <Select value={selectedChain} onValueChange={(v) => setSelectedChain(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Opcional" />
            </SelectTrigger>
            <SelectContent>
              {muscularChains.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Variante / Notas</label>
          <Input
            placeholder="Ej: apertura brazo izq."
            value={variantNotes}
            onChange={(e) => setVariantNotes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addEntry();
              }
            }}
          />
        </div>

        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={addEntry}
          disabled={!selectedTechnique}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Lista de técnicas agregadas */}
      {value.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="divide-y">
            {value.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span className="font-medium">{entry.techniqueName}</span>
                  {entry.bodyRegionName && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"
                    >
                      {entry.bodyRegionName}
                    </Badge>
                  )}
                  {entry.muscularChainName && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                    >
                      {entry.muscularChainName}
                    </Badge>
                  )}  
                  {entry.variantNotes && (
                    <span className="text-muted-foreground text-xs truncate max-w-[160px]">
                      — {entry.variantNotes}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeEntry(entry.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Agregá las técnicas y posturas utilizadas en esta sesión.
        </p>
      )}
    </div>
  );
}
