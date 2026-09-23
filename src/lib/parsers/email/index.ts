import { pocketcardEmailParser } from "./pocketcard";
import { smbcEmailParser } from "./smbc";
import type { EmailParser } from "./types";

export const EMAIL_PARSERS: EmailParser[] = [smbcEmailParser, pocketcardEmailParser];

/** 差出人を担当するパーサー。無ければ null（＝まだ書いていないカード会社） */
export function parserFor(fromAddress: string | null | undefined): EmailParser | null {
  if (!fromAddress) return null;
  return EMAIL_PARSERS.find((p) => p.handles(fromAddress)) ?? null;
}

export type { EmailParser, EmailParseResult, EmailParserId, ParsedUsage } from "./types";
