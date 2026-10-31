export type SaxAttributes = Record<string, unknown>;

export function readSaxAttribute(attributes: SaxAttributes, name: string): string {
  const expectedName = name.toLowerCase();
  for (const [attributeName, value] of Object.entries(attributes)) {
    if (attributeName.toLowerCase() === expectedName) {
      return attributeValue(value);
    }
  }
  return '';
}

export function normalizeSaxAttributes(attributes: SaxAttributes): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(attributes)) {
    const key = name.toLowerCase();
    if (!(key in normalized)) {
      normalized[key] = attributeValue(value);
    }
  }
  return normalized;
}

function attributeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') {
    return value.value;
  }
  return '';
}
