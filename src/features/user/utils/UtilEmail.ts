/** One normalization for every e-mail write and lookup [SEC-21]. */
export class UtilEmail {
  static normalize(email: string): string {
    return email.trim().toLowerCase();
  }
}
