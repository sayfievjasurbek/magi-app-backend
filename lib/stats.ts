export const average = (values: number[]): number | null =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;

export const fullName = (user: { first_name: string; last_name: string | null }) =>
  [user.first_name, user.last_name].filter(Boolean).join(' ');
