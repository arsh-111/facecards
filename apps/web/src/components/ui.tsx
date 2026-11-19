import { motion } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { sound } from '../lib/feedback';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'stop';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-crimson to-wine text-white shadow-glow border border-rose/30 hover:brightness-110',
  ghost: 'glass text-blush hover:border-rose/40',
  quiet: 'bg-transparent text-mist underline-offset-4 hover:text-blush hover:underline',
  danger: 'bg-transparent border border-crimson/70 text-rose hover:bg-crimson/20',
  stop: 'bg-rose text-ink font-semibold shadow-rose hover:brightness-105',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`min-h-12 rounded-2xl px-5 py-3 text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      onClick={(e) => {
        sound.tap();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Selectable chip with a glow "ignite" ripple when selected (Section 8.2). */
export function Chip({
  selected,
  onToggle,
  children,
  disabled,
  role = 'checkbox',
}: {
  selected: boolean;
  onToggle?: () => void;
  children: ReactNode;
  disabled?: boolean;
  role?: 'checkbox' | 'radio';
}) {
  return (
    <motion.button
      type="button"
      role={role}
      aria-checked={selected}
      disabled={disabled}
      onClick={() => {
        sound.tap();
        onToggle?.();
      }}
      whileTap={{ scale: 0.96 }}
      className={`relative min-h-12 overflow-hidden rounded-full border px-4 py-2 text-sm transition disabled:opacity-50 ${
        selected
          ? 'border-rose/70 bg-wine/70 text-white shadow-glow'
          : 'border-rose/20 bg-night/60 text-mist hover:border-rose/40'
      }`}
    >
      {selected && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-rose/30"
          initial={{ scale: 0.2, opacity: 0.8 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      )}
      <span className="relative">
        {selected ? '✓ ' : ''}
        {children}
      </span>
    </motion.button>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass rounded-3xl p-5 ${className}`}>{children}</section>;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o.value} role="radio" selected={o.value === value} disabled={disabled} onToggle={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full border transition ${
          checked ? 'border-rose/70 bg-crimson' : 'border-rose/20 bg-night'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-blush transition-all ${checked ? 'left-6' : 'left-0.5'}`}
        />
        <span className="sr-only">{checked ? 'on' : 'off'}</span>
      </button>
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 font-display text-lg text-rose">{children}</h2>;
}
