export const toAmount = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

export const firstDefined = (...values: unknown[]) =>
  values.find((value) => value !== undefined && value !== null);
