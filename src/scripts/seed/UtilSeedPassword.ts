const ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

export class UtilSeedPassword {
  /**
   * Cryptographically random password. Rejection sampling keeps every
   * alphabet symbol equally likely (no modulo bias).
   */
  static generate(length = 24): string {
    const limit = 256 - (256 % ALPHABET.length);
    let out = "";
    while (out.length < length) {
      const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
      for (const byte of bytes) {
        if (byte < limit && out.length < length) {
          out += ALPHABET[byte % ALPHABET.length];
        }
      }
    }
    return out;
  }
}
