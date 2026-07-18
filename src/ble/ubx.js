const HEADER_A = 0xb5;
const HEADER_B = 0x62;
const MAX_PACKET_SIZE = 512;

export function checksum(bytes) {
  let a = 0;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) & 0xff;
    b = (b + a) & 0xff;
  }
  return [a, b];
}

export class UbxStreamParser {
  #buffer = new Uint8Array(0);

  push(chunk) {
    const input = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer ?? chunk);
    const joined = new Uint8Array(this.#buffer.length + input.length);
    joined.set(this.#buffer);
    joined.set(input, this.#buffer.length);
    this.#buffer = joined;

    const packets = [];
    while (this.#buffer.length >= 8) {
      const start = this.#findHeader();
      if (start < 0) {
        this.#buffer = this.#buffer.at(-1) === HEADER_A ? this.#buffer.slice(-1) : new Uint8Array(0);
        break;
      }
      if (start > 0) this.#buffer = this.#buffer.slice(start);
      if (this.#buffer.length < 8) break;

      const payloadLength = this.#buffer[4] | (this.#buffer[5] << 8);
      const packetLength = 8 + payloadLength;
      if (packetLength > MAX_PACKET_SIZE) {
        this.#buffer = this.#buffer.slice(2);
        continue;
      }
      if (this.#buffer.length < packetLength) break;
      const packet = this.#buffer.slice(0, packetLength);
      this.#buffer = this.#buffer.slice(packetLength);
      const [a, b] = checksum(packet.slice(2, -2));
      if (a !== packet.at(-2) || b !== packet.at(-1)) continue;
      packets.push({ messageClass: packet[2], messageId: packet[3], payload: packet.slice(6, -2), raw: packet });
    }
    return packets;
  }

  #findHeader() {
    for (let index = 0; index < this.#buffer.length - 1; index += 1) {
      if (this.#buffer[index] === HEADER_A && this.#buffer[index + 1] === HEADER_B) return index;
    }
    return -1;
  }
}

export function encodePacket(messageClass, messageId, payload = new Uint8Array(0)) {
  const packet = new Uint8Array(payload.length + 8);
  packet.set([HEADER_A, HEADER_B, messageClass, messageId, payload.length & 0xff, payload.length >> 8]);
  packet.set(payload, 6);
  packet.set(checksum(packet.slice(2, -2)), packet.length - 2);
  return packet;
}
