import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Common = { variant?: 'solid' | 'ghost'; size?: 'sm' | 'md' | 'lg'; children: ReactNode; style?: CSSProperties; className?: string };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'style' | 'className'> & { to?: undefined; href?: undefined };
type AsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'style' | 'className' | 'href'> & { to: string; href?: undefined };
type AsHref = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'style' | 'className'> & { href: string; to?: undefined };

const H = { sm: 30, md: 36, lg: 48 } as const;

/** Black pill (solid) or hairline pill (ghost). Renders <button>, router <Link> (to) or <a> (href). */
export default function Pill(props: AsButton | AsLink | AsHref) {
  const { variant = 'solid', size = 'md', children, style, className, ...rest } = props as Common & Record<string, unknown>;
  const cls = 'pill' + (variant === 'ghost' ? ' ghost' : '') + (className ? ' ' + className : '');
  const st: CSSProperties = { height: H[size], ...(size === 'lg' ? { fontSize: 15, padding: '0 28px' } : null), ...style };
  if (typeof rest.to === 'string') {
    const { to, ...r } = rest as { to: string } & Record<string, unknown>;
    return <Link to={to} className={cls} style={st} {...(r as object)}>{children}</Link>;
  }
  if (typeof rest.href === 'string') return <a className={cls} style={st} {...(rest as object)}>{children}</a>;
  return <button type="button" className={cls} style={st} {...(rest as object)}>{children}</button>;
}
