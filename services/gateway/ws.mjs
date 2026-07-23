import crypto from "node:crypto";

/**
 * Minimal authenticated WebSocket upgrade (no external deps).
 */

export function acceptWebSocket(req, socket, head, { token } = {}) {
  const url = new URL(req.url || "/", "http://localhost");
  const auth =
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("token") ||
    "";
  if (!token || auth !== token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }

  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  if (head?.length) socket.unshift(head);

  const client = {
    socket,
    send(obj) {
      const payload = Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj));
      socket.write(encodeFrame(payload));
    },
    close() {
      try { socket.end(); } catch { /* ignore */ }
    },
  };

  socket.on("data", (buf) => {
    const messages = decodeFrames(buf);
    for (const msg of messages) {
      if (msg.opcode === 0x8) {
        client.close();
        return;
      }
      if (msg.opcode === 0x9) {
        // ping -> pong
        socket.write(encodeFrame(msg.payload, 0xA));
        continue;
      }
      if (msg.opcode !== 0x1) continue;
      let data = null;
      try { data = JSON.parse(msg.payload.toString("utf8")); } catch { data = { type: "text", text: msg.payload.toString("utf8") }; }
      client.onMessage?.(data);
    }
  });

  return client;
}

function encodeFrame(payload, opcode = 0x1) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf) {
  const out = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    offset += 2;
    if (len === 126) {
      if (offset + 2 > buf.length) break;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (offset + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }
    let mask = null;
    if (masked) {
      if (offset + 4 > buf.length) break;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (offset + len > buf.length) break;
    let payload = buf.subarray(offset, offset + len);
    offset += len;
    if (mask) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    out.push({ opcode, payload });
  }
  return out;
}
