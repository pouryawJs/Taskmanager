import { BadRequestException } from '@nestjs/common';

/**
 * Output contract for a single parsed task draft extracted from text.
 */
export interface ParsedTaskDraft {
  /**
   * Required task title, trimmed, maximum 160 characters.
   */
  title: string;

  /**
   * Optional normalized scheduled start time of day ('HH:mm:ss') or null.
   */
  scheduledStartTime: string | null;

  /**
   * Optional normalized scheduled end time of day ('HH:mm:ss') or null.
   */
  scheduledEndTime: string | null;

  /**
   * 1-based line number in the original user message.
   */
  originalLine: number;

  /**
   * Original raw line text before parsing.
   */
  rawText: string;
}

/**
 * Detailed error record for a line that failed parsing or validation.
 */
export interface TaskParseError {
  /**
   * 1-based line number in the original user message.
   */
  line: number;

  /**
   * Clear, actionable error description.
   */
  message: string;

  /**
   * Original line content.
   */
  rawText: string;
}

/**
 * Result structure returned by tryParse.
 */
export interface TaskParseResult {
  success: boolean;
  tasks: ParsedTaskDraft[];
  errors: TaskParseError[];
}

/**
 * Exception thrown by TaskTextParser.parse when one or more lines are invalid.
 */
export class TaskTextParseException extends BadRequestException {
  constructor(public readonly errors: TaskParseError[]) {
    const summary = errors
      .map((e) => `Line ${e.line}: ${e.message}`)
      .join('; ');
    super(`Task parsing failed: ${summary}`);
    this.name = 'TaskTextParseException';
  }
}

/**
 * Converts Persian (۰-۹) and Arabic-Indic (٠-٩) numerals to standard ASCII (0-9).
 */
export function toAsciiDigits(str: string): string {
  return str
    .replace(/[۰-۹]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 48),
    )
    .replace(/[٠-٩]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48),
    );
}

/**
 * Determines whether a string token looks like an intended time expression
 * (e.g. contains digits).
 */
function isTimeLikeCandidate(token: string): boolean {
  return /\d/.test(toAsciiDigits(token));
}

interface ParsedTimeTokenResult {
  valid: boolean;
  normalized?: string;
  hours?: number;
  minutes?: number;
  error?: string;
}

/**
 * Parses and strictly validates a time token (e.g. '18:00', '9:30', '۱۸:۰۰').
 * Enforces 00 <= hours <= 23 and 00 <= minutes <= 59.
 */
function parseTimeToken(rawToken: string): ParsedTimeTokenResult {
  const ascii = toAsciiDigits(rawToken.trim());
  const match = ascii.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) {
    return {
      valid: false,
      error: `Invalid time format '${rawToken}'. Expected HH:mm in 24-hour format (e.g. 09:30 or 18:00).`,
    };
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours < 0 || hours > 23) {
    return {
      valid: false,
      error: `Invalid hour '${match[1]}' in time '${rawToken}'. Hours must be between 00 and 23.`,
    };
  }

  if (minutes < 0 || minutes > 59) {
    return {
      valid: false,
      error: `Invalid minutes '${match[2]}' in time '${rawToken}'. Minutes must be between 00 and 59.`,
    };
  }

  if (seconds < 0 || seconds > 59) {
    return {
      valid: false,
      error: `Invalid seconds '${match[3]}' in time '${rawToken}'. Seconds must be between 00 and 59.`,
    };
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return {
    valid: true,
    normalized: `${hh}:${mm}:${ss}`,
    hours,
    minutes,
  };
}

/**
 * Checks whether text contains another time expression keyword followed by digits,
 * indicating conflicting or duplicate time specifications.
 */
