export const isObject = (value: unknown): value is Record<string | number, any> => typeof value === "object" && value !== null

export const isArray = (value: unknown): value is Array<any> => Array.isArray(value)
