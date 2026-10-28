'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  value: string;
  className?: string;
  size?: 'sm' | 'icon';
}

export function CopyButton({ value, className, size = 'sm' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback — do nothing visible
    }
  };

  return (
    <Button
      variant="ghost"
      size={size === 'icon' ? 'icon' : 'sm'}
      onClick={handleCopy}
      className={cn('h-6 w-6 p-0 text-[var(--muted)] hover:text-[var(--text)]', className)}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <Check size={16} className="text-[var(--ok)]" /> : <Copy size={16} />}
    </Button>
  );
}
