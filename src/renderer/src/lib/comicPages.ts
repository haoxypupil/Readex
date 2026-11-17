export function clampComicPage(value: number, total: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(total, Math.round(value)))
}

/** 双页组合固定为 (1,2)、(3,4)，把起始页对齐到奇数页。 */
export function snapSpreadStart(page: number): number {
  return page % 2 === 0 ? page - 1 : page
}
