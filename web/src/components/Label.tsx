import type { CSSProperties, ElementType, ReactNode } from 'react';

export default function Label({ children, as: Tag = 'span', style, className }: { children: ReactNode; as?: ElementType; style?: CSSProperties; className?: string }) {
  return <Tag className={'label' + (className ? ' ' + className : '')} style={style}>{children}</Tag>;
}
