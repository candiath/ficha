import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingDown } from 'lucide-react';
import type { Session } from '@/types/session';

interface Props {
  sessions: Session[];
}

export default function PainEvolutionChart({ sessions }: Props) {
  const data = sessions
    .filter((s) => s.painScaleBefore !== null || s.painScaleAfter !== null)
    .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
    .map((s, i) => ({
      name: new Date(s.sessionDate).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
      }),
      session: i + 1,
      antes: s.painScaleBefore,
      despues: s.painScaleAfter,
    }));

  if (data.length < 2) return null;

  // Calcular mejoría promedio
  const deltas = data
    .filter((d) => d.antes !== null && d.despues !== null)
    .map((d) => (d.antes as number) - (d.despues as number));
  const avgImprovement = deltas.length > 0
    ? (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1)
    : null;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Evolución del dolor</CardTitle>
          </div>
          {avgImprovement !== null && (
            <span className="text-xs text-muted-foreground">
              Mejoría promedio:{' '}
              <span className="font-semibold text-green-600 dark:text-green-400">
                {avgImprovement} pts
              </span>
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="name"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)' }}
            />
            <YAxis
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
                boxShadow: 'var(--shadow-md)',
              }}
              labelStyle={{ fontWeight: 600 }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={30}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '12px' }}
            />
            <Line
              type="monotone"
              dataKey="antes"
              name="Antes"
              stroke="var(--chart-5)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--chart-5)' }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="despues"
              name="Después"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--chart-1)' }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
