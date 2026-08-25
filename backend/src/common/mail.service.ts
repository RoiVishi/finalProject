import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * NFR-DEMO-2: in demo and test environments every outbound e-mail is written
 * to a visible log instead of being sent, so invitations and reset links can
 * be demonstrated without a mail server. Swap this implementation for MailHog
 * (or a real SMTP transport) without touching any caller.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);

  constructor(private cfg: ConfigService) {}

  async sendPasswordReset(to: string, rawToken: string): Promise<string> {
    const base = this.cfg.get('APP_URL', 'http://localhost:5173');
    const link = `${base}/reset-password?token=${rawToken}`;
    this.log.log(`[mail] קישור לאיפוס סיסמה עבור ${to}: ${link}`);
    return link;
  }

  async sendProjectInvitation(
    to: string, rawToken: string, projectName: string,
  ): Promise<string> {
    const base = this.cfg.get('APP_URL', 'http://localhost:5173');
    const link = `${base}/invitations/${rawToken}`;
    this.log.log(`[mail] הזמנה לפרויקט "${projectName}" עבור ${to}: ${link}`);
    return link;
  }
}
