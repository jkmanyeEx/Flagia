// Apply only to product-generated prose, never documents or user input.
// Stored reports can contain decorative icons from older engine versions.
export function systemText(value: string | null | undefined): string {
  return (value ?? '').replace(/\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*[ \t]*/gu, '').trim()
}
