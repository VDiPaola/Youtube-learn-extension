/** YouTube gzips InnerTube request bodies, so decompress before reading JSON. */
export async function decodeRequestBody(body: unknown): Promise<string | undefined> {
  if (body === null || body === undefined || body instanceof ReadableStream) return undefined;
  if (typeof body === 'string') return body;

  const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}
