/** A line of text's name in the voice pack. The generator in `tools/voice/` uses this too, so that
 *  a line finds its recording and nothing has to be kept in step by hand. */
export function lineKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