function containsAdditionalTimeExpression(text: string): boolean {
  // Check for repeated "at HH:mm" / "ساعت HH:mm"
  if (
    /(?:^|\s+)(?:at|ساعت:?)\s+\S*[\d\u06F0-\u06F9\u0660-\u0669]\S*/i.test(text)
  ) {
    return true;
  }
  // Check for repeated "from HH:mm to HH:mm" / "از HH:mm تا HH:mm"
  if (
    /(?:^|\s+)(?:from|از)\s+\S*[\d\u06F0-\u06F9\u0660-\u0669]\S*\s+(?:to|تا)\s+\S*[\d\u06F0-\u06F9\u0660-\u0669]\S*/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Task text parser for single or multi-line task entry messages.
 */
export class TaskTextParser {
  /**
   * Parses task entry message text.
   * If all non-empty lines are valid, returns an array of ParsedTaskDraft.
   * If any line is invalid, throws TaskTextParseException containing all errors.
   */
  static parse(text: string): ParsedTaskDraft[] {
    const result = this.tryParse(text);
    if (!result.success) {
      throw new TaskTextParseException(result.errors);
    }
    return result.tasks;
  }

  /**
   * Parses task entry message text non-exceptionally, returning a result object.
   */
  static tryParse(text: string): TaskParseResult {
    if (!text || typeof text !== 'string') {
      return {
        success: false,
        tasks: [],
        errors: [
          {
            line: 1,
            message: 'Input text must be a non-empty string.',
            rawText: '',
          },
        ],
      };
    }

    const rawLines = text.split(/\r?\n/);
    const tasks: ParsedTaskDraft[] = [];
    const errors: TaskParseError[] = [];
    let nonEmptyCount = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const lineNum = i + 1;
      const rawLine = rawLines[i];
      const trimmedLine = rawLine.trim();

      // Blank lines are ignored, but line numbering preserves original input positions
      if (trimmedLine.length === 0) {
        continue;
      }

      nonEmptyCount++;
      const lineResult = this.parseSingleLine(trimmedLine, lineNum);

      if (lineResult.error) {
        errors.push({
          line: lineNum,
          message: lineResult.error,
          rawText: rawLine,
        });
      } else if (lineResult.draft) {
        tasks.push(lineResult.draft);
      }
    }

    if (nonEmptyCount === 0) {
      return {
        success: false,
        tasks: [],
        errors: [
          {
            line: 1,
            message: 'Message does not contain any tasks.',
            rawText: '',
          },
        ],
      };
    }

    // All-or-nothing: if any line produced errors, return zero tasks
    if (errors.length > 0) {
      return {
        success: false,
        tasks: [],
        errors,
      };
    }

    return {
      success: true,
      tasks,
      errors: [],
    };
  }

  /**
   * Internal parser for a single non-empty line.
   */
  private static parseSingleLine(
    line: string,
    lineNum: number,
  ): { draft?: ParsedTaskDraft; error?: string } {
    let title = line;
    let scheduledStartTime: string | null = null;
    let scheduledEndTime: string | null = null;

    // 1. Check for Ambiguous Mixed Suffixes first:
    // e.g. "ورزش ساعت 08:00 تا 10:00" (mixed ساعت and تا)
    const mixedIntervalMatch = line.match(
      /(?:^|\s+)(?:ساعت:?)\s+(\S+)\s+(?:تا|to)\s+(\S+)$/i,
    );
    if (
      mixedIntervalMatch &&
      (isTimeLikeCandidate(mixedIntervalMatch[1]) ||
        isTimeLikeCandidate(mixedIntervalMatch[2]))
    ) {
      return {
        error:
          "Ambiguous time suffix. For time intervals, use 'از HH:mm تا HH:mm' or 'from HH:mm to HH:mm'.",
      };
    }

    // 2. Check for Format C: Interval suffix "from HH:mm to HH:mm" / "از HH:mm تا HH:mm"
    const intervalMatch = line.match(
      /(?:^|[\s\u200C]+)(from|از)\s+(\S+)\s+(to|تا)\s+(\S+)$/i,
    );

    if (intervalMatch) {
      const rawStart = intervalMatch[2];
      const rawEnd = intervalMatch[4];

      // Only treat as time interval if at least one token is time-like candidate
      // (avoiding ordinary phrases like "Flight from Tehran to Shiraz")
      if (isTimeLikeCandidate(rawStart) || isTimeLikeCandidate(rawEnd)) {
        const startParsed = parseTimeToken(rawStart);
        if (!startParsed.valid) {
          return { error: startParsed.error };
        }

        const endParsed = parseTimeToken(rawEnd);
        if (!endParsed.valid) {
          return { error: endParsed.error };
        }

        // V1 Rule: End time must be strictly later than start time (no zero-length or overnight intervals)
        if (endParsed.normalized! <= startParsed.normalized!) {
          return {
            error: `Scheduled end time (${endParsed.normalized}) must be later than start time (${startParsed.normalized}).`,
          };
        }

        const matchIndex = intervalMatch.index ?? 0;
        const candidateTitle = line.slice(0, matchIndex).trim();

        // Check if remaining title becomes empty
        if (candidateTitle.length === 0) {
          return {
            error: 'Task title cannot be empty.',
          };
        }

        // Check for conflicting or repeated time expressions
        if (containsAdditionalTimeExpression(candidateTitle)) {
          return {
            error: 'Conflicting or repeated time expressions found in line.',
          };
        }

        title = candidateTitle;
        scheduledStartTime = startParsed.normalized!;
        scheduledEndTime = endParsed.normalized!;

        return this.validateAndBuildDraft(
          title,
          scheduledStartTime,
          scheduledEndTime,
          lineNum,
          line,
        );
      }
    }

    // 3. Check for Incomplete Intervals (if complete interval was not matched):
    // e.g. "Study from 09:00" or "مطالعه از 09:00" without "to"/"تا"
    const incompleteFromMatch = line.match(/(?:^|\s+)(?:from|از)\s+(\S+)$/i);
    if (incompleteFromMatch && isTimeLikeCandidate(incompleteFromMatch[1])) {
      return {
        error:
          "Incomplete interval time expression. Expected 'from HH:mm to HH:mm' or 'از HH:mm تا HH:mm'.",
      };
    }

    // e.g. "Study to 10:00" or "مطالعه تا 10:00" without "from"/"از"
    const incompleteToMatch = line.match(/(?:^|\s+)(?:to|تا)\s+(\S+)$/i);
    if (incompleteToMatch && isTimeLikeCandidate(incompleteToMatch[1])) {
      return {
        error:
          "Incomplete interval time expression. Expected 'from HH:mm to HH:mm' or 'از HH:mm تا HH:mm'.",
      };
    }

    // 3. Check for Format B: Single start time suffix "at HH:mm" / "ساعت HH:mm"
    const singleTimeMatch = line.match(
      /(?:^|[\s\u200C]+)(?:at|ساعت:?)\s+(\S+)$/i,
    );

    if (singleTimeMatch) {
      const rawTime = singleTimeMatch[1];

      // Only treat as time suffix if token is time-like candidate
      // (avoiding ordinary phrases like "Meeting at office" or "ساعت مچی")
      if (isTimeLikeCandidate(rawTime)) {
        const parsed = parseTimeToken(rawTime);
        if (!parsed.valid) {
          return { error: parsed.error };
        }

        const matchIndex = singleTimeMatch.index ?? 0;
        const candidateTitle = line.slice(0, matchIndex).trim();

        if (candidateTitle.length === 0) {
          return {
            error: 'Task title cannot be empty.',
          };
        }

        if (containsAdditionalTimeExpression(candidateTitle)) {
          return {
            error: 'Conflicting or repeated time expressions found in line.',
          };
        }

        title = candidateTitle;
        scheduledStartTime = parsed.normalized!;
        scheduledEndTime = null;

        return this.validateAndBuildDraft(
          title,
          scheduledStartTime,
          scheduledEndTime,
          lineNum,
          line,
        );
      }
    }

    // 4. Format A: Task without scheduled time
    return this.validateAndBuildDraft(
      title,
      scheduledStartTime,
      scheduledEndTime,
      lineNum,
      line,
    );
  }

  /**
   * Final validation and draft construction.
   */
  private static validateAndBuildDraft(
    title: string,
    scheduledStartTime: string | null,
    scheduledEndTime: string | null,
    lineNum: number,
    rawText: string,
  ): { draft?: ParsedTaskDraft; error?: string } {
    const trimmedTitle = title.trim();

    if (trimmedTitle.length === 0) {
      return { error: 'Task title cannot be empty.' };
    }

    if (trimmedTitle.length > 160) {
      return {
        error: `Task title cannot exceed 160 characters (got ${trimmedTitle.length}).`,
      };
    }

    return {
      draft: {
        title: trimmedTitle,
        scheduledStartTime,
        scheduledEndTime,
        originalLine: lineNum,
        rawText,
      },
    };
  }
}

/**
 * Convenient function-level alias for TaskTextParser.parse.
 */
export function parseTaskText(text: string): ParsedTaskDraft[] {
  return TaskTextParser.parse(text);
}

/**
 * Convenient function-level alias for TaskTextParser.tryParse.
 */
export function tryParseTaskText(text: string): TaskParseResult {
  return TaskTextParser.tryParse(text);
}
