import { EventEmitter } from "events";
import { nextTick } from "process";
import { Readable, Writable } from "stream";

export async function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export function once(emitter: EventEmitter, name: string) {
  return new Promise((resolve, reject) => {
    const eventListener = (...args: any[]) => {
      if (errorListener !== undefined) {
        emitter.removeListener('error', errorListener);
      }
      resolve(args);
    };
    let errorListener: (err: Error) => void

    // Adding an error listener is not optional because
    // if an error is thrown on an event emitter we cannot
    // guarantee that the actual event we are waiting will
    // be fired. The result could be a silent way to create
    // memory or file descriptor leaks, which is something
    // we should avoid.
    if (name !== 'error') {
      errorListener = (err: Error) => {
        emitter.removeListener(name, eventListener);
        reject(err);
      };

      emitter.once('error', errorListener);
    }

    emitter.once(name, eventListener);
  });
}

export function readLengthPackets(readable: Readable, littleEndian?: boolean, emitter?: EventEmitter): EventEmitter {
  const eventEmitter = emitter || new EventEmitter();

  async function startReader() {
    try {
      while (true) {
        const packet = await readLengthPacket(readable, littleEndian);
        eventEmitter.emit('packet', packet);
      }
    }
    catch (e) {
      eventEmitter.emit('error', e);
    }
  }

  nextTick(startReader);
  return eventEmitter;
}

export async function readLengthPacket(readable: Readable, littleEndian?: boolean): Promise<Buffer|undefined> {
  const lenBuffer = await readLength(readable, 4);
  if (lenBuffer === undefined) {
    return;
  }

  let len: number
  if (littleEndian)
    len = lenBuffer.readInt32LE(0);
  else
    len = lenBuffer.readInt32BE(0);

  return readLength(readable, len);
}

export async function readLength(readable: Readable, length: number): Promise<Buffer> {
  if (!length) {
    return Buffer.alloc(0);
  }

  {
    const ret = readable.read(length);
    if (ret) {
      return ret;
    }
  }

  return new Promise((resolve, reject) => {
    const r = () => {
      const ret = readable.read(length);
      if (ret) {
        cleanup();
        resolve(ret);
      }
    };

    const e = () => {
      cleanup();
      reject(new Error(`stream ended during read for minimum ${length} bytes`))
    };

    const cleanup = () => {
      readable.removeListener('readable', r);
      readable.removeListener('end', e);
    }

    readable.on('readable', r);
    readable.on('end', e);
  });
}

export async function readChunk(readable: Readable, minLength?: number, maxLength?: number): Promise<Buffer|undefined> {
  // readableLength does not seem to be reliable, because if data is push or unshift to an anonymous
  // Readable implementation, it is not updated.
  {
    const buffer = readable.read();
    if (buffer) {
      if (!minLength || buffer.byteLength >= minLength) {
        if (maxLength && buffer.byteLength > maxLength) {
          const sub = buffer.subarray(0, maxLength);
          const left = buffer.subarray(maxLength);
          readable.unshift(left);
          // buffer trimmed to under max length
          return sub;
        }

        // buffer fits within range
        return buffer;
      }

      // buffer is too small
      readable.unshift(buffer);
    }
  }

  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];

    const endInternal = () => {
      if (minLength)
        reject(new Error(`stream ended during read for minimum ${minLength} bytes`));
      else
        resolve(undefined);
    }

    const readableAny = readable as any;
    if (readableAny.readableEnded || readableAny._readableState.ended) {
      endInternal();
      return;
    }

    const cleanup = () => {
      readable.removeListener('data', data);
      readable.removeListener('end', end);
    }
    const end = () => {
      cleanup();
      endInternal();
    };

    let byteLength = 0;
    const data = (d: Buffer) => {
      buffers.push(d);
      byteLength += d.byteLength;

      if (!minLength || byteLength >= minLength) {
        cleanup();
        readable.pause();
        const buffer = Buffer.concat(buffers);
        if (maxLength && byteLength > maxLength) {
          readable.unshift(buffer);
          resolve(readable.read(maxLength));
        }
        else {
          resolve(buffer);
        }
      }
    }
    readable.on('error', end);
    readable.on('close', end);
    readable.on('end', end);
    readable.on('data', data);
    readable.resume();
  });
}

export async function readString(readable: Readable | Promise<Readable>) {
  let data = '';
  readable = await readable;
  readable.on('data', buffer => {
    data += buffer.toString();
  });
  readable.resume();
  await once(readable, 'end')
  return data;
}

export async function readBuffer(readable: Readable | Promise<Readable>) {
  const data: Buffer[] = [];
  readable = await readable;
  readable.on('data', buffer => {
    data.push(buffer);
  });
  readable.resume();
  await once(readable, 'end')
  return Buffer.concat(data);
}

const CHARCODE_NEWLINE = '\n'.charCodeAt(0);

export async function readUntil(readable: Readable, charCode: number) {
  const data = [];
  let count = 0;
  while (true) {
    const buffer = await readLength(readable, 1);
    if (!buffer)
      throw new Error("end of stream");
    if (buffer[0] === charCode)
      break;
    data[count++] = buffer[0];
  }
  return Buffer.from(data).toString();
}

export async function readLine(readable: Readable) {
  return readUntil(readable, CHARCODE_NEWLINE);
}

export async function write(writable: Writable, chunk: any) {
  return new Promise((resolve, reject) => {
    writable.write(chunk, (e) => {
      if (e)
        reject(e);
      else
        resolve(null);
    });
  });
}
