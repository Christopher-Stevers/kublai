import { open } from "node:fs/promises";

/** Bounded reads with descriptor cleanup on completion, failure, and cancellation. */
export async function openStreamingFile(filename: string) {
  const file = await open(filename, "r");
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Invalid drawing file");
    const size = Number(info.size);
    const modified = new Date(Number(info.mtimeMs));
    // Upload files are immutable. Include inode and nanosecond change times so
    // replacements of legacy mutable paths invalidate their cached validator too.
    const etag = `"${info.ino.toString(16)}-${info.size.toString(16)}-${info.mtimeNs.toString(16)}-${info.ctimeNs.toString(16)}"`;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await file.close();
    };
    return {
      size,
      modified,
      etag,
      close,
      stream(start = 0, end = size - 1) {
        let position = start;
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (closed) return;
            if (position > end) {
              await close();
              controller.close();
              return;
            }
            try {
              const buffer = new Uint8Array(
                Math.min(64 * 1024, end - position + 1),
              );
              const { bytesRead } = await file.read(
                buffer,
                0,
                buffer.length,
                position,
              );
              if (closed) return;
              if (bytesRead === 0)
                throw new Error("Drawing file changed during transfer");
              position += bytesRead;
              controller.enqueue(buffer.subarray(0, bytesRead));
              if (position > end) {
                await close();
                controller.close();
              }
            } catch (error) {
              await close().catch(() => undefined);
              controller.error(error);
            }
          },
          cancel: close,
        });
      },
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
