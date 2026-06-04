import { cn } from '@/lib/utils';

const VARIANTS = {
  new:  'bg-emerald-500',
  demo: 'bg-amber-400',
  wip:  'bg-blue-400',
} as const;

type Variant = keyof typeof VARIANTS;

export function PulseDot({ variant = 'new', className }: { variant?: Variant; className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)}>
      <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', VARIANTS[variant])} />
      <span className={cn('relative inline-flex rounded-full h-2 w-2', VARIANTS[variant])} />
    </span>
  );
}
