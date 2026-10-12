export function identityFromEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  const local = at > 0 ? trimmed.slice(0, at) : trimmed;
  const domain = at > 0 ? trimmed.slice(at + 1) : 'plant.local';
  const display = titleCase(local) || 'Plant operator';
  const organization = titleCase(domain.split('.')[0] || 'Plant') || 'Plant';
  return {
    display_name: clip(display),
    organization_name: clip(`${organization} operations`),
    plant_name: clip(`${organization} plant`),
  };
}

function titleCase(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function clip(value: string) {
  return value.slice(0, 80);
}
