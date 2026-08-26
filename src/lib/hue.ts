/**
 * A stable hue for a name.
 *
 * Shared by avatars and the workspace tile so the same organisation or person
 * is always the same colour — two components deriving colour independently is
 * how a UI ends up with the same name in two different shades.
 */
export function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
