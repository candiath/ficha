import { Clock } from 'lucide-react';
import { describeClockSkew, useClockSkewMinutes } from '@/lib/serverClock';

// Says so when this device's clock is a minute or more off the API's: dates
// filled in with "now" may come out wrong, and only the user can fix the clock.
export default function ClockSkewNotice() {
  const minutes = useClockSkewMinutes();
  if (minutes === 0) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <Clock className="h-4 w-4 shrink-0" />
      La hora de este dispositivo está {describeClockSkew(minutes)} respecto del servidor. Corregila en la
      configuración de fecha y hora.
    </div>
  );
}
